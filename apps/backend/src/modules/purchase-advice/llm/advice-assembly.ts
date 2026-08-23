import type { Garment } from '@closetai/shared-types';
import type { AdviceDraft } from './advice.contract';
import type { IAssembledAdvice } from './advice.types';

/**
 * Validación y ensamblado de lo que devuelve el redactor del veredicto.
 */

const unknownGarmentReason = 'citaba una prenda que no estaba entre las tuyas';
const duplicateGarmentReason = 'repetía una prenda que ya estaba en la lista';

/**
 * Resuelve las prendas emparejadas contra el clóset que se le enseñó al modelo.
 * @param {AdviceDraft} draft - Respuesta del modelo, ya validada contra su esquema.
 * @param {ReadonlyMap<string, Garment>} garmentsByShortId - Id corto → prenda real.
 * @returns {IAssembledAdvice}
 */
export function assembleAdvice(
  draft: AdviceDraft,
  garmentsByShortId: ReadonlyMap<string, Garment>,
): IAssembledAdvice {
  const pairedGarmentIds: string[] = [];
  const discarded: string[] = [];
  const used = new Set<string>();

  for (const [index, shortId] of draft.pairedGarmentIds.entries()) {
    const garment = garmentsByShortId.get(shortId);
    if (!garment) {
      discarded.push(describeDiscard(index, unknownGarmentReason));
    } else if (used.has(shortId)) {
      discarded.push(describeDiscard(index, duplicateGarmentReason));
    } else {
      used.add(shortId);
      pairedGarmentIds.push(garment.id);
    }
  }

  return {
    discarded,
    pairedGarmentIds,
    headline: draft.headline,
    reason: draft.reason,
    stylingNotes: [...draft.stylingNotes],
  };
}

/**
 * Redacta el motivo de un descarte citando qué propuesta fue.
 * @param {number} index - Posición de la prenda en la respuesta del modelo.
 * @param {string} reason - Motivo del descarte.
 * @returns {string}
 */
function describeDiscard(index: number, reason: string): string {
  return `Se descartó la prenda ${index + 1}: ${reason}.`;
}
