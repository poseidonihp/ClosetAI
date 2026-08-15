import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { NotificationService } from '../notifications/notification.service';
import { loggedOutFlagKey } from '../auth/session-flag';
import { clearSessionActivity, markRefresh } from '../auth/session-activity';

/**
 * Ante un 401 intenta refrescar el access token vía /api/auth/refresh y reintenta
 * el request original UNA sola vez. Garantías:
 *  - Single-flight: varios 401 concurrentes comparten un único refresh.
 *  - Anti-bucle: no actúa sobre los endpoints de auth ni sobre un request ya reintentado.
 *  - Si el refresh falla, avisa y redirige a login una sola vez.
 */
const retryHeader = 'X-Retry-After-Refresh';
const httpUnauthorized = 401;

const authEndpoints = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/me',
  '/api/auth/refresh',
  '/api/auth/logout',
];

let refreshing: Promise<boolean> | null = null;
let sessionExpiredHandled = false;

/**
 * Lanza (o reutiliza) la única petición de refresh en vuelo.
 * @returns {Promise<boolean>}
 */
function refreshOnce(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
    .then(response => {
      if (response.ok) {
        markRefresh(Date.now());
      }
      return response.ok;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/**
 * Avisa al usuario y lo manda al login una sola vez por carga de página.
 * @param {NotificationService} notify - Servicio de notificaciones.
 * @returns {void}
 */
function handleSessionExpired(notify: NotificationService): void {
  if (sessionExpiredHandled) {
    return;
  }
  sessionExpiredHandled = true;
  notify.warning('Tu sesión expiró. Vuelve a iniciar sesión.', { title: 'Sesión finalizada' });
  clearSessionActivity();
  try {
    sessionStorage.setItem(loggedOutFlagKey, '1');
  } catch {
    // Sin `sessionStorage` se pierde el aviso en el login, no la expulsión: el
    // toast ya se mostró y las cookies ya no valen.
  }
  globalThis.location.href = '/login';
}

export const authRefreshInterceptor: HttpInterceptorFn = (request, next) => {
  const notify = inject(NotificationService);
  const isAuthEndpoint = authEndpoints.some(endpoint => request.url.includes(endpoint));

  return next(request).pipe(
    catchError((error: unknown) => {
      const isUnauthorized =
        error instanceof HttpErrorResponse && error.status === httpUnauthorized;
      const canRetry = isUnauthorized && !isAuthEndpoint && !request.headers.has(retryHeader);
      if (!canRetry) {
        return throwError(() => error);
      }
      return from(refreshOnce()).pipe(
        switchMap(refreshed => {
          if (!refreshed) {
            handleSessionExpired(notify);
            return throwError(() => error);
          }
          const retried = request.clone({
            setHeaders: { [retryHeader]: '1' },
            withCredentials: true,
          });
          return next(retried);
        }),
      );
    }),
  );
};
