import type {
  ColorFamily,
  GarmentSlot,
  LookOccasion,
  LookScoreSignal,
  PatternScale,
  StyleArchetype,
} from '@closetai/shared-types';

/**
 * Versión del motor. Sube cuando cambian reglas, pesos o umbrales: es lo que
 * permite comparar la salida de dos versiones sobre el mismo clóset.
 *
 * - `engine-v1`: Fase 2, seis señales.
 * - `engine-v2`: Fase 4, añade la señal `PREFERENCE` (el bucle de aprendizaje) y
 *   rebalancea los pesos para hacerle sitio.
 * - `engine-v3`: capas y accesorios entran de otra forma. Antes una prenda opcional
 *   sólo entraba si **subía** la nota, y eso dejaba conjuntos sin chaqueta a 15 °C
 *   —el premio por capas no compensaba el color que añadía— y sin ningún accesorio
 *   nunca, porque un accesorio neutro deja la nota igual y "igual" no es "mejor".
 */
export const engineVersion = 'engine-v3';

export interface IFormalityWindow {
  min: number;
  max: number;
}

/**
 * Ventana de formalidad de cada estilo en la escala 1–5 de la prenda. No es una
 * regla dura: un clóset que no la alcanza produce igual su mejor conjunto, y el
 * motor lo dice en las notas en vez de prometer algo que no es.
 */
export const formalityWindowByStyleTag = {
  MINIMALIST: { min: 2, max: 4 },
  SMART_CASUAL: { min: 3, max: 4 },
  CLASSIC: { min: 4, max: 5 },
  STREETWEAR: { min: 1, max: 3 },
  BOHO: { min: 2, max: 4 },
  ROMANTIC: { min: 2, max: 4 },
  ANDROGYNOUS: { min: 2, max: 4 },
  SPORTY: { min: 1, max: 2 },
} as const satisfies Record<StyleArchetype, IFormalityWindow>;

/** Frase fija de cada estilo. Describe el estilo pedido, no las prendas. */
export const oneLinerByStyleTag = {
  MINIMALIST: 'Sencillo, funcional y atemporal.',
  SMART_CASUAL: 'Equilibrio entre lo formal y lo relajado.',
  CLASSIC: 'Líneas clásicas y acabados cuidados.',
  STREETWEAR: 'Relajado, con volumen y actitud de calle.',
  BOHO: 'Suelto, con textura y aire artesanal.',
  ROMANTIC: 'Suave, con caída y detalles delicados.',
  ANDROGYNOUS: 'Cortes rectos y neutros, sin marcar género.',
  SPORTY: 'Cómodo y listo para moverse.',
} as const satisfies Record<StyleArchetype, string>;

/**
 * Peso de cada señal en el `engineScore`. Suman 1 para que la nota final quede
 * en 0–1 antes de escalarla a 0–100.
 */
export const scoreWeights = {
  FORMALITY: 0.25,
  COLOR: 0.2,
  WEATHER: 0.16,
  FIT: 0.14,
  PATTERN: 0.08,
  FRESHNESS: 0.07,
  PREFERENCE: 0.1,
} as const satisfies Record<LookScoreSignal, number>;

export const maxEngineScore = 100;

/** Distancia máxima posible a una ventana de formalidad, en niveles. */
export const maxFormalityDistance = 4;
/**
 * A partir de aquí el conjunto ya no representa el estilo pedido y hay que
 * decirlo en las notas, aunque se devuelva igualmente como mejor opción.
 */
export const formalityGapWorthMentioning = 0.5;

/**
 * Margen sobre el rango declarado de la prenda antes de descartarla por clima.
 * Una camiseta cómoda hasta 16 °C no es absurda a 13 °C bajo un suéter.
 */
export const weatherToleranceC = 4;
/** Puntuación climática cuando no hay temperatura: no hay dato que juzgar. */
export const neutralWeatherScore = 0.7;
/** Por debajo de esta temperatura una capa media suma. */
export const layeringTemperatureC = 18;
/** Por debajo de esta temperatura falta abrigo si no hay OUTERWEAR. */
export const outerwearTemperatureC = 12;
export const layeringBonus = 0.15;
export const missingOuterwearPenalty = 0.35;

export const millisecondsPerDay = 86_400_000;
/** Una prenda usada hace menos de estos días penaliza por repetición. */
export const recentlyWornDays = 7;
export const recentWearPenalty = 0.3;
/** Usos a partir de los cuales una prenda se considera muy repetida. */
export const wearCountReference = 20;
export const wearCountPenalty = 0.2;

/**
 * Punto de partida de la señal de preferencias antes de aplicar el historial.
 */
export const neutralPreferenceScore = 0.75;
/** Volver a proponer el conjunto exacto que el usuario rechazó. */
export const rejectedSetPenalty = 0.75;
/** Conjunto ya propuesto antes que el usuario no rechazó: repetirlo aporta poco. */
export const alreadyGeneratedPenalty = 0.2;
/** Repetir la combinación de colores de un rechazo por color. */
export const rejectedColorPenalty = 0.3;
/** Repetir la formalidad de un rechazo por demasiado formal o demasiado casual. */
export const rejectedFormalityPenalty = 0.25;
/** Repetir los cortes de un rechazo por incómodo. */
export const rejectedFitPenalty = 0.2;
/** Por cada prenda que aparece en algún look rechazado, con tope. */
export const rejectedGarmentPenalty = 0.12;
export const maxRejectedGarmentPenalty = 0.3;
/** Premio máximo: el núcleo entero sale de looks marcados como favoritos o usados. */
export const likedGarmentBonus = 0.25;

/** Escalas que hacen que un estampado se lea como llamativo. */
export const loudPatternScales: readonly PatternScale[] = ['MEDIUM', 'LARGE'];
const noLoudPatternScore = 1;
const oneLoudPatternScore = 0.9;
const twoLoudPatternsScore = 0.45;
const manyLoudPatternsScore = 0.15;
/** Puntuación por número de estampados llamativos en el conjunto: 0, 1, 2, 3+. */
export const patternScoreByLoudCount: readonly number[] = [
  noLoudPatternScore,
  oneLoudPatternScore,
  twoLoudPatternsScore,
  manyLoudPatternsScore,
];

/** Punto de partida del ajuste antes de aplicar las reglas de `fit-rules`. */
export const neutralFitScore = 0.6;
export const shortHeightCm = 170;
export const tallHeightCm = 185;
/** Diferencia hombro–cadera, en cm, a partir de la cual la regla dice algo. */
export const balanceDifferenceCm = 8;
export const preferredFitBonus = 0.3;
export const preferredFitPenalty = 0.25;
export const volumeBalanceDelta = 0.2;
export const heightProportionDelta = 0.15;
export const measurementBalanceDelta = 0.1;
/** Prendas holgadas a la vez a partir de las cuales el volumen se acumula. */
export const loosePiecesBeforePenalty = 2;

/** Por debajo de esta saturación el color se comporta como neutro. */
export const neutralMaxSaturation = 0.18;
/** Un color casi negro o casi blanco también se comporta como neutro. */
export const neutralMaxLightness = 0.12;
export const neutralMinLightness = 0.92;
/**
 * Familias que en ropa se comportan como neutras aunque el HSL diga otra cosa.
 */
export const neutralColorFamilies: readonly ColorFamily[] = ['BLACK', 'WHITE', 'GRAY', 'BEIGE'];
/** Grados de separación de tono que se leen como análogos. */
export const analogousMaxHueDistance = 35;
/** Banda complementaria: tonos opuestos que contrastan de forma legible. */
export const complementaryMinHueDistance = 150;
/** Puntuación de cada relación entre dos colores con tono propio. */
export const analogousPairScore = 0.9;
export const complementaryPairScore = 0.8;
export const triadicPairScore = 0.55;
export const clashingPairScore = 0.35;
/** Fuera de estas bandas la relación se considera un choque. */
export const triadicMinHueDistance = 100;
/** Dos colores muy saturados a la vez cansan aunque su tono case. */
export const highSaturation = 0.6;
export const highSaturationPenalty = 0.15;
/** Más familias cromáticas que esto y la paleta se dispersa. */
export const maxChromaticFamilies = 3;
export const extraFamilyPenalty = 0.12;
/** Grados de una vuelta completa y de media vuelta, para la distancia de tono. */
export const hueTurnDegrees = 360;
export const hueHalfTurnDegrees = 180;

/**
 * Peso de cada señal en la **preselección** por prenda, la que decide qué entra
 * en la enumeración. Es una versión barata de la puntuación del conjunto: sólo
 * mira la prenda suelta, porque todavía no hay conjunto que mirar.
 */
export const prescoreWeights = {
  formality: 0.6,
  weather: 0.25,
  freshness: 0.15,
} as const;

/** Puntuación climática de una prenda fuera de su rango pero dentro del margen. */
export const prescoreOutOfRangeScore = 0.5;

/** Prendas por slot que entran en la enumeración, ordenadas por su preselección. */
export const maxPoolPerSlot = 12;
/** Tope de conjuntos base enumerados antes de declarar truncamiento. */
export const maxCoreCombinations = 600;
/** Conjuntos base que sobreviven para recibir capas y accesorios. */
export const beamWidth = 24;
/** Candidatos puntuados que se conservan; de ellos sale lo que se manda al LLM. */
export const maxScoredCandidates = 40;
export const maxLayersPerOutfit = 2;
export const maxAccessoriesPerOutfit = 2;
/**
 * Cuánto puede bajar la nota una prenda opcional y entrar igualmente.
 *
 * Exigir que **suba** la nota deja fuera todo lo que la deja igual, y eso es
 * justamente lo que hace un accesorio bien elegido: un reloj o unas gafas no
 * mejoran la armonía de color ni la formalidad, sólo evitan estropearlas. El
 * margen es estrecho a propósito: un estampado que choca cae mucho más que esto.
 */
export const optionalPieceTolerance = 0.02;

export const maxStyleNotes = 5;
export const maxPaletteColors = 6;
export const maxOccasions = 3;
/** Colores que se nombran en el título del look. */
export const maxTitleColors = 2;

/** Orden en el que se listan las prendas de un look, como en un lookbook. */
export const slotDisplayOrder: readonly GarmentSlot[] = [
  'OUTERWEAR',
  'MID_LAYER',
  'TOP',
  'FULL_BODY',
  'BOTTOM',
  'FOOTWEAR',
  'ACCESSORY',
];

/**
 * Ocasiones por banda de formalidad media del conjunto. Se recorre de arriba
 * abajo y gana la primera banda que el conjunto alcanza.
 */
export const occasionBands: readonly {
  minFormality: number;
  occasions: readonly LookOccasion[];
}[] = [
  { minFormality: 4.5, occasions: ['EVENT', 'DINNER', 'WORK'] },
  { minFormality: 3.5, occasions: ['WORK', 'DINNER', 'CASUAL_OUTING'] },
  { minFormality: 2.5, occasions: ['WORK', 'CASUAL_OUTING', 'DAILY'] },
  { minFormality: 0, occasions: ['DAILY', 'CASUAL_OUTING', 'TRAVEL'] },
];

/** Ocasión que añade el estilo pedido por encima de su banda de formalidad. */
export const additionalOccasionByStyleTag: Partial<Record<StyleArchetype, LookOccasion>> = {
  SPORTY: 'SPORT',
};
