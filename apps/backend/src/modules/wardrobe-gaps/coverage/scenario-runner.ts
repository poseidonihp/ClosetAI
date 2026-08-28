import {
  defaultLooksPerRequest,
  type CoverageScenario,
  type Garment,
  type GarmentSlot,
} from '@closetai/shared-types';
import { buildCandidates } from '../../stylist/engine/candidates';
import { findMissingSlots } from '../../stylist/engine/diagnostics';
import type {
  IEngineInput,
  IEngineRequest,
  IScoredOutfit,
} from '../../stylist/engine/engine.types';
import { splitEligibility } from '../../stylist/engine/garment-rules';
import { emptyFeedback } from '../../stylist/engine/learning';
import { coreGarments, garmentSetKey } from '../../stylist/engine/outfit-draft';
import { needsLayerAt } from '../../stylist/engine/outfit-scoring';
import type { ICoverageInput, IScenarioSpec } from './coverage.types';

/**
 * Ejecuta el motor de la Fase 2 sobre un escenario.
 *
 * Se llama a `splitEligibility` y `buildCandidates` en vez de a `generateLooks`
 * porque aquí no hace falta la ficha: lo que interesa es cuántos conjuntos salen
 * y cuáles, no cómo se cuentan. Es el mismo camino de código, sin la narrativa.
 */

/** Slots que pueden hacer de capa dentro de un look. */
const layerSlots: ReadonlySet<GarmentSlot> = new Set(['MID_LAYER', 'OUTERWEAR']);

export interface IScenarioOutcome {
  eligible: Garment[];
  scored: IScoredOutfit[];
  scenario: CoverageScenario;
  /** Núcleos distintos (base + calzado) que produjo el escenario. */
  coreKeys: Set<string>;
}

/**
 * Evalúa un escenario, opcionalmente con una prenda hipotética añadida al clóset.
 * @param {ICoverageInput} input - Clóset, perfil y catálogo.
 * @param {IScenarioSpec} spec - Escenario a evaluar.
 * @param {Garment | null} extra - Prenda hipotética a añadir, o null.
 * @returns {IScenarioOutcome}
 */
export function runScenario(
  input: ICoverageInput,
  spec: IScenarioSpec,
  extra: Garment | null,
): IScenarioOutcome {
  const garments = extra === null ? input.garments : [...input.garments, extra];
  const request: IEngineRequest = {
    styleTag: spec.styleTag,
    temperatureC: spec.temperatureC,
    mustIncludeGarmentId: null,
    includeSuggested: false,
    limit: defaultLooksPerRequest,
  };
  const engineInput: IEngineInput = {
    garments,
    profile: input.profile,
    now: input.now,
    feedback: emptyFeedback,
    request: { ...request, mustIncludeGarmentId: extra?.id ?? null },
  };

  const { eligible } = splitEligibility(garments, { profile: input.profile, request });
  const { scored } = buildCandidates(eligible, engineInput);

  return {
    eligible,
    scored,
    coreKeys: toCoreKeys(scored),
    scenario: toScenario(spec, eligible, scored),
  };
}

/**
 * Resume el escenario en la fila de la matriz que ve el usuario y el modelo.
 * @param {IScenarioSpec} spec - Escenario evaluado.
 * @param {readonly Garment[]} eligible - Prendas que pasaron las reglas duras.
 * @param {readonly IScoredOutfit[]} scored - Candidatos puntuados.
 * @returns {CoverageScenario}
 */
function toScenario(
  spec: IScenarioSpec,
  eligible: readonly Garment[],
  scored: readonly IScoredOutfit[],
): CoverageScenario {
  const [best] = scored;
  return {
    id: spec.id,
    label: spec.label,
    styleTag: spec.styleTag,
    temperatureC: spec.temperatureC,
    outfitCount: scored.length,
    bestEngineScore: best?.engineScore ?? 0,
    missingSlots: findMissingSlots(eligible),
    needsLayer: needsLayerAt(spec.temperatureC),
    hasLayer: eligible.some(garment => layerSlots.has(garment.slot)),
  };
}

/**
 * Claves de los núcleos distintos de una tanda de candidatos.
 * @param {readonly IScoredOutfit[]} scored - Candidatos puntuados.
 * @returns {Set<string>}
 */
function toCoreKeys(scored: readonly IScoredOutfit[]): Set<string> {
  return new Set(
    scored.map(candidate =>
      garmentSetKey(coreGarments(candidate.draft).map(garment => garment.id)),
    ),
  );
}
