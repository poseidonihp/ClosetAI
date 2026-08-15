import {
  climateReferenceTempC,
  type GenerateLooksRequest,
  type Look,
  type StyleProfile,
} from '@closetai/shared-types';
import { buildCandidates } from './candidates';
import { buildDiagnostics } from './diagnostics';
import { oneLinerByStyleTag } from './engine.constants';
import type { IEngineInput, IEngineRequest, IEngineResult, IScoredOutfit } from './engine.types';
import { splitEligibility } from './garment-rules';
import {
  buildItems,
  buildLookId,
  buildOccasions,
  buildPalette,
  buildStyleNotes,
  buildTitle,
  buildWeatherRange,
} from './narrative';
import { coreGarments, garmentIds } from './outfit-draft';

/**
 * Capa 1 del motor de recomendación: genera y puntúa conjuntos válidos.
 */

/**
 * Genera los looks que permite el clóset del usuario.
 * @param {IEngineInput} input - Clóset, perfil y petición ya normalizada.
 * @returns {IEngineResult}
 */
export function generateLooks(input: IEngineInput): IEngineResult {
  const { eligible, excluded } = splitEligibility(input.garments, {
    profile: input.profile,
    request: input.request,
  });
  const { scored, truncated } = buildCandidates(eligible, input);
  const looks = selectDiverse(scored, input.request.limit).map(candidate =>
    toLook(candidate, input),
  );
  const diagnostics = buildDiagnostics({ input, eligible, excluded, scored, truncated });

  return { looks, diagnostics, eligible, excluded, scored };
}

/**
 * Resuelve la temperatura efectiva de la petición: manda el dato más concreto,
 * de la temperatura exacta al clima del perfil. `VARIABLE` no acota nada, así
 * que se comporta igual que no haber dicho nada.
 * @param {GenerateLooksRequest} request - Petición tal como llegó.
 * @param {StyleProfile} profile - Perfil del usuario.
 * @returns {number | null}
 */
export function resolveTemperatureC(
  request: GenerateLooksRequest,
  profile: StyleProfile,
): number | null {
  if (request.temperatureC !== null) {
    return request.temperatureC;
  }
  if (request.climate !== null) {
    return climateReferenceTempC[request.climate];
  }
  return profile.climate === null ? null : climateReferenceTempC[profile.climate];
}

/**
 * Normaliza la petición del cliente en la que consume el motor.
 * @param {GenerateLooksRequest} request - Petición tal como llegó.
 * @param {StyleProfile} profile - Perfil del usuario.
 * @returns {IEngineRequest}
 */
export function toEngineRequest(
  request: GenerateLooksRequest,
  profile: StyleProfile,
): IEngineRequest {
  return {
    styleTag: request.styleTag,
    temperatureC: resolveTemperatureC(request, profile),
    mustIncludeGarmentId: request.mustIncludeGarmentId,
    includeSuggested: request.includeSuggested,
    limit: request.limit,
  };
}

/**
 * Elige los mejores candidatos procurando que no sean el mismo conjunto con otro
 * accesorio. Si el clóset sólo da para una combinación, devuelve una: es
 * preferible a rellenar con variantes que en realidad son el mismo look.
 * @param {readonly IScoredOutfit[]} scored - Candidatos ordenados de mejor a peor.
 * @param {number} limit - Cuántos looks se piden.
 * @returns {IScoredOutfit[]}
 */
export function selectDiverse(scored: readonly IScoredOutfit[], limit: number): IScoredOutfit[] {
  const remaining = [...scored];
  const picked: IScoredOutfit[] = [];

  while (picked.length < limit && remaining.length > 0) {
    const index = findDistinctIndex(remaining, picked);
    const [chosen] = remaining.splice(index, 1);
    if (chosen) {
      picked.push(chosen);
    }
  }
  return picked;
}

/**
 * Índice del mejor candidato que difiere en el núcleo de todos los ya elegidos;
 * si no hay ninguno, el mejor que quede.
 * @param {readonly IScoredOutfit[]} remaining - Candidatos sin elegir.
 * @param {readonly IScoredOutfit[]} picked - Candidatos ya elegidos.
 * @returns {number}
 */
function findDistinctIndex(
  remaining: readonly IScoredOutfit[],
  picked: readonly IScoredOutfit[],
): number {
  if (picked.length === 0) {
    return 0;
  }
  const index = remaining.findIndex(candidate =>
    picked.every(chosen => differsInCore(candidate, chosen)),
  );
  return Math.max(index, 0);
}

/**
 * Indica si dos candidatos se diferencian en al menos una prenda del núcleo.
 * @param {IScoredOutfit} first - Primer candidato.
 * @param {IScoredOutfit} second - Segundo candidato.
 * @returns {boolean}
 */
function differsInCore(first: IScoredOutfit, second: IScoredOutfit): boolean {
  const firstIds = new Set(coreGarments(first.draft).map(garment => garment.id));
  const secondIds = coreGarments(second.draft).map(garment => garment.id);
  return (
    secondIds.length !== firstIds.size || secondIds.some(garmentId => !firstIds.has(garmentId))
  );
}

/**
 * Convierte un candidato puntuado en la ficha que consume el cliente.
 * @param {IScoredOutfit} scored - Candidato ya puntuado.
 * @param {IEngineInput} input - Clóset, perfil y petición normalizada.
 * @returns {Look}
 */
function toLook(scored: IScoredOutfit, input: IEngineInput): Look {
  const { styleTag } = input.request;
  const { weatherMinC, weatherMaxC } = buildWeatherRange(scored.draft);

  return {
    id: buildLookId(garmentIds(scored.draft), styleTag),
    title: buildTitle(scored.draft, styleTag),
    oneLiner: oneLinerByStyleTag[styleTag],
    items: buildItems(scored.draft, input),
    colorPalette: buildPalette(scored.draft),
    occasions: buildOccasions(styleTag, scored.averageFormality),
    styleNotes: buildStyleNotes(scored, styleTag),
    fitNotes: scored.fitNotes,
    engineScore: scored.engineScore,
    scoreBreakdown: scored.breakdown,
    styleTag,
    weatherMinC,
    weatherMaxC,
  };
}
