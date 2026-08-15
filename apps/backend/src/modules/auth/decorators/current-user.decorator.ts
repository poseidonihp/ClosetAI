import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { AuthenticatedUser } from '@closetai/shared-types';

/**
 * Inyecta el usuario autenticado que `JwtAuthGuard` dejó en la request.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!request.user) {
      throw new Error('No hay usuario autenticado en la request');
    }
    return request.user;
  },
);
