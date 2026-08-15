import type { Garment, GarmentSlot } from '@closetai/shared-types';
import {
  beamWidth,
  formalityWindowByStyleTag,
  maxAccessoriesPerOutfit,
  maxCoreCombinations,
  maxFormalityDistance,
  maxLayersPerOutfit,
  maxPoolPerSlot,
  maxScoredCandidates,
  neutralWeatherScore,
  optionalPieceTolerance,
  prescoreOutOfRangeScore,
  prescoreWeights,
  recentWearPenalty,
} from './engine.constants';
import type { IEngineInput, IScoredOutfit } from './engine.types';
import { isComfortableAt, needsLayerAt, scoreOutfit } from './outfit-scoring';
import { draftKey, includesGarment, type IOutfitDraft } from './outfit-draft';
import { clampScore } from './score-utils';

/**
 * Generación de candidatos.
 */

export interface ICandidateResult {
  scored: IScoredOutfit[];
  truncated: boolean;
}

/** Núcleo de un conjunto antes de añadirle capas y accesorios. */
type CoreDraft = Pick<IOutfitDraft, 'top' | 'bottom' | 'fullBody' | 'footwear'>;

/**
 * Enumera, puntúa y ordena los candidatos que se pueden armar con las prendas
 * elegibles.
 * @param {readonly Garment[]} eligible - Prendas que pasaron las reglas duras.
 * @param {IEngineInput} input - Clóset, perfil y petición normalizada.
 * @returns {ICandidateResult}
 */
export function buildCandidates(
  eligible: readonly Garment[],
  input: IEngineInput,
): ICandidateResult {
  const pools = buildPools(eligible, input);
  const cores = buildCores(pools, input);
  const beam = cores.drafts
    .map(core => ({ core, score: scoreOutfit(toDraft(core), input).rawScore }))
    .sort((first, second) => second.score - first.score)
    .slice(0, beamWidth);

  const seen = new Set<string>();
  const scored: IScoredOutfit[] = [];
  for (const entry of beam) {
    const enriched = enrich(toDraft(entry.core), pools, input);
    const key = draftKey(enriched);
    if (!seen.has(key)) {
      seen.add(key);
      scored.push(scoreOutfit(enriched, input));
    }
  }

  scored.sort((first, second) => second.rawScore - first.rawScore);
  return { scored: scored.slice(0, maxScoredCandidates), truncated: cores.truncated };
}

/**
 * Agrupa las prendas por slot, ordena cada grupo por su preselección y recorta
 * los que son demasiado largos. La prenda pedida con `mustInclude` nunca se cae
 * en el recorte: sería el peor sitio posible para perderla.
 * @param {readonly Garment[]} eligible - Prendas que pasaron las reglas duras.
 * @param {IEngineInput} input - Clóset, perfil y petición normalizada.
 * @returns {Map<GarmentSlot, Garment[]>}
 */
function buildPools(
  eligible: readonly Garment[],
  input: IEngineInput,
): Map<GarmentSlot, Garment[]> {
  const pools = new Map<GarmentSlot, Garment[]>();
  for (const garment of eligible) {
    pools.set(garment.slot, [...(pools.get(garment.slot) ?? []), garment]);
  }

  const mustIncludeId = input.request.mustIncludeGarmentId;
  for (const [slot, garments] of pools) {
    const sorted = [...garments].sort(
      (first, second) => prescore(second, input) - prescore(first, input),
    );
    const kept = sorted.slice(0, maxPoolPerSlot);
    const mustInclude = sorted.find(garment => garment.id === mustIncludeId);
    const withMustInclude =
      mustInclude && !kept.includes(mustInclude) ? [mustInclude, ...kept] : kept;
    pools.set(slot, withMustInclude);
  }
  return pools;
}

/**
 * Preselección barata de una prenda suelta: qué tan cerca está de la ventana de
 * formalidad, si es cómoda a esa temperatura y si no la acabas de usar.
 * @param {Garment} garment - Prenda a preseleccionar.
 * @param {IEngineInput} input - Clóset, perfil y petición normalizada.
 * @returns {number}
 */
function prescore(garment: Garment, input: IEngineInput): number {
  const window = formalityWindowByStyleTag[input.request.styleTag];
  const distance =
    garment.formality < window.min
      ? window.min - garment.formality
      : Math.max(0, garment.formality - window.max);
  const formality = clampScore(1 - distance / maxFormalityDistance);

  const temperature = input.request.temperatureC;
  let weather = neutralWeatherScore;
  if (temperature !== null) {
    weather = isComfortableAt(garment, temperature) ? 1 : prescoreOutOfRangeScore;
  }

  const freshness = garment.lastWornAt === null ? 1 : 1 - recentWearPenalty;
  return (
    formality * prescoreWeights.formality +
    weather * prescoreWeights.weather +
    freshness * prescoreWeights.freshness
  );
}

/**
 * Enumera los núcleos válidos: `TOP + BOTTOM + FOOTWEAR` o
 * `FULL_BODY + FOOTWEAR`. Sin la segunda rama, un clóset con vestidos no
 * generaría nada.
 * @param {Map<GarmentSlot, Garment[]>} pools - Prendas por slot, ya ordenadas.
 * @param {IEngineInput} input - Clóset, perfil y petición normalizada.
 * @returns {{ drafts: CoreDraft[]; truncated: boolean }}
 */
function buildCores(
  pools: Map<GarmentSlot, Garment[]>,
  input: IEngineInput,
): { drafts: CoreDraft[]; truncated: boolean } {
  const tops = pools.get('TOP') ?? [];
  const bottoms = pools.get('BOTTOM') ?? [];
  const fullBodies = pools.get('FULL_BODY') ?? [];
  const footwears = pools.get('FOOTWEAR') ?? [];

  const bases: Omit<CoreDraft, 'footwear'>[] = [
    ...fullBodies.map(fullBody => ({ top: null, bottom: null, fullBody })),
    ...tops.flatMap(top => bottoms.map(bottom => ({ top, bottom, fullBody: null }))),
  ];

  const drafts: CoreDraft[] = [];
  let truncated = false;
  for (const base of bases) {
    for (const footwear of footwears) {
      if (drafts.length >= maxCoreCombinations) {
        truncated = true;
      } else {
        drafts.push({ ...base, footwear });
      }
    }
  }

  return { drafts: drafts.filter(core => satisfiesMustInclude(core, input)), truncated };
}

/**
 * Descarta pronto los núcleos que no pueden contener la prenda pedida. Si la
 * prenda es una capa o un accesorio, el núcleo no puede decidirlo todavía.
 * @param {CoreDraft} core - Núcleo candidato.
 * @param {IEngineInput} input - Clóset, perfil y petición normalizada.
 * @returns {boolean}
 */
function satisfiesMustInclude(core: CoreDraft, input: IEngineInput): boolean {
  const mustIncludeId = input.request.mustIncludeGarmentId;
  if (mustIncludeId === null) {
    return true;
  }
  const mustInclude = input.garments.find(garment => garment.id === mustIncludeId);
  if (!mustInclude) {
    return false;
  }
  if (isOptionalSlot(mustInclude.slot)) {
    return true;
  }
  return [core.top, core.bottom, core.fullBody, core.footwear].some(
    garment => garment?.id === mustIncludeId,
  );
}

/**
 * Indica si el slot es opcional dentro de un look.
 * @param {GarmentSlot} slot - Slot a evaluar.
 * @returns {boolean}
 */
function isOptionalSlot(slot: GarmentSlot): boolean {
  return slot === 'MID_LAYER' || slot === 'OUTERWEAR' || slot === 'ACCESSORY';
}

/**
 * Convierte un núcleo en un conjunto completo sin capas ni accesorios.
 * @param {CoreDraft} core - Núcleo candidato.
 * @returns {IOutfitDraft}
 */
function toDraft(core: CoreDraft): IOutfitDraft {
  return { ...core, layers: [], accessories: [] };
}

/**
 * Añade capas y accesorios de forma codiciosa: cada prenda opcional entra sólo
 * si sube la nota del conjunto. Así una chaqueta aparece cuando hace frío y no
 * aparece cuando sobra, sin necesidad de una regla por caso.
 * @param {IOutfitDraft} core - Conjunto con sólo el núcleo.
 * @param {Map<GarmentSlot, Garment[]>} pools - Prendas por slot, ya ordenadas.
 * @param {IEngineInput} input - Clóset, perfil y petición normalizada.
 * @returns {IOutfitDraft}
 */
function enrich(
  core: IOutfitDraft,
  pools: Map<GarmentSlot, Garment[]>,
  input: IEngineInput,
): IOutfitDraft {
  const layerPool = [...(pools.get('MID_LAYER') ?? []), ...(pools.get('OUTERWEAR') ?? [])];
  const accessoryPool = pools.get('ACCESSORY') ?? [];
  const forced = findForcedOptional(pools, input);

  let current = core;
  if (forced) {
    current = addOptional(current, forced);
  }
  current = addLayers(current, layerPool, input);
  return addAccessories(current, accessoryPool, input);
}

/**
 * Devuelve la prenda opcional que el usuario pidió incluir, si la hay.
 * @param {Map<GarmentSlot, Garment[]>} pools - Prendas por slot, ya ordenadas.
 * @param {IEngineInput} input - Clóset, perfil y petición normalizada.
 * @returns {Garment | null}
 */
function findForcedOptional(
  pools: Map<GarmentSlot, Garment[]>,
  input: IEngineInput,
): Garment | null {
  const mustIncludeId = input.request.mustIncludeGarmentId;
  if (mustIncludeId === null) {
    return null;
  }
  const candidates = [...pools.values()].flat();
  const mustInclude = candidates.find(garment => garment.id === mustIncludeId);
  return mustInclude && isOptionalSlot(mustInclude.slot) ? mustInclude : null;
}

/**
 * Coloca una prenda opcional en su lista según el slot.
 * @param {IOutfitDraft} draft - Conjunto candidato.
 * @param {Garment} garment - Prenda opcional a añadir.
 * @returns {IOutfitDraft}
 */
function addOptional(draft: IOutfitDraft, garment: Garment): IOutfitDraft {
  if (garment.slot === 'ACCESSORY') {
    return { ...draft, accessories: [...draft.accessories, garment] };
  }
  return { ...draft, layers: [...draft.layers, garment] };
}

/**
 * Indica si una capa cabe todavía en el conjunto: queda hueco, su slot está libre
 * y la prenda no está ya puesta.
 * @param {IOutfitDraft} draft - Conjunto candidato.
 * @param {Garment} candidate - Capa que se quiere añadir.
 * @returns {boolean}
 */
function layerFits(draft: IOutfitDraft, candidate: Garment): boolean {
  return (
    draft.layers.length < maxLayersPerOutfit &&
    !draft.layers.some(layer => layer.slot === candidate.slot) &&
    !includesGarment(draft, candidate.id)
  );
}

/**
 * Mejor capa disponible para este conjunto, o null si ninguna cabe.
 * @param {IOutfitDraft} draft - Conjunto candidato.
 * @param {readonly Garment[]} pool - Capas disponibles.
 * @param {IEngineInput} input - Clóset, perfil y petición normalizada.
 * @returns {Garment | null}
 */
function bestLayer(
  draft: IOutfitDraft,
  pool: readonly Garment[],
  input: IEngineInput,
): Garment | null {
  let chosen: Garment | null = null;
  let chosenScore = -1;

  for (const candidate of pool) {
    if (layerFits(draft, candidate)) {
      const score = scoreOutfit(addOptional(draft, candidate), input).rawScore;
      if (score > chosenScore) {
        chosen = candidate;
        chosenScore = score;
      }
    }
  }
  return chosen;
}

/**
 * Añade capas al conjunto.
 *
 * **Cuando la temperatura pide capa, el conjunto lleva capa**: se elige la que
 * mejor puntúe de las disponibles aunque no suba la nota total. Antes entraba sólo
 * si mejoraba, y eso dejaba sin chaqueta conjuntos a 15 °C en cuanto el color que
 * añadía costaba más que el premio por capas — un resultado correcto según la
 * aritmética y absurdo para quien se está vistiendo. La segunda capa sigue
 * exigiendo mejora: abrigar es una necesidad, acumular capas es una opción.
 * @param {IOutfitDraft} draft - Conjunto candidato.
 * @param {readonly Garment[]} pool - Capas disponibles.
 * @param {IEngineInput} input - Clóset, perfil y petición normalizada.
 * @returns {IOutfitDraft}
 */
function addLayers(
  draft: IOutfitDraft,
  pool: readonly Garment[],
  input: IEngineInput,
): IOutfitDraft {
  let current = draft;
  if (needsLayerAt(input.request.temperatureC) && current.layers.length === 0) {
    const forced = bestLayer(current, pool, input);
    if (forced) {
      current = addOptional(current, forced);
    }
  }

  let best = scoreOutfit(current, input).rawScore;
  for (const candidate of pool) {
    if (layerFits(current, candidate)) {
      const next = addOptional(current, candidate);
      const score = scoreOutfit(next, input).rawScore;
      if (score > best) {
        current = next;
        best = score;
      }
    }
  }
  return current;
}

/**
 * Añade accesorios hasta el máximo por conjunto.
 *
 * Aquí no se exige mejorar la nota sino **no empeorarla** más allá de
 * `optionalPieceTolerance`, porque un accesorio bien elegido no mueve ninguna
 * señal: no cambia la formalidad del conjunto ni su armonía de color. Con la regla
 * anterior —entrar sólo si sube la nota— no entraba ninguno jamás, y un clóset con
 * gafas, bufandas o collares se comportaba como si no los tuviera. Lo que sí choca
 * —un estampado grande, una prenda fuera de su rango térmico— cae mucho más que el
 * margen y se sigue quedando fuera.
 * @param {IOutfitDraft} draft - Conjunto candidato.
 * @param {readonly Garment[]} pool - Accesorios disponibles.
 * @param {IEngineInput} input - Clóset, perfil y petición normalizada.
 * @returns {IOutfitDraft}
 */
function addAccessories(
  draft: IOutfitDraft,
  pool: readonly Garment[],
  input: IEngineInput,
): IOutfitDraft {
  let current = draft;
  let best = scoreOutfit(current, input).rawScore;

  for (const candidate of pool) {
    const hasRoom = current.accessories.length < maxAccessoriesPerOutfit;
    if (hasRoom && !includesGarment(current, candidate.id)) {
      const next = addOptional(current, candidate);
      const score = scoreOutfit(next, input).rawScore;
      if (score >= best - optionalPieceTolerance) {
        current = next;
        best = Math.max(best, score);
      }
    }
  }
  return current;
}
