import { SetMetadata, type CustomDecorator, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/**
 * Tope **agregado** de las llamadas que cuestan dinero.
 *
 * Cada endpoint de IA ya trae su propio `@Throttle`, pero esos límites son
 * independientes: sumados dejan pasar la tanda de looks, el análisis de vacíos,
 * el render y el etiquetado a la vez. Este limitador cuenta todos juntos, así que
 * el gasto por minuto no depende de cuántos endpoints distintos se encadenen.
 *
 * Los limitadores con nombre de `ThrottlerModule` se evalúan en **todas** las
 * rutas, así que éste se apaga con `skipIf` salvo donde está la marca: sin eso,
 * cargar el clóset consumiría cupo de IA.
 */

export const aiThrottlerName = 'ai';

const aiEndpointMetadataKey = 'closetai:ai-endpoint';
/** `Reflector` no tiene estado: leer metadatos no necesita el contenedor de Nest. */
const reflector = new Reflector();

/**
 * Marca un endpoint como pagado para que entre en el tope agregado de IA.
 * @returns {CustomDecorator}
 */
export function aiRateLimit(): CustomDecorator {
  return SetMetadata(aiEndpointMetadataKey, true);
}

/**
 * `skipIf` del limitador de IA: se salta toda ruta sin la marca.
 * @param {ExecutionContext} context - Contexto de la petición en curso.
 * @returns {boolean}
 */
export function skipUnlessAiEndpoint(context: ExecutionContext): boolean {
  const isAiEndpoint = reflector.getAllAndOverride<boolean>(aiEndpointMetadataKey, [
    context.getHandler(),
    context.getClass(),
  ]);
  return isAiEndpoint !== true;
}
