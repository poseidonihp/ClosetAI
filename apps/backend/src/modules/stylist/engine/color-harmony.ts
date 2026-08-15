import { colorFamilyFromHex, colorFamilyLabels, hexToHsl, type IHsl } from '@closetai/shared-types';
import {
  analogousMaxHueDistance,
  analogousPairScore,
  clashingPairScore,
  complementaryMinHueDistance,
  complementaryPairScore,
  extraFamilyPenalty,
  highSaturation,
  highSaturationPenalty,
  hueHalfTurnDegrees,
  hueTurnDegrees,
  maxChromaticFamilies,
  neutralColorFamilies,
  neutralMaxLightness,
  neutralMaxSaturation,
  neutralMinLightness,
  triadicMinHueDistance,
  triadicPairScore,
} from './engine.constants';
import { clampScore } from './score-utils';

/**
 * Armonía de color del conjunto, calculada sobre HSL completo.
 */

export interface IColorHarmony {
  /** 0–1. */
  score: number;
  reason: string;
}

interface IColorSample {
  hex: string;
  hsl: IHsl;
}

/** Nombre en español de una relación entre dos tonos, para explicar la nota. */
const relationLabels = {
  analogous: 'tonos vecinos',
  complementary: 'contraste complementario',
  triadic: 'contraste medio',
  clashing: 'tonos que compiten',
} as const;

type ColorRelation = keyof typeof relationLabels;

const pairScoreByRelation = {
  analogous: analogousPairScore,
  complementary: complementaryPairScore,
  triadic: triadicPairScore,
  clashing: clashingPairScore,
} as const satisfies Record<ColorRelation, number>;

/**
 * Indica si un color se comporta como neutro: sin saturación propia, tan oscuro
 * o tan claro que combina con cualquier cosa, o de una familia que en ropa
 * funciona como neutra aunque su HSL diga lo contrario.
 * @param {string} hex - Color en formato `#rrggbb`.
 * @returns {boolean}
 */
export function isNeutralColor(hex: string): boolean {
  const family = colorFamilyFromHex(hex);
  if (family && neutralColorFamilies.includes(family)) {
    return true;
  }
  const hsl = hexToHsl(hex);
  if (!hsl) {
    return false;
  }
  return (
    hsl.saturation <= neutralMaxSaturation ||
    hsl.lightness <= neutralMaxLightness ||
    hsl.lightness >= neutralMinLightness
  );
}

/**
 * Puntúa la paleta de un conjunto y explica de dónde sale la nota.
 * @param {readonly string[]} hexes - Colores del conjunto en formato `#rrggbb`.
 * @returns {IColorHarmony}
 */
export function harmonyScore(hexes: readonly string[]): IColorHarmony {
  const samples = toSamples(hexes);
  const chromatic = samples.filter(sample => !isNeutralColor(sample.hex));

  if (chromatic.length === 0) {
    return { score: 1, reason: 'Paleta completamente neutra: todo combina con todo.' };
  }
  const [onlyColor] = chromatic;
  if (chromatic.length === 1 && onlyColor) {
    return {
      score: 1,
      reason: `Base neutra con un solo color protagonista (${familyLabel(onlyColor.hex)}).`,
    };
  }
  return scoreChromaticPalette(chromatic);
}

/**
 * Convierte los hex válidos en muestras con su HSL, descartando lo que no lo sea.
 * @param {readonly string[]} hexes - Colores del conjunto.
 * @returns {IColorSample[]}
 */
function toSamples(hexes: readonly string[]): IColorSample[] {
  return hexes
    .map(hex => ({ hex, hsl: hexToHsl(hex) }))
    .filter((sample): sample is IColorSample => sample.hsl !== null);
}

/**
 * Puntúa una paleta con dos o más colores con tono propio. Manda el peor par: un
 * choque entre dos prendas no lo arregla que las demás casen bien.
 * @param {readonly IColorSample[]} chromatic - Colores con tono propio.
 * @returns {IColorHarmony}
 */
function scoreChromaticPalette(chromatic: readonly IColorSample[]): IColorHarmony {
  let worstScore = 1;
  let worstRelation: ColorRelation = 'analogous';
  let worstPair: readonly [IColorSample, IColorSample] | null = null;

  for (const [left, right] of toPairs(chromatic)) {
    const pair = scorePair(left, right);
    if (pair.score < worstScore) {
      worstScore = pair.score;
      worstRelation = pair.relation;
      worstPair = [left, right];
    }
  }

  const families = new Set(chromatic.map(sample => colorFamilyFromHex(sample.hex)));
  const extraFamilies = Math.max(0, families.size - maxChromaticFamilies);
  const score = clampScore(worstScore - extraFamilies * extraFamilyPenalty);
  return { score, reason: describePalette(worstPair, worstRelation, extraFamilies) };
}

/**
 * Todos los pares distintos de una lista, sin repetir ni emparejar un color
 * consigo mismo.
 * @param {readonly IColorSample[]} samples - Colores con tono propio.
 * @returns {[IColorSample, IColorSample][]}
 */
function toPairs(samples: readonly IColorSample[]): [IColorSample, IColorSample][] {
  return samples.flatMap((left, index) =>
    samples.slice(index + 1).map((right): [IColorSample, IColorSample] => [left, right]),
  );
}

/**
 * Puntúa la relación entre dos colores con tono propio.
 * @param {IColorSample} left - Primer color.
 * @param {IColorSample} right - Segundo color.
 * @returns {{ score: number; relation: ColorRelation }}
 */
function scorePair(
  left: IColorSample,
  right: IColorSample,
): { score: number; relation: ColorRelation } {
  const relation = resolveRelation(hueDistance(left.hsl.hue, right.hsl.hue));
  const bothSaturated =
    left.hsl.saturation >= highSaturation && right.hsl.saturation >= highSaturation;
  const penalty = bothSaturated ? highSaturationPenalty : 0;
  return { score: clampScore(pairScoreByRelation[relation] - penalty), relation };
}

/**
 * Clasifica la separación entre dos tonos en una relación cromática.
 * @param {number} distance - Distancia de tono en grados, 0–180.
 * @returns {ColorRelation}
 */
function resolveRelation(distance: number): ColorRelation {
  if (distance <= analogousMaxHueDistance) {
    return 'analogous';
  }
  if (distance >= complementaryMinHueDistance) {
    return 'complementary';
  }
  return distance >= triadicMinHueDistance ? 'triadic' : 'clashing';
}

/**
 * Distancia circular entre dos tonos: 350° y 10° están a 20°, no a 340°.
 * @param {number} first - Primer tono en grados.
 * @param {number} second - Segundo tono en grados.
 * @returns {number}
 */
export function hueDistance(first: number, second: number): number {
  const raw = Math.abs(first - second) % hueTurnDegrees;
  return raw > hueHalfTurnDegrees ? hueTurnDegrees - raw : raw;
}

/**
 * Redacta de dónde sale la nota de color.
 * @param {readonly [IColorSample, IColorSample] | null} pair - Par que marcó la nota.
 * @param {ColorRelation} relation - Relación de ese par.
 * @param {number} extraFamilies - Familias cromáticas por encima del máximo.
 * @returns {string}
 */
function describePalette(
  pair: readonly [IColorSample, IColorSample] | null,
  relation: ColorRelation,
  extraFamilies: number,
): string {
  if (!pair) {
    return 'Paleta sin relaciones que evaluar.';
  }
  const [left, right] = pair;
  const base = `${familyLabel(left.hex)} y ${familyLabel(right.hex)}: ${relationLabels[relation]}.`;
  return extraFamilies > 0 ? `${base} La paleta suma demasiados colores distintos.` : base;
}

/**
 * Nombre en español de la familia de un color; el hex si no se puede clasificar.
 * @param {string} hex - Color en formato `#rrggbb`.
 * @returns {string}
 */
export function familyLabel(hex: string): string {
  const family = colorFamilyFromHex(hex);
  return family ? colorFamilyLabels[family].toLowerCase() : hex;
}
