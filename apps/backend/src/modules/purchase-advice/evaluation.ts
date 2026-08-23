import {
  colorFamilyFromHex,
  type Garment,
  type PurchaseVerdictReason,
} from '@closetai/shared-types';
import type { ICoverageInput, IScenarioRun } from '../wardrobe-gaps/coverage/coverage.types';
import { measureGarmentImpact, type IGarmentImpact } from '../wardrobe-gaps/coverage/measure';
import { runScenario } from '../wardrobe-gaps/coverage/scenario-runner';
import { buildScenarios } from '../wardrobe-gaps/coverage/scenarios';
import { findDuplicates } from './duplicates';
import type {
  IOpenGapRef,
  IPurchaseEvaluation,
  IPurchaseEvaluationInput,
} from './purchase-advice.types';
import { decideVerdict } from './verdict';

/**
 * La medición de "¿me lo compro?": determinista, gratis y sin llamar a nadie.
 *
 * No reimplementa el motor: mete la candidata en el clóset y vuelve a pasarlo,
 * que es exactamente lo que hace la Fase 5 con sus prendas hipotéticas.
 */

const unusableImageNote =
  'De estas fotos no se pudo sacar una prenda, así que no hay nada que medir. Cámbialas o completa los atributos a mano y vuelve a intentarlo.';
const pendingAttributesNote =
  'Esta prenda todavía no tiene atributos: etiquétala con IA o complétalos a mano para poder medirla contra tu clóset.';
const noWardrobeNote =
  'Todavía no hay ninguna prenda confirmada en tu clóset con la que comparar. Confirma unas cuantas y vuelve.';

/**
 * Evalúa si conviene comprar la prenda candidata.
 * @param {IPurchaseEvaluationInput} input - Candidata, clóset, perfil y brechas.
 * @returns {IPurchaseEvaluation}
 */
export function evaluatePurchase(input: IPurchaseEvaluationInput): IPurchaseEvaluation {
  const blocked = findInsufficientData(input);
  if (blocked !== null) {
    return blocked;
  }

  const coverageInput = toCoverageInput(input);
  const runs = buildScenarios(input.profile).map<IScenarioRun>(spec => ({
    spec,
    ...runScenario(coverageInput, spec, null),
  }));

  const duplicateGarmentIds = findDuplicates(input.candidate, input.closet);
  const impact = measureGarmentImpact(
    { input: coverageInput, runs },
    toMeasurableCandidate(input.candidate),
    { equivalentGarmentIds: duplicateGarmentIds },
  );

  const matchedGapId = findMatchingGap(input.candidate, input.openGaps);
  const decision = decideVerdict({
    impact,
    duplicateGarmentIds,
    matchedGapId,
    candidate: input.candidate,
    profile: input.profile,
  });
  const newlyCoveredScenarioLabels = runs
    .filter(run => impact.newlyCoveredScenarioIds.includes(run.spec.id))
    .map(run => run.spec.label);

  return {
    impact,
    matchedGapId,
    duplicateGarmentIds,
    newlyCoveredScenarioLabels,
    verdict: decision.verdict,
    verdictReason: decision.reason,
    note: describeImpact(impact, newlyCoveredScenarioLabels),
  };
}

/**
 * Devuelve el veredicto de datos insuficientes, o null si se puede medir.
 * @param {IPurchaseEvaluationInput} input - Candidata, clóset, perfil y brechas.
 * @returns {IPurchaseEvaluation | null}
 */
function findInsufficientData(input: IPurchaseEvaluationInput): IPurchaseEvaluation | null {
  if (!input.candidate.tagging.usableForTagging) {
    return toBlocked('UNUSABLE_IMAGE', unusableImageNote);
  }
  if (input.candidate.taggingStatus === 'PENDING') {
    return toBlocked('PENDING_ATTRIBUTES', pendingAttributesNote);
  }
  const usable = input.closet.filter(
    garment => garment.taggingStatus === 'CONFIRMED' && garment.status === 'ACTIVE',
  );
  return usable.length === 0 ? toBlocked('NO_CONFIRMED_WARDROBE', noWardrobeNote) : null;
}

/**
 * Construye el veredicto que se devuelve cuando faltan datos para medir.
 * @param {PurchaseVerdictReason} verdictReason - Qué falta exactamente.
 * @param {string} note - Qué hacer para poder evaluarla, en español.
 * @returns {IPurchaseEvaluation}
 */
function toBlocked(verdictReason: PurchaseVerdictReason, note: string): IPurchaseEvaluation {
  return {
    note,
    verdictReason,
    verdict: 'CONDITIONAL',
    impact: null,
    matchedGapId: null,
    duplicateGarmentIds: [],
    newlyCoveredScenarioLabels: [],
  };
}

/**
 * Entrada del cálculo de cobertura con la que se mide.
 * @param {IPurchaseEvaluationInput} input - Candidata, clóset, perfil y brechas.
 * @returns {ICoverageInput}
 */
function toCoverageInput(input: IPurchaseEvaluationInput): ICoverageInput {
  return {
    now: input.now,
    profile: input.profile,
    catalog: input.catalog,
    garments: input.closet,
    dismissed: [],
  };
}

/**
 * Clona la candidata como una prenda que ya tienes y puedes ponerte.
 * @param {Garment} candidate - Prenda tal como está guardada.
 * @returns {Garment}
 */
function toMeasurableCandidate(candidate: Garment): Garment {
  return {
    ...candidate,
    ownership: 'OWNED',
    status: 'ACTIVE',
    taggingStatus: 'CONFIRMED',
    tagging: { ...candidate.tagging, status: 'CONFIRMED' },
  };
}

/**
 * Brecha `OPEN` que esta prenda cubriría: mismo tipo de prenda y misma familia
 * de color, que es como se cruzan las dos fases.
 * @param {Garment} candidate - Prenda que se está evaluando.
 * @param {readonly IOpenGapRef[]} openGaps - Brechas todavía pendientes.
 * @returns {string | null}
 */
function findMatchingGap(candidate: Garment, openGaps: readonly IOpenGapRef[]): string | null {
  const family = colorFamilyFromHex(candidate.primaryColorHex);
  const match = openGaps.find(
    gap =>
      gap.garmentTypeId === candidate.garmentTypeId &&
      gap.slot === candidate.slot &&
      colorFamilyFromHex(gap.colorHex) === family,
  );
  return match?.id ?? null;
}

/**
 * Cuenta lo que midió el motor, con los dos números y sin adornos.
 * @param {IGarmentImpact} impact - Medidas del motor.
 * @param {readonly string[]} coveredLabels - Escenarios que pasaría a cubrir.
 * @returns {string | null}
 */
function describeImpact(impact: IGarmentImpact, coveredLabels: readonly string[]): string | null {
  const parts: string[] = [];
  if (impact.outfitsUsingItEstimate > 0) {
    parts.push(`entra en ${impact.outfitsUsingItEstimate} conjunto(s)`);
  }
  if (impact.unlockedOutfitsEstimate > 0) {
    parts.push(`${impact.unlockedOutfitsEstimate} de ellos imposibles sin ella`);
  }
  if (coveredLabels.length > 0) {
    parts.push(`te deja vestirte para ${coveredLabels.join(' y ')}`);
  }
  if (impact.scoreGain > 0) {
    parts.push(`sube ${impact.scoreGain} puntos la nota de tu mejor conjunto`);
  }
  if (parts.length === 0) {
    return 'Con tu clóset de hoy no abre ninguna combinación nueva ni mejora ningún conjunto.';
  }
  return `Medido sobre tu clóset: ${parts.join('; ')}.`;
}
