import { z } from 'zod';

/**
 * Color de prenda: hex validado y familia derivada.
 *
 * La familia existe para **filtrar el clóset** ("enséñame lo azul") sin añadir
 * una columna que se pueda desincronizar del hex. No es la puntuación de armonía
 * de color del motor de la Fase 2, que trabaja sobre HSL completo y vive en el
 * módulo `stylist`.
 */

const hexColorPattern = /^#[0-9a-fA-F]{6}$/;

export const HexColorSchema = z
  .string()
  .regex(hexColorPattern, 'Color inválido: usa formato #rrggbb')
  .transform(hex => hex.toLowerCase());
export type HexColor = z.infer<typeof HexColorSchema>;

export const ColorFamilyEnum = z.enum([
  'BLACK',
  'WHITE',
  'GRAY',
  'BEIGE',
  'BROWN',
  'RED',
  'ORANGE',
  'YELLOW',
  'GREEN',
  'BLUE',
  'PURPLE',
  'PINK',
]);
export type ColorFamily = z.infer<typeof ColorFamilyEnum>;

export const colorFamilyLabels = {
  BLACK: 'Negro',
  WHITE: 'Blanco',
  GRAY: 'Gris',
  BEIGE: 'Beige',
  BROWN: 'Marrón',
  RED: 'Rojo',
  ORANGE: 'Naranja',
  YELLOW: 'Amarillo',
  GREEN: 'Verde',
  BLUE: 'Azul',
  PURPLE: 'Morado',
  PINK: 'Rosa',
} as const satisfies Record<ColorFamily, string>;

/** Hex representativo de cada familia, para pintar el chip del filtro. */
export const colorFamilySwatches = {
  BLACK: '#1a1815',
  WHITE: '#f7f5f0',
  GRAY: '#8b8b8b',
  BEIGE: '#d8c9ae',
  BROWN: '#6b4a2f',
  RED: '#b53c3c',
  ORANGE: '#d2762b',
  YELLOW: '#d9b430',
  GREEN: '#4a7c50',
  BLUE: '#3a5f96',
  PURPLE: '#6b4a8f',
  PINK: '#c9789a',
} as const satisfies Record<ColorFamily, string>;

export interface IHsl {
  /** Tono en grados, 0–360. */
  hue: number;
  /** Saturación 0–1. */
  saturation: number;
  /** Luminosidad 0–1. */
  lightness: number;
}

const maxChannelValue = 255;
const hexRadix = 16;
const redStart = 1;
const greenStart = 3;
const blueStart = 5;
const channelLength = 2;
const degreesPerTurn = 360;
const degreesPerSector = 60;
const sectorsPerTurn = 6;

// Umbrales de clasificación. Se ajustan aquí y en ningún otro sitio.
const blackMaxLightness = 0.13;
const whiteMinLightness = 0.9;
const neutralMaxSaturation = 0.12;
// Un crudo o un marfil salen del cálculo con bastante saturación pese a leerse
// como blanco roto. Este margen los mantiene en BLANCO sin arrastrar un pastel
// saturado —un rosa palo, por ejemplo— que sí tiene color propio.
const offWhiteMaxSaturation = 0.45;
const beigeMaxSaturation = 0.4;
const beigeMinLightness = 0.62;
const brownMaxLightness = 0.42;

// Cortes de tono en grados. El rojo envuelve el 0°, por eso abre y cierra la
// rueda: cuanto queda por encima de `pinkUpperHue` vuelve a ser rojo.
const redUpperHue = 15;
const yellowUpperHue = 68;
const pinkUpperHue = 345;

/** Familia por sector de tono, en orden ascendente. El último cubre hasta 360°. */
const familyByHueSector: readonly { upperHue: number; family: ColorFamily }[] = [
  { upperHue: redUpperHue, family: 'RED' },
  { upperHue: 45, family: 'ORANGE' },
  { upperHue: yellowUpperHue, family: 'YELLOW' },
  { upperHue: 168, family: 'GREEN' },
  { upperHue: 258, family: 'BLUE' },
  { upperHue: 292, family: 'PURPLE' },
  { upperHue: pinkUpperHue, family: 'PINK' },
  { upperHue: degreesPerTurn, family: 'RED' },
];

/**
 * Lee un canal del hex y lo normaliza a 0–1.
 * @param {string} hex - Color en formato `#rrggbb`.
 * @param {number} start - Índice donde empieza el canal.
 * @returns {number}
 */
function readChannel(hex: string, start: number): number {
  return Number.parseInt(hex.slice(start, start + channelLength), hexRadix) / maxChannelValue;
}

/**
 * Convierte un hex `#rrggbb` a HSL. Devuelve null si el hex no es válido.
 * @param {string} hex - Color en formato `#rrggbb`.
 * @returns {IHsl | null}
 */
export function hexToHsl(hex: string): IHsl | null {
  if (!hexColorPattern.test(hex)) {
    return null;
  }
  const red = readChannel(hex, redStart);
  const green = readChannel(hex, greenStart);
  const blue = readChannel(hex, blueStart);

  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;

  if (delta === 0) {
    return { hue: 0, saturation: 0, lightness };
  }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const hue = resolveHue({ red, green, blue, max, delta });
  return { hue, saturation, lightness };
}

/**
 * Clasifica un color en su familia para el filtro del clóset.
 * @param {string} hex - Color en formato `#rrggbb`.
 * @returns {ColorFamily | null}
 */
export function colorFamilyFromHex(hex: string): ColorFamily | null {
  const hsl = hexToHsl(hex);
  if (!hsl) {
    return null;
  }
  const neutral = resolveNeutralFamily(hsl);
  if (neutral) {
    return neutral;
  }
  return resolveChromaticFamily(hsl);
}

/**
 * Devuelve la familia acromática (negro, blanco o gris) si el color lo es.
 * @param {IHsl} hsl - Color en HSL.
 * @returns {ColorFamily | null}
 */
function resolveNeutralFamily(hsl: IHsl): ColorFamily | null {
  if (hsl.lightness <= blackMaxLightness) {
    return 'BLACK';
  }
  if (hsl.lightness >= whiteMinLightness && hsl.saturation <= offWhiteMaxSaturation) {
    return 'WHITE';
  }
  return hsl.saturation <= neutralMaxSaturation ? 'GRAY' : null;
}

/**
 * Clasifica un color con tono reconocible. Los cálidos apagados caen en beige o
 * marrón antes de mirar el tono, porque ahí es donde vive medio clóset real.
 * @param {IHsl} hsl - Color en HSL.
 * @returns {ColorFamily}
 */
function resolveChromaticFamily(hsl: IHsl): ColorFamily {
  const isWarmHue = hsl.hue >= redUpperHue && hsl.hue < yellowUpperHue;
  if (isWarmHue && hsl.lightness <= brownMaxLightness) {
    return 'BROWN';
  }
  if (isWarmHue && hsl.saturation <= beigeMaxSaturation && hsl.lightness >= beigeMinLightness) {
    return 'BEIGE';
  }
  const sector = familyByHueSector.find(candidate => hsl.hue < candidate.upperHue);
  return sector?.family ?? 'RED';
}

interface IHueInput {
  red: number;
  green: number;
  blue: number;
  max: number;
  delta: number;
}

/**
 * Calcula el tono en grados a partir de los canales normalizados.
 * @param {IHueInput} input - Canales RGB, máximo y delta ya calculados.
 * @returns {number}
 */
function resolveHue(input: IHueInput): number {
  const { red, green, blue, max, delta } = input;
  // Fórmula estándar RGB → tono: el canal dominante fija el sector de 60° y el
  // desbalance de los otros dos la posición dentro de él.
  const greenSectorOffset = 2;
  const blueSectorOffset = 4;
  let sixths: number;
  if (max === red) {
    sixths = (green - blue) / delta;
  } else if (max === green) {
    sixths = (blue - red) / delta + greenSectorOffset;
  } else {
    sixths = (red - green) / delta + blueSectorOffset;
  }
  const degrees = (sixths % sectorsPerTurn) * degreesPerSector;
  return (degrees + degreesPerTurn) % degreesPerTurn;
}
