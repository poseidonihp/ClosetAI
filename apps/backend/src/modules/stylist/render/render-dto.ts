import type { OutfitRender as OutfitRenderRow } from '@prisma/client';
import type { OutfitRender } from '@closetai/shared-types';

/**
 * Traduce la fila del render al DTO que consume el cliente.
 *
 * Es una función y no un método de servicio porque la usan los dos lados: la
 * ficha del look, que lista los renders que ya tiene, y el propio render al
 * crearse. Un método en cualquiera de los dos servicios habría atado uno al otro.
 * @param {OutfitRenderRow} render - Fila del render.
 * @param {(key: string) => string} urlFor - Resolutor de URL del driver de storage.
 * @returns {OutfitRender}
 */
export function toRenderDto(
  render: OutfitRenderRow,
  urlFor: (key: string) => string,
): OutfitRender {
  return {
    id: render.id,
    kind: render.kind,
    url: urlFor(render.imageKey),
    width: render.width,
    height: render.height,
    modelUsed: render.modelUsed,
    promptVersion: render.promptVersion,
    createdAt: render.createdAt.toISOString(),
  };
}
