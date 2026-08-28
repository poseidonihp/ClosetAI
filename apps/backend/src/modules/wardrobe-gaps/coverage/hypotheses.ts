import {
  enumLabels,
  formalityLabel,
  maxFormality,
  minFormality,
  type Garment,
  type GarmentSlot,
  type GarmentType,
  type GapHypothesis,
} from '@closetai/shared-types';
import { harmonyScore } from '../../stylist/engine/color-harmony';
import {
  formalityGapWorthMentioning,
  formalityWindowByStyleTag,
  weatherToleranceC,
} from '../../stylist/engine/engine.constants';
import { matchesAvoidedColor } from '../../stylist/engine/garment-rules';
import {
  hypothesisShortIdPrefix,
  hypotheticalGarmentIdDigits,
  hypotheticalGarmentIdPrefix,
  maxHypotheses,
  maxRankedHypotheses,
  maxTypesPerNeed,
  minScoreGainPoints,
  priorityWeights,
  requiredPriorityBonus,
  versatileColors,
} from './coverage.constants';
import type { ICoverageInput, IScenarioRun } from './coverage.types';
import { measureGarmentImpact, type IGarmentImpact } from './measure';

/**
 * Qué prendas merece la pena probar a añadir, y qué desbloquearía cada una.
 *
 * El cálculo es el mismo que produce los looks: se mete la prenda hipotética en
 * el clóset, se vuelve a pasar el motor por todos los escenarios y se cuenta la
 * diferencia. Nada de esto se le pregunta al modelo.
 */

/** Slots del núcleo que una compra puede arreglar. */
const coreNeedSlots: readonly GarmentSlot[] = ['TOP', 'BOTTOM', 'FOOTWEAR'];

/**
 * De dónde sale una carencia. `MISSING_SLOT` es la única obligatoria: sin esa
 * prenda no hay look que armar, así que se propone aunque medirla dé cero —con
 * el clóset vacío ninguna prenda suelta desbloquea nada, y eso no significa que
 * no haya nada que comprar.
 */
type NeedKind = 'MISSING_SLOT' | 'LAYER' | 'FORMALITY';

/** Una carencia de la matriz, antes de traducirla a prendas concretas. */
interface INeed {
  kind: NeedKind;
  slot: GarmentSlot;
  targetFormality: number;
  minFormality: number;
  maxFormality: number;
  scenarioIds: string[];
  temperatureC: number;
}

/** Una prenda hipotética antes de evaluarla. */
interface IHypothesisDraft {
  type: GarmentType;
  colorHex: string;
  colorName: string;
  need: INeed;
}

export interface IHypothesisContext {
  input: ICoverageInput;
  runs: readonly IScenarioRun[];
}

/**
 * Propone y evalúa las prendas hipotéticas que podrían cerrar las brechas.
 * @param {IHypothesisContext} context - Clóset, catálogo y escenarios ya evaluados.
 * @returns {GapHypothesis[]}
 */
export function buildHypotheses(context: IHypothesisContext): GapHypothesis[] {
  const drafts = collectNeeds(context.runs)
    .flatMap(need => toDrafts(need, context))
    .filter(uniqueDrafts())
    .filter(draft => !isDismissed(draft, context))
    .slice(0, maxHypotheses);

  return drafts
    .map((draft, index) => ({ draft, hypothesis: evaluate(draft, index, context) }))
    .filter(entry => isWorthBuying(entry.hypothesis, entry.draft.need))
    .map(entry => entry.hypothesis)
    .sort((first, second) => second.priorityScore - first.priorityScore)
    .slice(0, maxRankedHypotheses)
    .map((hypothesis, index) => ({ ...hypothesis, id: toHypothesisShortId(index) }));
}

/**
 * Id corto de la prenda candidata que ocupa una posición. Los ids son
 * posicionales y sólo significan algo dentro del análisis que los emitió.
 * @param {number} index - Posición, empezando en 0.
 * @returns {string}
 */
export function toHypothesisShortId(index: number): string {
  return `${hypothesisShortIdPrefix}${index + 1}`;
}

/**
 * Recorre los escenarios y anota qué le falta a cada uno.
 * @param {readonly IScenarioRun[]} runs - Escenarios ya evaluados.
 * @returns {INeed[]}
 */
function collectNeeds(runs: readonly IScenarioRun[]): INeed[] {
  const needs = runs.flatMap(run => [
    ...missingSlotNeeds(run),
    ...layerNeeds(run),
    ...formalityNeeds(run),
  ]);
  return mergeNeeds(needs);
}

/**
 * Construye una carencia a partir del escenario que la detectó.
 * @param {NeedKind} kind - De dónde sale la carencia.
 * @param {GarmentSlot} slot - Slot que falta.
 * @param {{ min: number; max: number }} range - Franja de formalidad que la resuelve.
 * @param {IScenarioRun} run - Escenario que la detectó.
 * @returns {INeed}
 */
function toNeed(
  kind: NeedKind,
  slot: GarmentSlot,
  range: { min: number; max: number },
  run: IScenarioRun,
): INeed {
  return {
    kind,
    slot,
    targetFormality: Math.round((range.min + range.max) / 2),
    minFormality: range.min,
    maxFormality: range.max,
    scenarioIds: [run.spec.id],
    temperatureC: run.spec.temperatureC,
  };
}

/**
 * Slots obligatorios sin ninguna prenda disponible: sin ellos no hay look.
 * @param {IScenarioRun} run - Escenario evaluado.
 * @returns {INeed[]}
 */
function missingSlotNeeds(run: IScenarioRun): INeed[] {
  const window = formalityWindowByStyleTag[run.spec.styleTag];
  return run.scenario.missingSlots.map(slot => toNeed('MISSING_SLOT', slot, window, run));
}

/**
 * Falta de abrigo cuando la temperatura sí lo pide.
 * @param {IScenarioRun} run - Escenario evaluado.
 * @returns {INeed[]}
 */
function layerNeeds(run: IScenarioRun): INeed[] {
  if (!run.scenario.needsLayer || run.scenario.hasLayer) {
    return [];
  }
  return [toNeed('LAYER', 'OUTERWEAR', formalityWindowByStyleTag[run.spec.styleTag], run)];
}

/**
 * El clóset arma conjuntos pero ninguno alcanza la ventana de formalidad del
 * estilo. Se acusa al slot cuyas prendas se quedan **todas** del lado corto: es
 * el que se puede arreglar comprando, y decirlo así nombra la prenda exacta.
 * @param {IScenarioRun} run - Escenario evaluado.
 * @returns {INeed[]}
 */
function formalityNeeds(run: IScenarioRun): INeed[] {
  const [best] = run.scored;
  if (!best || best.formalityGap < formalityGapWorthMentioning) {
    return [];
  }
  const window = formalityWindowByStyleTag[run.spec.styleTag];
  const isBelow = best.averageFormality < window.min;
  const target = isBelow ? window.min : window.max;
  const range = isBelow
    ? { min: target, max: maxFormality }
    : { min: minFormality, max: target };

  return coreNeedSlots
    .filter(slot => alwaysOffTarget(run.eligible, slot, target, isBelow))
    .map(slot => toNeed('FORMALITY', slot, range, run));
}

/**
 * Indica si todas las prendas disponibles de un slot se quedan del mismo lado de
 * la formalidad objetivo. Un slot vacío no cuenta: de ése ya se encarga
 * `missingSlotNeeds`.
 * @param {readonly Garment[]} eligible - Prendas que pasaron las reglas duras.
 * @param {GarmentSlot} slot - Slot a revisar.
 * @param {number} target - Formalidad objetivo.
 * @param {boolean} isBelow - True si al conjunto le falta formalidad.
 * @returns {boolean}
 */
function alwaysOffTarget(
  eligible: readonly Garment[],
  slot: GarmentSlot,
  target: number,
  isBelow: boolean,
): boolean {
  const inSlot = eligible.filter(garment => garment.slot === slot);
  if (inSlot.length === 0) {
    return false;
  }
  return isBelow
    ? inSlot.every(garment => garment.formality < target)
    : inSlot.every(garment => garment.formality > target);
}

/**
 * Une las carencias que piden lo mismo, quedándose con la temperatura más
 * exigente y con todos los escenarios que las reclamaron.
 * @param {readonly INeed[]} needs - Carencias sueltas, una por escenario.
 * @returns {INeed[]}
 */
function mergeNeeds(needs: readonly INeed[]): INeed[] {
  const merged = new Map<string, INeed>();
  for (const need of needs) {
    const key = `${need.kind}:${need.slot}:${need.minFormality}:${need.maxFormality}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...need, scenarioIds: [...need.scenarioIds] });
    } else {
      current.scenarioIds.push(...need.scenarioIds);
      current.temperatureC = Math.min(current.temperatureC, need.temperatureC);
    }
  }
  return [...merged.values()].sort(
    (first, second) => second.scenarioIds.length - first.scenarioIds.length,
  );
}

/**
 * Traduce una carencia a prendas concretas del catálogo, con su color.
 * @param {INeed} need - Carencia detectada.
 * @param {IHypothesisContext} context - Clóset, catálogo y escenarios.
 * @returns {IHypothesisDraft[]}
 */
function toDrafts(need: INeed, context: IHypothesisContext): IHypothesisDraft[] {
  return pickTypes(need, context).flatMap(type => {
    const color = pickColor(type.slot, context);
    return color === null ? [] : [{ type, need, ...color }];
  });
}

/**
 * Tipos del catálogo que encajan con la carencia: el slot que falta, cerca de la
 * formalidad objetivo y cómodos a esa temperatura. Se prefiere lo que el usuario
 * todavía no tiene: una categoría nueva abre más que un duplicado.
 * @param {INeed} need - Carencia detectada.
 * @param {IHypothesisContext} context - Clóset, catálogo y escenarios.
 * @returns {GarmentType[]}
 */
function pickTypes(need: INeed, context: IHypothesisContext): GarmentType[] {
  const avoided = new Set(context.input.profile.avoidedGarmentTypeIds);
  const owned = new Set(context.input.garments.map(garment => garment.garmentTypeId));

  const candidates = context.input.catalog
    .filter(type => type.slot === need.slot && !avoided.has(type.id))
    .filter(type => fitsTemperature(type, need.temperatureC));
  const withinRange = candidates.filter(
    type =>
      type.defaultFormality >= need.minFormality && type.defaultFormality <= need.maxFormality,
  );
  const pool = withinRange.length > 0 ? withinRange : candidates;

  return [...pool]
    .sort((first, second) => compareTypes(first, second, need.targetFormality, owned))
    .slice(0, maxTypesPerNeed);
}

/**
 * Ordena los tipos por cercanía a la formalidad objetivo, luego por novedad y
 * finalmente por el orden del catálogo, que es estable.
 * @param {GarmentType} first - Primer tipo.
 * @param {GarmentType} second - Segundo tipo.
 * @param {number} targetFormality - Formalidad objetivo.
 * @param {ReadonlySet<string>} owned - Tipos que el usuario ya tiene.
 * @returns {number}
 */
function compareTypes(
  first: GarmentType,
  second: GarmentType,
  targetFormality: number,
  owned: ReadonlySet<string>,
): number {
  const distance =
    Math.abs(first.defaultFormality - targetFormality) -
    Math.abs(second.defaultFormality - targetFormality);
  if (distance !== 0) {
    return distance;
  }
  const novelty = Number(owned.has(first.id)) - Number(owned.has(second.id));
  return novelty !== 0 ? novelty : first.sortOrder - second.sortOrder;
}

/**
 * Indica si el rango térmico por defecto del tipo admite esa temperatura, con el
 * mismo margen que aplica el motor a una prenda real.
 * @param {GarmentType} type - Tipo del catálogo.
 * @param {number} temperatureC - Temperatura del escenario.
 * @returns {boolean}
 */
function fitsTemperature(type: GarmentType, temperatureC: number): boolean {
  const { defaultWeatherMinC, defaultWeatherMaxC } = type;
  const warmEnough =
    defaultWeatherMinC === null || temperatureC >= defaultWeatherMinC - weatherToleranceC;
  const coolEnough =
    defaultWeatherMaxC === null || temperatureC <= defaultWeatherMaxC + weatherToleranceC;
  return warmEnough && coolEnough;
}

/**
 * Colores versátiles que el usuario no ha marcado como evitados.
 * @param {readonly string[]} avoidedColors - Colores que el usuario evita.
 * @returns {typeof versatileColors}
 */
export function allowedColors(avoidedColors: readonly string[]): typeof versatileColors {
  return versatileColors.filter(color => !matchesAvoidedColor(color.name, color.hex, avoidedColors));
}

/**
 * Elige el color de la prenda hipotética: el que mejor armoniza con lo que el
 * usuario ya tiene en los **otros** slots. Comparar contra el mismo slot no dice
 * nada —esa prenda no se lleva consigo misma— y así cada brecha sale con un color
 * pensado para su sitio en el conjunto.
 * @param {GarmentSlot} slot - Slot de la prenda hipotética.
 * @param {IHypothesisContext} context - Clóset, catálogo y escenarios.
 * @returns {{ colorHex: string; colorName: string } | null}
 */
function pickColor(
  slot: GarmentSlot,
  context: IHypothesisContext,
): { colorHex: string; colorName: string } | null {
  const palette = context.input.garments
    .filter(garment => garment.slot !== slot)
    .map(garment => garment.primaryColorHex);

  let best: { hex: string; name: string } | null = null;
  let bestScore = -1;
  for (const candidate of allowedColors(context.input.profile.avoidedColors)) {
    const score = harmonyScore([...palette, candidate.hex]).score;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best === null ? null : { colorHex: best.hex, colorName: best.name };
}

/**
 * Filtro que descarta hipótesis repetidas de tipo y color.
 * @returns {(draft: IHypothesisDraft) => boolean}
 */
function uniqueDrafts(): (draft: IHypothesisDraft) => boolean {
  const seen = new Set<string>();
  return draft => {
    const key = `${draft.type.id}:${draft.colorHex}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  };
}

/**
 * Indica si el usuario ya descartó esta misma brecha.
 * @param {IHypothesisDraft} draft - Prenda hipotética.
 * @param {IHypothesisContext} context - Clóset, catálogo y escenarios.
 * @returns {boolean}
 */
function isDismissed(draft: IHypothesisDraft, context: IHypothesisContext): boolean {
  return context.input.dismissed.some(
    gap => gap.garmentTypeId === draft.type.id && gap.colorHex === draft.colorHex,
  );
}

/**
 * Mete la prenda hipotética en el clóset, vuelve a pasar el motor por todos los
 * escenarios y cuenta la diferencia.
 * @param {IHypothesisDraft} draft - Prenda hipotética.
 * @param {number} index - Posición, para el id sintético de la prenda.
 * @param {IHypothesisContext} context - Clóset, catálogo y escenarios.
 * @returns {GapHypothesis}
 */
function evaluate(
  draft: IHypothesisDraft,
  index: number,
  context: IHypothesisContext,
): GapHypothesis {
  const measured = measureGarmentImpact(context, toHypotheticalGarment(draft, index));
  const required = draft.need.kind === 'MISSING_SLOT';
  return {
    scoreGain: measured.scoreGain,
    newlyCoveredScenarioIds: measured.newlyCoveredScenarioIds,
    unlockedOutfitsEstimate: measured.unlockedOutfitsEstimate,
    id: toHypothesisShortId(index),
    garmentTypeId: draft.type.id,
    garmentTypeSlug: draft.type.slug,
    garmentTypeName: draft.type.name,
    slot: draft.type.slot,
    colorHex: draft.colorHex,
    colorName: draft.colorName,
    formality: draft.type.defaultFormality,
    priorityScore: toPriorityScore(measured) + (required ? requiredPriorityBonus : 0),
    rationale: describe(draft, measured, context),
  };
}

/**
 * Prioridad calculada: cubrir un escenario que hoy no da nada pesa mucho más que
 * añadir una combinación a uno que ya funcionaba.
 * @param {IGarmentImpact} measured - Medidas del motor.
 * @returns {number}
 */
function toPriorityScore(measured: IGarmentImpact): number {
  return (
    measured.newlyCoveredScenarioIds.length * priorityWeights.newlyCoveredScenario +
    measured.unlockedOutfitsEstimate * priorityWeights.unlockedOutfit +
    measured.scoreGain * priorityWeights.scoreGainPoint
  );
}

/**
 * Indica si la prenda hipotética aporta lo bastante como para proponer una
 * compra. Lo que no desbloquea nada ni mejora ningún conjunto no es una brecha.
 *
 * Un slot vacío es la excepción y tiene que serlo: con el clóset a medias
 * ninguna prenda **suelta** desbloquea nada —hacen falta las tres a la vez— y
 * medir eso literalmente diría que no hay nada que comprar.
 * @param {GapHypothesis} hypothesis - Prenda hipotética ya evaluada.
 * @param {INeed} need - Carencia que la propuso.
 * @returns {boolean}
 */
function isWorthBuying(hypothesis: GapHypothesis, need: INeed): boolean {
  return (
    need.kind === 'MISSING_SLOT' ||
    hypothesis.unlockedOutfitsEstimate > 0 ||
    hypothesis.newlyCoveredScenarioIds.length > 0 ||
    hypothesis.scoreGain >= minScoreGainPoints
  );
}

/**
 * Redacta por qué el cálculo propuso la prenda, con sus números.
 * @param {IHypothesisDraft} draft - Prenda hipotética.
 * @param {IGarmentImpact} measured - Medidas del motor.
 * @param {IHypothesisContext} context - Clóset, catálogo y escenarios.
 * @returns {string}
 */
function describe(
  draft: IHypothesisDraft,
  measured: IGarmentImpact,
  context: IHypothesisContext,
): string {
  const parts: string[] = [];
  if (measured.unlockedOutfitsEstimate > 0) {
    parts.push(`abre ${measured.unlockedOutfitsEstimate} conjunto(s) que hoy no puedes armar`);
  }
  const covered = labelsOf(measured.newlyCoveredScenarioIds, context);
  if (covered.length > 0) {
    parts.push(`deja de dejarte sin nada para ${covered.join(' y ')}`);
  }
  if (measured.scoreGain > 0) {
    parts.push(`sube ${measured.scoreGain} puntos la nota del mejor conjunto`);
  }
  const slotLabel = enumLabels.garmentSlot[draft.type.slot].toLowerCase();
  const formality = formalityLabel(draft.type.defaultFormality).toLowerCase();
  const head = `Como ${slotLabel} de formalidad ${formality}`;
  if (parts.length > 0) {
    return `${head}, ${parts.join('; ')}.`;
  }
  if (draft.need.kind === 'MISSING_SLOT') {
    return `${head}, cubre un hueco obligatorio: hoy no tienes ninguna prenda de ${slotLabel} y sin ella no se puede armar ningún look.`;
  }
  return `${head}, completa la franja de formalidad que hoy no alcanzas.`;
}

/**
 * Etiquetas de los escenarios indicados.
 * @param {readonly string[]} scenarioIds - Escenarios a nombrar.
 * @param {IHypothesisContext} context - Clóset, catálogo y escenarios.
 * @returns {string[]}
 */
function labelsOf(scenarioIds: readonly string[], context: IHypothesisContext): string[] {
  return context.runs
    .filter(run => scenarioIds.includes(run.spec.id))
    .map(run => run.spec.label.toLowerCase());
}

/**
 * Construye la prenda que el motor va a tratar como real. Nace confirmada y
 * disponible porque representa una compra hecha, no un borrador: si naciera sin
 * confirmar, el motor la descartaría y el análisis mediría siempre cero.
 * @param {IHypothesisDraft} draft - Prenda hipotética.
 * @param {number} index - Posición, para el id sintético.
 * @returns {Garment}
 */
function toHypotheticalGarment(draft: IHypothesisDraft, index: number): Garment {
  const suffix = String(index + 1).padStart(hypotheticalGarmentIdDigits, '0');
  return {
    id: `${hypotheticalGarmentIdPrefix}${suffix}`,
    name: `${draft.type.name} ${draft.colorName.toLowerCase()}`,
    slot: draft.type.slot,
    garmentTypeId: draft.type.id,
    garmentTypeName: draft.type.name,
    primaryColorHex: draft.colorHex,
    primaryColorName: draft.colorName,
    secondaryColorHex: null,
    pattern: 'SOLID',
    patternScale: 'NONE',
    material: 'OTHER',
    fit: 'REGULAR',
    formality: draft.type.defaultFormality,
    seasons: [...draft.type.typicalSeasons],
    weatherMinC: draft.type.defaultWeatherMinC,
    weatherMaxC: draft.type.defaultWeatherMaxC,
    brand: null,
    brandGuess: null,
    size: null,
    taggingStatus: 'CONFIRMED',
    status: 'ACTIVE',
    ownership: 'OWNED',
    wearCount: 0,
    lastWornAt: null,
    createdAt: new Date(0).toISOString(),
    photos: [],
    tagging: {
      status: 'CONFIRMED',
      version: null,
      taggedAt: null,
      model: null,
      jobStatus: null,
      attempts: 0,
      canRetry: false,
      costUsd: null,
      errorMessage: null,
      manualFields: [],
      reviewFields: [],
      personVisible: false,
      usableForTagging: true,
      unusableReason: null,
      notes: null,
    },
  };
}
