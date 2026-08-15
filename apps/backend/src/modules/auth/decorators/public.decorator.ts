import { SetMetadata } from '@nestjs/common';

export const isPublicKey = 'isPublic';

/**
 * Marca un endpoint como accesible sin sesión. Sin este decorador pasa por
 * `JwtAuthGuard`, que está registrado como guard global.
 * @returns {MethodDecorator & ClassDecorator}
 */
const publicDecorator = (): MethodDecorator & ClassDecorator => SetMetadata(isPublicKey, true);

export { publicDecorator as Public };
