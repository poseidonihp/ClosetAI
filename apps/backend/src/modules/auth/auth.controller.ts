import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle, seconds } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  EncryptedLoginRequestSchema,
  EncryptedRegisterRequestSchema,
  passwordMinLength,
  type AuthenticatedUser,
  type EncryptedLoginRequest,
  type EncryptedRegisterRequest,
  type SessionPolicy,
} from '@closetai/shared-types';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { Env } from '../../config/env.validation';
import { AuthService } from './auth.service';
import { CryptoService } from './crypto.service';
import type { IAuthTokens } from './auth.dto';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { accessCookieName, refreshCookieName } from './jwt.guard';
import { accessTtlSecondsFrom } from './session-ttl';

interface IRequestWithCookies extends FastifyRequest {
  cookies: Record<string, string | undefined>;
}

// Ruta de la cookie de refresh: sólo viaja a los endpoints que la necesitan.
const refreshCookiePath = '/api/auth';

const throttleWindowSeconds = 60;
const registerAttemptsPerWindow = 5;
const loginAttemptsPerWindow = 5;
const refreshAttemptsPerWindow = 30;

@Controller('auth')
export class AuthController {
  /**
   * Inicializa el controlador de autenticación.
   * @constructor
   * @param {AuthService} _auth - Servicio de sesiones.
   * @param {CryptoService} _crypto - Descifrado del password en tránsito.
   * @param {ConfigService<Env, true>} _config - Configuración tipada del entorno.
   */
  constructor(
    private readonly _auth: AuthService,
    private readonly _crypto: CryptoService,
    private readonly _config: ConfigService<Env, true>,
  ) {}

  /**
   * Clave pública RSA con la que el cliente cifra el password antes de enviarlo.
   * @returns {{ publicKey: string }}
   */
  @Public()
  @Get('public-key')
  publicKey(): { publicKey: string } {
    return { publicKey: this._crypto.getPublicKeyPem() };
  }

  /**
   * Ventana de inactividad vigente, para que el cliente cierre la sesión y avise
   * en el mismo momento en que el servidor deja de aceptar los tokens.
   * @returns {SessionPolicy}
   */
  @Public()
  @Get('session-policy')
  sessionPolicy(): SessionPolicy {
    return { idleTimeoutSeconds: this._config.get('SESSION_IDLE_TTL', { infer: true }) };
  }

  /**
   * Crea una cuenta y deja la sesión abierta.
   * @param {EncryptedRegisterRequest} dto - Email, nombre y password cifrado.
   * @param {FastifyReply} reply - Respuesta donde se escriben las cookies.
   * @returns {Promise<{ user: AuthenticatedUser }>}
   */
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({
    default: { ttl: seconds(throttleWindowSeconds), limit: registerAttemptsPerWindow },
  })
  async register(
    @Body(new ZodValidationPipe(EncryptedRegisterRequestSchema)) dto: EncryptedRegisterRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ user: AuthenticatedUser }> {
    const password = this._crypto.decryptPassword(dto.encryptedPassword);
    if (password.length < passwordMinLength) {
      throw new BadRequestException(
        `El password debe tener al menos ${passwordMinLength} caracteres`,
      );
    }
    const { user, tokens } = await this._auth.register({
      email: dto.email,
      displayName: dto.displayName,
      password,
    });
    this._setAuthCookies(reply, tokens);
    return { user };
  }

  /**
   * Abre sesión con email y password cifrado.
   * @param {EncryptedLoginRequest} dto - Email y password cifrado.
   * @param {FastifyReply} reply - Respuesta donde se escriben las cookies.
   * @returns {Promise<{ user: AuthenticatedUser }>}
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  // Anti fuerza bruta: 5 intentos por minuto y por IP.
  @Throttle({ default: { ttl: seconds(throttleWindowSeconds), limit: loginAttemptsPerWindow } })
  async login(
    @Body(new ZodValidationPipe(EncryptedLoginRequestSchema)) dto: EncryptedLoginRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ user: AuthenticatedUser }> {
    const password = this._crypto.decryptPassword(dto.encryptedPassword);
    const { user, tokens } = await this._auth.login({ email: dto.email, password });
    this._setAuthCookies(reply, tokens);
    return { user };
  }

  /**
   * Rota el par de tokens a partir de la cookie de refresh.
   * @param {IRequestWithCookies} request - Petición con cookies.
   * @param {FastifyReply} reply - Respuesta donde se escriben las cookies.
   * @returns {Promise<{ user: AuthenticatedUser }>}
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: seconds(throttleWindowSeconds), limit: refreshAttemptsPerWindow } })
  async refresh(
    @Req() request: IRequestWithCookies,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ user: AuthenticatedUser }> {
    const refreshToken = request.cookies[refreshCookieName];
    if (!refreshToken) {
      throw new UnauthorizedException('No hay refresh token');
    }
    const { user, tokens } = await this._auth.refresh(refreshToken);
    this._setAuthCookies(reply, tokens);
    return { user };
  }

  /**
   * Cierra la sesión y revoca la familia del refresh token.
   * @param {IRequestWithCookies} request - Petición con cookies.
   * @param {FastifyReply} reply - Respuesta donde se limpian las cookies.
   * @returns {Promise<void>}
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: IRequestWithCookies,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const refreshToken = request.cookies[refreshCookieName];
    if (refreshToken) {
      await this._auth.revokeRefreshToken(refreshToken);
    }
    reply.clearCookie(accessCookieName, { path: '/' });
    reply.clearCookie(refreshCookieName, { path: refreshCookiePath });
  }

  /**
   * Devuelve el usuario de la sesión activa.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @returns {AuthenticatedUser}
   */
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  /**
   * Escribe las cookies httpOnly con el par de tokens recién emitido.
   * @private
   * @param {FastifyReply} reply - Respuesta HTTP.
   * @param {IAuthTokens} tokens - Par access/refresh.
   * @returns {void}
   */
  private _setAuthCookies(reply: FastifyReply, tokens: IAuthTokens): void {
    const secure = this._config.get('COOKIE_SECURE', { infer: true });
    const sameSite = this._config.get('COOKIE_SAMESITE', { infer: true });
    const domain = this._config.get('COOKIE_DOMAIN', { infer: true });
    const idleSeconds = this._config.get('SESSION_IDLE_TTL', { infer: true });
    const baseOptions = {
      httpOnly: true,
      signed: false,
      domain: domain || undefined,
      sameSite,
      secure,
    };
    reply.setCookie(accessCookieName, tokens.accessToken, {
      ...baseOptions,
      path: '/',
      maxAge: accessTtlSecondsFrom(idleSeconds),
    });
    reply.setCookie(refreshCookieName, tokens.refreshToken, {
      ...baseOptions,
      path: refreshCookiePath,
      maxAge: idleSeconds,
    });
  }
}
