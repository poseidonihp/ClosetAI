import type { GapHypothesis } from '@closetai/shared-types';
import type { GapDraft, GapsDraft } from './gaps.contract';
import type { IAssembledGap, IGapAssemblyResult } from './gaps.types';

/**
 * Validación y ensamblado de lo que devuelve el análisis.
 */

const unknownHypothesisReason = 'citaba una prenda que no estaba entre las candidatas';
const duplicateHypothesisReason = 'repetía una prenda que ya estaba en la lista';

/**
 * Resuelve las brechas del modelo contra las hipótesis que calculó el motor.
 * @param {GapsDraft} draft - Respuesta del modelo, ya validada contra su esquema.
 * @param {readonly GapHypothesis[]} hypotheses - Prendas candidatas que se le enseñaron.
 * @returns {IGapAssemblyResult}
 */
export function assembleGaps(
  draft: GapsDraft,
  hypotheses: readonly GapHypothesis[],
): IGapAssemblyResult {
  const byId = new Map(hypotheses.map(hypothesis => [hypothesis.id, hypothesis]));
  const accepted: IAssembledGap[] = [];
  const discarded: string[] = [];
  const used = new Set<string>();

  for (const [index, gap] of draft.gaps.entries()) {
    const reason = rejectionReason(gap, byId, used);
    const hypothesis = byId.get(gap.hypothesisId);
    if (reason !== null || !hypothesis) {
      discarded.push(describeDiscard(index, reason ?? unknownHypothesisReason));
    } else {
      used.add(hypothesis.id);
      accepted.push(toAssembled(gap, hypothesis, accepted.length + 1));
    }
  }

  return { accepted, discarded };
}

/**
 * Motivo por el que una brecha del modelo no se acepta, o null si es válida.
 * @param {GapDraft} gap - Brecha tal como la redactó el modelo.
 * @param {ReadonlyMap<string, GapHypothesis>} byId - Candidatas por id corto.
 * @param {ReadonlySet<string>} used - Candidatas ya aceptadas en esta tanda.
 * @returns {string | null}
 */
function rejectionReason(
  gap: GapDraft,
  byId: ReadonlyMap<string, GapHypothesis>,
  used: ReadonlySet<string>,
): string | null {
  if (!byId.has(gap.hypothesisId)) {
    return unknownHypothesisReason;
  }
  return used.has(gap.hypothesisId) ? duplicateHypothesisReason : null;
}

/**
 * Combina el texto del modelo con las medidas del motor.
 * @param {GapDraft} gap - Brecha tal como la redactó el modelo.
 * @param {GapHypothesis} hypothesis - Prenda candidata que el motor midió.
 * @param {number} priority - Puesto en la lista, empezando en 1.
 * @returns {IAssembledGap}
 */
function toAssembled(gap: GapDraft, hypothesis: GapHypothesis, priority: number): IAssembledGap {
  return {
    hypothesis,
    priority,
    description: gap.description,
    reason: gap.reason,
    referenceBrands: {
      luxury: [...gap.referenceBrands.luxury],
      affordable: [...gap.referenceBrands.affordable],
    },
  };
}

/**
 * Redacta el motivo de un descarte citando qué propuesta fue.
 * @param {number} index - Posición de la brecha en la respuesta del modelo.
 * @param {string} reason - Motivo del descarte.
 * @returns {string}
 */
function describeDiscard(index: number, reason: string): string {
  return `Se descartó la propuesta ${index + 1}: ${reason}.`;
}
