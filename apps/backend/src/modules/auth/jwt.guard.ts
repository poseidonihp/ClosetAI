import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from '@closetai/shared-types';
import { AuthService } from './auth.service';
import { isPublicKey } from './decorators/public.decorator';

interface IRequestWithCookies {
  cookies?: Record<string, string>;
  headers?: { authorization?: string };
  user?: AuthenticatedUser;
}

export const accessCookieName = 'closet_access';
export const refreshCookieName = 'closet_refresh';

const bearerPrefix = 'Bearer ';

/**
 * Guard global: toda ruta exige sesión salvo que lleve `@Public()`.
 * @class
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  /**
   * Inicializa el guard con el reflector de metadatos y el servicio de auth.
   * @constructor
   * @param {Reflector} _reflector - Lector de metadatos de Nest.
   * @param {AuthService} _auth - Servicio que valida el access token.
   */
  constructor(
    private readonly _reflector: Reflector,
    private readonly _auth: AuthService,
  ) {}

  /**
   * Valida el token de la petición y adjunta el usuario a la request.
   * @param {ExecutionContext} context - Contexto de ejecución de Nest.
   * @returns {Promise<boolean>}
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this._reflector.getAllAndOverride<boolean>(isPublicKey, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<IRequestWithCookies>();
    const token = JwtAuthGuard._extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Token ausente');
    }

    request.user = await this._auth.validateAccessToken(token);
    return true;
  }

  /**
   * Obtiene el access token de la cookie o, como respaldo, del header Bearer.
   * @private
   * @param {IRequestWithCookies} request - Petición entrante.
   * @returns {string | null}
   */
  private static _extractToken(request: IRequestWithCookies): string | null {
    const fromCookie = request.cookies?.[accessCookieName];
    if (fromCookie) {
      return fromCookie;
    }
    const authorization = request.headers?.authorization;
    if (authorization?.startsWith(bearerPrefix)) {
      return authorization.slice(bearerPrefix.length);
    }
    return null;
  }
}
