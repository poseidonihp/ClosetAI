import type { Garment, PurchaseAlternative } from '@closetai/shared-types';
import type { IOpenGapRef } from '../purchase-advice.types';
import type { AdviceDraft } from './advice.contract';
import type { IAssembledAdvice } from './advice.types';

/**
 * Validación y ensamblado de lo que devuelve el redactor del veredicto.
 */

const unknownGarmentReason = 'citaba una prenda que no estaba entre las tuyas';
const duplicateGarmentReason = 'repetía una prenda que ya estaba en la lista';
const unknownGapMessage =
  'Se descartó la alternativa: citaba una brecha que no estaba en la lista.';
const orphanNoteMessage = 'Se descartó la nota de la alternativa: no venía con ninguna brecha.';

/**
 * Resuelve las prendas emparejadas y la alternativa contra lo que se le enseñó
 * al modelo.
 * @param {AdviceDraft} draft - Respuesta del modelo, ya validada contra su esquema.
 * @param {ReadonlyMap<string, Garment>} garmentsByShortId - Id corto → prenda real.
 * @param {ReadonlyMap<string, IOpenGapRef>} gapsByShortId - Id corto → brecha real.
 * @returns {IAssembledAdvice}
 */
export function assembleAdvice(
  draft: AdviceDraft,
  garmentsByShortId: ReadonlyMap<string, Garment>,
  gapsByShortId: ReadonlyMap<string, IOpenGapRef>,
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
    alternative: resolveAlternative(draft, gapsByShortId, discarded),
  };
}

/**
 * Resuelve la alternativa contra las brechas que viajaron al modelo. Copia la
 * descripción de la brecha porque un análisis nuevo de la Fase 5 reemplaza las
 * `OPEN`, y sin esa copia el texto quedaría citando algo que ya no existe.
 * @param {AdviceDraft} draft - Respuesta del modelo.
 * @param {ReadonlyMap<string, IOpenGapRef>} gapsByShortId - Id corto → brecha real.
 * @param {string[]} discarded - Acumulador de descartes, que se rellena aquí.
 * @returns {PurchaseAlternative | null}
 */
function resolveAlternative(
  draft: AdviceDraft,
  gapsByShortId: ReadonlyMap<string, IOpenGapRef>,
  discarded: string[],
): PurchaseAlternative | null {
  const note = (draft.alternativeNote ?? '').trim();
  if (draft.alternativeGapId === null) {
    if (note.length > 0) {
      discarded.push(orphanNoteMessage);
    }
    return null;
  }
  const gap = gapsByShortId.get(draft.alternativeGapId);
  if (!gap) {
    discarded.push(unknownGapMessage);
    return null;
  }
  return { note, gapId: gap.id, label: gap.description };
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
