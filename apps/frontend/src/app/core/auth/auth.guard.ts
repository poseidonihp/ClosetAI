import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthStore } from './auth.store';
import { consumeLoggedOutFlag } from './session-flag';

/**
 * Resuelve el estado de sesión una sola vez por carga de página. `loading()`
 * arranca en true y pasa a false cuando `hydrate()` acaba, así que sólo se sondea
 * si el estado aún no se conoce. Tras un logout se salta el sondeo.
 * @param {AuthStore} auth - Store de autenticación.
 * @returns {Promise<void>}
 */
async function resolveSession(auth: AuthStore): Promise<void> {
  if (consumeLoggedOutFlag() || auth.isAuthenticated() || !auth.loading()) {
    return;
  }
  await auth.hydrate();
}

/**
 * Rutas privadas: exigen sesión viva. Sin ella, al login.
 * @returns {Promise<boolean | import('@angular/router').UrlTree>}
 */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  await resolveSession(auth);
  if (auth.isAuthenticated()) {
    return true;
  }
  return router.parseUrl('/login');
};

/**
 * Rutas públicas (login y registro): sólo para visitantes sin sesión.
 * @returns {Promise<boolean | import('@angular/router').UrlTree>}
 */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  await resolveSession(auth);
  if (!auth.isAuthenticated()) {
    return true;
  }
  return router.parseUrl('/closet');
};
