/**
 * Marcas de tiempo de la sesión: última actividad del usuario y último refresh del
 * par de tokens.
 */
export const sessionActivityKey = 'closetai:session-activity';

/**
 * Fracción de la ventana tras la que se refresca el par de tokens. Por debajo de
 * 0.5 para adelantarse a la muerte del access token, que vive media ventana.
 */
const keepAliveFraction = 0.4;

export interface ISessionActivity {
  lastActivityAt: number;
  lastRefreshAt: number;
}

/** Copia en memoria para cuando localStorage no está disponible. */
let fallback: ISessionActivity | null = null;

/**
 * Lee las marcas de la sesión; null si nunca se escribieron o están corruptas.
 * @returns {ISessionActivity | null}
 */
export function readSessionActivity(): ISessionActivity | null {
  try {
    const raw = localStorage.getItem(sessionActivityKey);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return toSessionActivity(parsed) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Abre una ventana nueva: login, registro o refresh al hidratar la sesión.
 * @param {number} now - Instante actual en ms epoch.
 * @returns {void}
 */
export function markSessionStart(now: number): void {
  writeSessionActivity({ lastActivityAt: now, lastRefreshAt: now });
}

/**
 * Anota actividad del usuario sin tocar el instante del último refresh.
 * @param {number} now - Instante actual en ms epoch.
 * @returns {void}
 */
export function markActivity(now: number): void {
  const current = readSessionActivity();
  writeSessionActivity({ lastActivityAt: now, lastRefreshAt: current?.lastRefreshAt ?? now });
}

/**
 * Anota un refresh de tokens. No cuenta como actividad: si lo hiciera, cualquier
 * petición de fondo mantendría la sesión viva para siempre.
 * @param {number} now - Instante actual en ms epoch.
 * @returns {void}
 */
export function markRefresh(now: number): void {
  const current = readSessionActivity();
  writeSessionActivity({ lastActivityAt: current?.lastActivityAt ?? now, lastRefreshAt: now });
}

/**
 * Borra las marcas al cerrar la sesión.
 * @returns {void}
 */
export function clearSessionActivity(): void {
  fallback = null;
  try {
    localStorage.removeItem(sessionActivityKey);
  } catch {
    // Sin `localStorage` —modo privado, almacenamiento bloqueado— manda `fallback`,
    // que ya se limpió arriba.
  }
}

/**
 * Indica si la ventana de inactividad ya venció.
 * @param {number} now - Instante actual en ms epoch.
 * @param {number} lastActivityAt - Última actividad en ms epoch.
 * @param {number} idleTimeoutMs - Ventana de inactividad en ms.
 * @returns {boolean}
 */
export function isIdleExpired(now: number, lastActivityAt: number, idleTimeoutMs: number): boolean {
  return now - lastActivityAt >= idleTimeoutMs;
}

/**
 * Indica si toca refrescar los tokens para deslizar la ventana.
 * @param {number} now - Instante actual en ms epoch.
 * @param {number} lastRefreshAt - Último refresh en ms epoch.
 * @param {number} idleTimeoutMs - Ventana de inactividad en ms.
 * @returns {boolean}
 */
export function needsKeepAlive(now: number, lastRefreshAt: number, idleTimeoutMs: number): boolean {
  return now - lastRefreshAt >= idleTimeoutMs * keepAliveFraction;
}

/**
 * Valida la forma leída del almacenamiento.
 * @param {unknown} value - Valor parseado desde localStorage.
 * @returns {ISessionActivity | null}
 */
function toSessionActivity(value: unknown): ISessionActivity | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { lastActivityAt, lastRefreshAt } = value as Partial<ISessionActivity>;
  if (typeof lastActivityAt !== 'number' || typeof lastRefreshAt !== 'number') {
    return null;
  }
  return { lastActivityAt, lastRefreshAt };
}

/**
 * Persiste las marcas en localStorage y en la copia en memoria.
 * @param {ISessionActivity} activity - Marcas a guardar.
 * @returns {void}
 */
function writeSessionActivity(activity: ISessionActivity): void {
  fallback = activity;
  try {
    localStorage.setItem(sessionActivityKey, JSON.stringify(activity));
  } catch {
    // Sin `localStorage` la marca vive sólo en memoria: la ventana deja de
    // compartirse entre pestañas, pero la sesión de ésta sigue siendo correcta.
  }
}
