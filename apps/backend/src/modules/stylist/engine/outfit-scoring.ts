import {
  LookScoreSignalEnum,
  enumLabels,
  type Garment,
  type LookScoreLine,
  type StyleArchetype,
} from '@closetai/shared-types';
import {
  formalityWindowByStyleTag,
  layeringBonus,
  layeringTemperatureC,
  loudPatternScales,
  maxEngineScore,
  maxFormalityDistance,
  millisecondsPerDay,
  missingOuterwearPenalty,
  neutralWeatherScore,
  outerwearTemperatureC,
  patternScoreByLoudCount,
  recentWearPenalty,
  recentlyWornDays,
  scoreWeights,
  wearCountPenalty,
  wearCountReference,
} from './engine.constants';
import { harmonyScore } from './color-harmony';
import { evaluateFitRules } from './fit-rules';
import { scorePreference } from './learning';
import type { IEngineInput, IScoredOutfit } from './engine.types';
import { allGarments, coreGarments, type IOutfitDraft } from './outfit-draft';
import { average, clampScore, formatDecimal } from './score-utils';

/**
 * Puntuación blanda de un conjunto ya válido.
 */

interface ISignalResult {
  score: number;
  reason: string;
}

interface IFormalityResult extends ISignalResult {
  averageFormality: number;
  gap: number;
}

/**
 * Puntúa un conjunto y devuelve el desglose que explica la nota.
 * @param {IOutfitDraft} draft - Conjunto candidato.
 * @param {IEngineInput} input - Clóset, perfil y petición normalizada.
 * @returns {IScoredOutfit}
 */
export function scoreOutfit(draft: IOutfitDraft, input: IEngineInput): IScoredOutfit {
  const fit = evaluateFitRules(draft, input.profile);
  const formality = scoreFormality(draft, input.request.styleTag);
  const results = {
    FORMALITY: formality,
    COLOR: scoreColor(draft),
    WEATHER: scoreWeather(draft, input.request.temperatureC),
    FIT: { score: fit.score, reason: fit.reason },
    PATTERN: scorePattern(draft),
    FRESHNESS: scoreFreshness(draft, input.now),
    PREFERENCE: scorePreference(draft, input.feedback, input.garments),
  } as const satisfies Record<string, ISignalResult>;

  const breakdown: LookScoreLine[] = LookScoreSignalEnum.options.map(signal => ({
    signal,
    weight: scoreWeights[signal],
    score: results[signal].score,
    reason: results[signal].reason,
  }));
  const rawScore = breakdown.reduce((total, line) => total + line.score * line.weight, 0);

  return {
    draft,
    rawScore,
    breakdown,
    engineScore: Math.round(rawScore * maxEngineScore),
    fitNotes: fit.notes,
    averageFormality: formality.averageFormality,
    formalityGap: formality.gap,
  };
}

/**
 * Cercanía a la ventana de formalidad del estilo pedido. Se mide sobre el
 * núcleo: la formalidad de un conjunto la marcan la base y el calzado.
 * @param {IOutfitDraft} draft - Conjunto candidato.
 * @param {StyleArchetype} styleTag - Estilo pedido.
 * @returns {IFormalityResult}
 */
export function scoreFormality(draft: IOutfitDraft, styleTag: StyleArchetype): IFormalityResult {
  const window = formalityWindowByStyleTag[styleTag];
  const core = coreGarments(draft);
  const averageFormality = average(core.map(garment => garment.formality));
  const gap =
    averageFormality < window.min
      ? window.min - averageFormality
      : Math.max(0, averageFormality - window.max);
  const styleLabel = enumLabels.styleArchetype[styleTag].toLowerCase();
  const windowText = `${styleLabel} pide entre ${window.min} y ${window.max}`;
  const direction = averageFormality < window.min ? 'por debajo' : 'por encima';
  const reason =
    gap === 0
      ? `Formalidad media ${formatDecimal(averageFormality)}: dentro de la ventana (${windowText}).`
      : `Formalidad media ${formatDecimal(averageFormality)}: se queda ${formatDecimal(gap)} ${direction} de la ventana (${windowText}).`;

  return { score: clampScore(1 - gap / maxFormalityDistance), reason, averageFormality, gap };
}

/**
 * Armonía de la paleta. Mira base y capas: un accesorio no define el color de un
 * conjunto, y contarlo enturbiaría la nota de todos los looks con reloj.
 * @param {IOutfitDraft} draft - Conjunto candidato.
 * @returns {ISignalResult}
 */
function scoreColor(draft: IOutfitDraft): ISignalResult {
  const hexes = [...coreGarments(draft), ...draft.layers].map(garment => garment.primaryColorHex);
  return harmonyScore(hexes);
}

/**
 * Adecuación al clima: cuántas prendas están en su rango a esa temperatura, con
 * premio por capas cuando refresca y castigo por salir sin abrigo cuando hace frío.
 * @param {IOutfitDraft} draft - Conjunto candidato.
 * @param {number | null} temperatureC - Temperatura resuelta, o null si no hay.
 * @returns {ISignalResult}
 */
function scoreWeather(draft: IOutfitDraft, temperatureC: number | null): ISignalResult {
  if (temperatureC === null) {
    return {
      score: neutralWeatherScore,
      reason: 'Sin temperatura indicada: el conjunto no se ha ajustado al clima.',
    };
  }
  const garments = allGarments(draft);
  const comfortable = garments.filter(garment => isComfortableAt(garment, temperatureC));
  const hasOuterwear = draft.layers.some(garment => garment.slot === 'OUTERWEAR');
  const missesOuterwear = temperatureC <= outerwearTemperatureC && !hasOuterwear;
  const earnsLayering = temperatureC <= layeringTemperatureC && draft.layers.length > 0;

  const score = clampScore(
    comfortable.length / garments.length +
      (earnsLayering ? layeringBonus : 0) -
      (missesOuterwear ? missingOuterwearPenalty : 0),
  );
  const base = `A ${temperatureC} °C, ${comfortable.length} de ${garments.length} prendas están en su rango.`;
  if (missesOuterwear) {
    return { score, reason: `${base} Falta una prenda de abrigo para esa temperatura.` };
  }
  if (earnsLayering) {
    return { score, reason: `${base} Las capas ayudan con el fresco.` };
  }
  return { score, reason: base };
}

/**
 * Indica si a esa temperatura el look debería llevar capa. Es la misma frontera
 * que premia `scoreWeather`, expuesta aparte porque también deciden con ella la
 * generación de candidatos y el prompt del estilista: tres sitios con el mismo
 * umbral escrito a mano acabarían discrepando.
 * @param {number | null} temperatureC - Temperatura resuelta, o null si no hay.
 * @returns {boolean}
 */
export function needsLayerAt(temperatureC: number | null): boolean {
  return temperatureC !== null && temperatureC <= layeringTemperatureC;
}

/**
 * Indica si una prenda está dentro de su rango declarado a esa temperatura.
 * @param {Garment} garment - Prenda a evaluar.
 * @param {number} temperatureC - Temperatura de la petición.
 * @returns {boolean}
 */
export function isComfortableAt(garment: Garment, temperatureC: number): boolean {
  const aboveMin = garment.weatherMinC === null || temperatureC >= garment.weatherMinC;
  const belowMax = garment.weatherMaxC === null || temperatureC <= garment.weatherMaxC;
  return aboveMin && belowMax;
}

/**
 * Choque de estampados. Uno llamativo es una decisión; dos ya compiten.
 * @param {IOutfitDraft} draft - Conjunto candidato.
 * @returns {ISignalResult}
 */
function scorePattern(draft: IOutfitDraft): ISignalResult {
  const loud = allGarments(draft).filter(
    garment => garment.pattern !== 'SOLID' && loudPatternScales.includes(garment.patternScale),
  );
  const index = Math.min(loud.length, patternScoreByLoudCount.length - 1);
  const score = patternScoreByLoudCount[index] ?? 0;
  const names = loud.map(garment => garment.name).join(', ');

  if (loud.length === 0) {
    return { score, reason: 'Sin estampados que compitan entre sí.' };
  }
  if (loud.length === 1) {
    return { score, reason: `Un único estampado llamativo (${names}); el resto es liso.` };
  }
  return { score, reason: `${loud.length} estampados llamativos compiten entre sí (${names}).` };
}

/**
 * Variedad: penaliza lo que acabas de ponerte y lo que ya has usado mucho, para
 * que el motor no proponga siempre el mismo conjunto.
 * @param {IOutfitDraft} draft - Conjunto candidato.
 * @param {Date} now - Momento de la generación.
 * @returns {ISignalResult}
 */
function scoreFreshness(draft: IOutfitDraft, now: Date): ISignalResult {
  const garments = allGarments(draft);
  const recent = garments.filter(garment => wasWornRecently(garment, now));
  const overused = garments.filter(garment => garment.wearCount >= wearCountReference);
  const penalties = garments.map(
    garment =>
      (wasWornRecently(garment, now) ? recentWearPenalty : 0) +
      (garment.wearCount >= wearCountReference ? wearCountPenalty : 0),
  );
  const score = clampScore(1 - average(penalties));

  if (recent.length === 0 && overused.length === 0) {
    return {
      score,
      reason: `Nada de este conjunto se ha usado en los últimos ${recentlyWornDays} días.`,
    };
  }
  if (recent.length > 0) {
    const recentNames = recent.map(garment => garment.name).join(', ');
    return { score, reason: `Repites prendas recientes: ${recentNames}.` };
  }
  const overusedNames = overused.map(garment => garment.name).join(', ');
  return { score, reason: `Prendas ya muy usadas en el conjunto: ${overusedNames}.` };
}

/**
 * Indica si la prenda se usó dentro de la ventana de repetición.
 * @param {Garment} garment - Prenda a evaluar.
 * @param {Date} now - Momento de la generación.
 * @returns {boolean}
 */
function wasWornRecently(garment: Garment, now: Date): boolean {
  if (!garment.lastWornAt) {
    return false;
  }
  const wornAt = new Date(garment.lastWornAt).getTime();
  if (Number.isNaN(wornAt)) {
    return false;
  }
  return (now.getTime() - wornAt) / millisecondsPerDay < recentlyWornDays;
}
