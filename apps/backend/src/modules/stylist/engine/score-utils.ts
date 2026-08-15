/** Utilidades numéricas compartidas por las reglas del motor. */

const decimalFactor = 10;

/**
 * Acota una puntuación al rango 0–1.
 * @param {number} value - Puntuación cruda.
 * @returns {number}
 */
export function clampScore(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Media aritmética; 0 si la lista está vacía.
 * @param {readonly number[]} values - Valores a promediar.
 * @returns {number}
 */
export function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * Redondea a un decimal, que es la precisión con la que se muestra la formalidad.
 * @param {number} value - Valor a redondear.
 * @returns {number}
 */
export function roundToOneDecimal(value: number): number {
  return Math.round(value * decimalFactor) / decimalFactor;
}

/**
 * Formatea un número con coma decimal, como se escribe en español.
 * @param {number} value - Valor a formatear.
 * @returns {string}
 */
export function formatDecimal(value: number): string {
  return roundToOneDecimal(value).toString().replace('.', ',');
}
