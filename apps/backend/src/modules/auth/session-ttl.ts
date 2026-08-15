/**
 * Divisor del access token respecto a la ventana de inactividad. Vive la mitad de
 * la ventana para que el refresh la deslice mientras el refresh token aún esté vivo.
 */
const accessTtlDivisor = 2;

/**
 * TTL del access token derivado de la ventana de inactividad, en segundos.
 * @param {number} idleSeconds - Ventana de inactividad configurada.
 * @returns {number}
 */
export function accessTtlSecondsFrom(idleSeconds: number): number {
  return Math.max(1, Math.floor(idleSeconds / accessTtlDivisor));
}
