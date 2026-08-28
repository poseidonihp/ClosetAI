import type { Garment } from '@closetai/shared-types';
import {
  allGarments,
  coreGarments,
  draftKey,
  garmentSetKey,
} from '../../stylist/engine/outfit-draft';
import type { ICoverageInput, IScenarioRun } from './coverage.types';
import { runScenario } from './scenario-runner';

/**
 * Qué desbloquea una prenda: se mete en el clóset, se vuelve a pasar el motor por
 * todos los escenarios y se cuenta la diferencia.
 */

/** Lo que el motor mide al añadir una prenda al clóset. */
export interface IGarmentImpact {
  unlockedOutfitsEstimate: number;
  outfitsUsingItEstimate: number;
  newlyCoveredScenarioIds: string[];
  scoreGain: number;
  bestOutfitScore: number;
  baselineBestScore: number;
  bestOutfitScenarioId: string | null;
  pairedGarmentIds: string[];
}

/** Escenarios ya evaluados sin la prenda, que hacen de línea base. */
export interface IMeasureContext {
  input: ICoverageInput;
  runs: readonly IScenarioRun[];
}

/** Ajustes de la medición. Todos opcionales: sin ellos se cuenta en bruto. */
export interface IMeasureOptions {
  equivalentGarmentIds?: readonly string[];
}

/**
 * Mide el impacto de añadir una prenda al clóset.
 *
 * La prenda que llega debe venir ya `CONFIRMED` y `ACTIVE`: si no, las reglas
 * duras la descartan y la medición daría siempre cero.
 * @param {IMeasureContext} context - Clóset, perfil y escenarios de referencia.
 * @param {Garment} garment - Prenda a añadir, confirmada y disponible.
 * @param {IMeasureOptions} [options] - Ajustes de la medición.
 * @returns {IGarmentImpact}
 */
export function measureGarmentImpact(
  context: IMeasureContext,
  garment: Garment,
  options: IMeasureOptions = {},
): IGarmentImpact {
  const equivalents = options.equivalentGarmentIds ?? [];
  const baselineCores = new Set(context.runs.flatMap(run => [...run.coreKeys]));
  const unlocked = new Set<string>();
  const usedIn = new Set<string>();
  const pairCounts = new Map<string, number>();
  const newlyCoveredScenarioIds: string[] = [];
  let scoreGain = 0;
  let bestOutfitScore = 0;
  let baselineBestScore = 0;
  let bestOutfitScenarioId: string | null = null;

  for (const run of context.runs) {
    const outcome = runScenario(context.input, run.spec, garment);
    const wearing = outcome.scored.filter(candidate =>
      allGarments(candidate.draft).some(piece => piece.id === garment.id),
    );
    let scenarioBest = 0;

    for (const candidate of wearing) {
      const coreIds = coreGarments(candidate.draft).map(piece => piece.id);
      const key = garmentSetKey(coreIds);
      if (!baselineCores.has(key) && !isSubstitution(coreIds, garment.id, equivalents, baselineCores)) {
        unlocked.add(key);
      }
      scenarioBest = Math.max(scenarioBest, candidate.engineScore);
      usedIn.add(draftKey(candidate.draft));
      countPairs(pairCounts, allGarments(candidate.draft), garment.id);
    }

    if (scenarioBest > bestOutfitScore) {
      bestOutfitScore = scenarioBest;
      baselineBestScore = run.scenario.bestEngineScore;
      bestOutfitScenarioId = run.spec.id;
    }
    scoreGain = Math.max(scoreGain, scenarioBest - run.scenario.bestEngineScore);
    if (run.scenario.outfitCount === 0 && wearing.length > 0) {
      newlyCoveredScenarioIds.push(run.spec.id);
    }
  }

  return {
    scoreGain,
    newlyCoveredScenarioIds,
    bestOutfitScore,
    baselineBestScore,
    bestOutfitScenarioId,
    unlockedOutfitsEstimate: unlocked.size,
    outfitsUsingItEstimate: usedIn.size,
    pairedGarmentIds: sortByCount(pairCounts),
  };
}

/**
 * Indica si el núcleo ya se podía armar cambiando la prenda nueva por otra que
 * hace su mismo papel. Un núcleo así no lo desbloquea nadie: ya lo tenías.
 * @param {readonly string[]} coreIds - Prendas del núcleo evaluado.
 * @param {string} garmentId - Prenda que se está midiendo.
 * @param {readonly string[]} equivalents - Prendas que hacen el mismo papel.
 * @param {ReadonlySet<string>} baselineCores - Núcleos que el clóset ya daba.
 * @returns {boolean}
 */
function isSubstitution(
  coreIds: readonly string[],
  garmentId: string,
  equivalents: readonly string[],
  baselineCores: ReadonlySet<string>,
): boolean {
  if (equivalents.length === 0 || !coreIds.includes(garmentId)) {
    return false;
  }
  return equivalents.some(equivalentId =>
    baselineCores.has(
      garmentSetKey(coreIds.map(id => (id === garmentId ? equivalentId : id))),
    ),
  );
}

/**
 * Anota con qué prendas apareció la candidata en este conjunto.
 * @param {Map<string, number>} counts - Acumulador de coincidencias por prenda.
 * @param {readonly Garment[]} pieces - Prendas del conjunto.
 * @param {string} garmentId - Prenda que se está midiendo.
 * @returns {void}
 */
function countPairs(
  counts: Map<string, number>,
  pieces: readonly Garment[],
  garmentId: string,
): void {
  for (const piece of pieces) {
    if (piece.id !== garmentId) {
      counts.set(piece.id, (counts.get(piece.id) ?? 0) + 1);
    }
  }
}

/**
 * Ordena las prendas emparejadas de más a menos veces que aparecieron con ella.
 * @param {ReadonlyMap<string, number>} counts - Coincidencias por prenda.
 * @returns {string[]}
 */
function sortByCount(counts: ReadonlyMap<string, number>): string[] {
  return [...counts.entries()]
    .sort((first, second) => second[1] - first[1])
    .map(([garmentId]) => garmentId);
}
