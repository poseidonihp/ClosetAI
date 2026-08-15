/**
 * Marca en sessionStorage que la sesión se cerró en esta pestaña. Evita que los
 * guards vuelvan a sondear /auth/me y /auth/refresh cuando ya sabemos que no hay
 * sesión. Vive en su propio archivo para que el interceptor no dependa del store
 * de auth (y no se cree un ciclo de imports).
 */
export const loggedOutFlagKey = 'closetai:logged-out';

/**
 * Consume la marca de logout: devuelve true una única vez tras cerrar sesión.
 * @returns {boolean}
 */
export function consumeLoggedOutFlag(): boolean {
  try {
    if (sessionStorage.getItem(loggedOutFlagKey) === '1') {
      sessionStorage.removeItem(loggedOutFlagKey);
      return true;
    }
  } catch {
    // Sin `sessionStorage` no hay marca que consumir: se responde que no la había.
  }
  return false;
}

/**
 * Marca la sesión como cerrada en esta pestaña.
 * @returns {void}
 */
export function raiseLoggedOutFlag(): void {
  try {
    sessionStorage.setItem(loggedOutFlagKey, '1');
  } catch {
    // Sin `sessionStorage` se pierde el aviso al llegar al login. Es un mensaje,
    // no la seguridad de la sesión: las cookies ya caducaron igual.
  }
}
