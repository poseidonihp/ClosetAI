import type { StyleArchetype } from '@closetai/shared-types';

/**
 * Umbrales del análisis de cobertura. Viven aquí y en ningún otro sitio, igual
 * que los del motor: son los que deciden qué se considera una brecha.
 */

/**
 * Estilos que se evalúan cuando el usuario no declaró ninguno. Cubren la escala
 * de formalidad de punta a punta —casual, intermedio y formal—, que es lo que
 * hace visible el hueco de "no tienes nada para una cena".
 */
export const defaultScenarioStyleTags: readonly StyleArchetype[] = [
  'MINIMALIST',
  'SMART_CASUAL',
  'CLASSIC',
];

/** Estilos del perfil que entran en la matriz. Más allá el análisis se dispara. */
export const maxScenarioStyleTags = 3;

/** Temperatura de referencia cuando el perfil no declara clima. */
export const defaultScenarioTemperatureC = 22;
/**
 * Segunda banda térmica cuando la del usuario es templada o cálida. Está por
 * debajo del umbral de capa del motor a propósito: una noche fresca es el
 * escenario donde falta el abrigo, y sin evaluarlo la brecha no aparece nunca.
 */
export const coolScenarioTemperatureC = 12;
/** Segunda banda cuando la del usuario ya es fría: el día templado que también existe. */
export const warmScenarioTemperatureC = 24;

/** Escenarios de la matriz. Estilos por bandas térmicas, con tope. */
export const maxScenarios = 6;

/**
 * Colores versátiles entre los que se elige el de una prenda hipotética. Es una
 * lista corta y neutra a propósito: la brecha se propone para desbloquear
 * conjuntos, y un color que choca con medio clóset no desbloquea nada. El orden
 * desempata cuando dos puntúan igual.
 */
export const versatileColors: readonly { hex: string; name: string }[] = [
  { hex: '#1a1815', name: 'Negro' },
  { hex: '#2c3e57', name: 'Azul marino' },
  { hex: '#d8c9ae', name: 'Beige' },
  { hex: '#8b8b8b', name: 'Gris' },
  { hex: '#f5f1e8', name: 'Blanco' },
  { hex: '#4a4a3f', name: 'Verde oliva' },
];

/** Tipos del catálogo que se prueban por cada necesidad detectada. */
export const maxTypesPerNeed = 2;
/**
 * Prendas hipotéticas que se llegan a evaluar. Cada una cuesta una pasada del
 * motor por escenario, así que el tope acota el análisis a algo que cabe dentro
 * de una petición HTTP.
 */
export const maxHypotheses = 8;
/** Brechas que se le mandan al modelo para que ordene y redacte. */
export const maxRankedHypotheses = 5;

/**
 * Puntos de nota que tiene que ganar una prenda que no desbloquea ningún
 * conjunto nuevo para seguir considerándose una brecha. Un abrigo no crea
 * combinaciones —el núcleo del look ya existía— pero a 12 °C cambia el resultado
 * lo suficiente como para valer la compra.
 */
export const minScoreGainPoints = 5;

/** Pesos de la prioridad calculada antes de que el modelo ordene. */
export const priorityWeights = {
  newlyCoveredScenario: 10,
  unlockedOutfit: 1,
  scoreGainPoint: 0.3,
} as const;

/**
 * Prioridad que se le suma a una prenda de un slot que hoy está vacío. Va por
 * encima de cualquier mejora medible porque sin ella no hay look que armar:
 * comprar la tercera camisa nunca es más urgente que comprar el primer pantalón.
 */
export const requiredPriorityBonus = 20;

/** Prefijo de los ids cortos con los que viajan las prendas candidatas. */
export const hypothesisShortIdPrefix = 'h';

/** Prefijo de los ids sintéticos de las prendas hipotéticas. */
export const hypotheticalGarmentIdPrefix = 'ffffffff-0000-4000-8000-';
/** Dígitos del sufijo del id sintético, para que sea un UUID bien formado. */
export const hypotheticalGarmentIdDigits = 12;

/** Familias de color que se listan en la matriz, ordenadas de más a menos. */
export const maxCoverageColors = 6;
