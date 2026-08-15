import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import type { AuthenticatedUser } from '@closetai/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import type { Env } from '../../config/env.validation';
import type { IAuthTokens, IJwtPayload, ILoginCredentials, IRegisterCredentials } from './auth.dto';
import { accessTtlSecondsFrom } from './session-ttl';

const millisPerSecond = 1000;
const bcryptRounds = 12;
const invalidCredentialsMessage = 'Credenciales inválidas';
const userNotFoundMessage = 'Usuario no encontrado';
const wrongTokenTypeMessage = 'Tipo de token incorrecto';
const uniqueViolationCode = 'P2002';
const authenticatedUserFields = { id: true, email: true, displayName: true } as const;

export interface IAuthResult {
  user: AuthenticatedUser;
  tokens: IAuthTokens;
}

/**
 * Sesiones con JWT en cookies httpOnly y rotación de refresh tokens por familia.
 * @class
 */
@Injectable()
export class AuthService {
  /**
   * Inicializa el servicio con Prisma, el firmador de JWT y la configuración.
   * @constructor
   * @param {PrismaService} _prisma - Cliente de base de datos.
   * @param {JwtService} _jwt - Firmador y verificador de JWT.
   * @param {ConfigService<Env, true>} _config - Configuración tipada del entorno.
   */
  constructor(
    private readonly _prisma: PrismaService,
    private readonly _jwt: JwtService,
    private readonly _config: ConfigService<Env, true>,
  ) {}

  /**
   * Crea un usuario nuevo y abre sesión con él.
   * @param {IRegisterCredentials} credentials - Email, nombre y password en claro.
   * @returns {Promise<IAuthResult>}
   */
  async register(credentials: IRegisterCredentials): Promise<IAuthResult> {
    const passwordHash = await bcrypt.hash(credentials.password, bcryptRounds);
    let created: AuthenticatedUser;
    try {
      created = await this._prisma.user.create({
        data: {
          email: credentials.email.toLowerCase(),
          displayName: credentials.displayName,
          passwordHash,
        },
        select: authenticatedUserFields,
      });
    } catch (error) {
      if (AuthService._isUniqueViolation(error)) {
        throw new ConflictException('Ya existe una cuenta con ese email');
      }
      throw error;
    }

    const { tokens } = await this._issueTokenPair(created.id, created.email, randomUUID());
    return { user: created, tokens };
  }

  /**
   * Verifica las credenciales y abre una nueva familia de refresh tokens.
   * @param {ILoginCredentials} credentials - Email y password en claro.
   * @returns {Promise<IAuthResult>}
   */
  async login(credentials: ILoginCredentials): Promise<IAuthResult> {
    const user = await this._prisma.user.findUnique({
      where: { email: credentials.email.toLowerCase() },
    });
    if (!user) {
      throw new UnauthorizedException(invalidCredentialsMessage);
    }

    const passwordMatches = await bcrypt.compare(credentials.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException(invalidCredentialsMessage);
    }

    const { tokens } = await this._issueTokenPair(user.id, user.email, randomUUID());
    return {
      user: { id: user.id, email: user.email, displayName: user.displayName },
      tokens,
    };
  }

  /**
   * Valida un access token y devuelve el usuario al que pertenece.
   * @param {string} token - Access token en formato JWT.
   * @returns {Promise<AuthenticatedUser>}
   */
  async validateAccessToken(token: string): Promise<AuthenticatedUser> {
    let payload: IJwtPayload;
    try {
      payload = this._jwt.verify<IJwtPayload>(token, { secret: this._accessSecret() });
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
    if (payload.type !== 'access') {
      throw new UnauthorizedException(wrongTokenTypeMessage);
    }

    const user = await this._prisma.user.findUnique({
      where: { id: payload.sub },
      select: authenticatedUserFields,
    });
    if (!user) {
      throw new UnauthorizedException(userNotFoundMessage);
    }
    return user;
  }

  /**
   * Rota el par de tokens. Reusar un refresh ya revocado revoca la familia entera.
   * @param {string} refreshToken - Refresh token recibido en la cookie.
   * @returns {Promise<IAuthResult>}
   */
  async refresh(refreshToken: string): Promise<IAuthResult> {
    const payload = this._verifyRefresh(refreshToken);

    const stored = await this._prisma.refreshToken.findUnique({ where: { jti: payload.jti } });
    if (!stored) {
      throw new UnauthorizedException('Refresh token desconocido');
    }

    if (stored.revokedAt) {
      await this._revokeFamily(stored.familyId);
      throw new UnauthorizedException('Refresh token reutilizado; sesión revocada');
    }
    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expirado');
    }

    const user = await this._prisma.user.findUnique({
      where: { id: stored.userId },
      select: authenticatedUserFields,
    });
    if (!user) {
      throw new UnauthorizedException(userNotFoundMessage);
    }

    const { tokens, refreshJti } = await this._issueTokenPair(user.id, user.email, stored.familyId);
    await this._prisma.refreshToken.update({
      where: { jti: stored.jti },
      data: { revokedAt: new Date(), replacedByJti: refreshJti },
    });
    return { user, tokens };
  }

  /**
   * Revoca la familia del refresh token (logout de esa sesión). Best-effort.
   * @param {string} refreshToken - Refresh token recibido en la cookie.
   * @returns {Promise<void>}
   */
  async revokeRefreshToken(refreshToken: string): Promise<void> {
    let payload: IJwtPayload;
    try {
      payload = this._jwt.verify<IJwtPayload>(refreshToken, { secret: this._refreshSecret() });
    } catch {
      return;
    }
    if (payload.type !== 'refresh' || !payload.jti) {
      return;
    }
    const stored = await this._prisma.refreshToken.findUnique({
      where: { jti: payload.jti },
      select: { familyId: true },
    });
    if (stored) {
      await this._revokeFamily(stored.familyId);
    }
  }

  /**
   * Verifica un refresh token y garantiza que trae `jti`.
   * @private
   * @param {string} refreshToken - Refresh token recibido en la cookie.
   * @returns {IJwtPayload & { jti: string }}
   */
  private _verifyRefresh(refreshToken: string): IJwtPayload & { jti: string } {
    let payload: IJwtPayload;
    try {
      payload = this._jwt.verify<IJwtPayload>(refreshToken, { secret: this._refreshSecret() });
    } catch {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }
    if (payload.type !== 'refresh' || !payload.jti) {
      throw new UnauthorizedException(wrongTokenTypeMessage);
    }
    return { ...payload, jti: payload.jti };
  }

  /**
   * Revoca todos los refresh tokens vivos de una familia.
   * @private
   * @param {string} familyId - Identificador de la familia de tokens.
   * @returns {Promise<void>}
   */
  private async _revokeFamily(familyId: string): Promise<void> {
    await this._prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Emite un par access/refresh y persiste el nuevo refresh en su familia.
   * @private
   * @param {string} userId - Identificador del usuario.
   * @param {string} email - Email del usuario.
   * @param {string} familyId - Familia a la que pertenece el refresh emitido.
   * @returns {Promise<{ tokens: IAuthTokens; refreshJti: string }>}
   */
  private async _issueTokenPair(
    userId: string,
    email: string,
    familyId: string,
  ): Promise<{ tokens: IAuthTokens; refreshJti: string }> {
    const idleSeconds = this._config.get('SESSION_IDLE_TTL', { infer: true });
    const accessToken = this._jwt.sign(
      { sub: userId, email, type: 'access' } satisfies IJwtPayload,
      {
        secret: this._accessSecret(),
        expiresIn: accessTtlSecondsFrom(idleSeconds),
      },
    );

    const refreshJti = randomUUID();
    const refreshToken = this._jwt.sign(
      { sub: userId, email, type: 'refresh', jti: refreshJti } satisfies IJwtPayload,
      {
        secret: this._refreshSecret(),
        expiresIn: idleSeconds,
      },
    );

    const decoded = this._jwt.decode<{ exp?: number }>(refreshToken);
    const expiresAt = decoded?.exp ? new Date(decoded.exp * millisPerSecond) : new Date();
    await this._prisma.refreshToken.create({
      data: { userId, familyId, expiresAt, jti: refreshJti },
    });

    return { refreshJti, tokens: { accessToken, refreshToken } };
  }

  /**
   * Secreto de firma de los access tokens.
   * @private
   * @returns {string}
   */
  private _accessSecret(): string {
    return this._config.get('JWT_SECRET', { infer: true });
  }

  /**
   * Secreto de firma de los refresh tokens; cae a JWT_SECRET si no se configuró.
   * @private
   * @returns {string}
   */
  private _refreshSecret(): string {
    return (
      this._config.get('JWT_REFRESH_SECRET', { infer: true }) ??
      this._config.get('JWT_SECRET', { infer: true })
    );
  }

  /**
   * Indica si el error de Prisma es una violación de índice único.
   * @private
   * @param {unknown} error - Error capturado.
   * @returns {boolean}
   */
  private static _isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === uniqueViolationCode
    );
  }
}
