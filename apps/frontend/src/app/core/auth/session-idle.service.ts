import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { defaultSessionIdleSeconds, type SessionPolicy } from '@closetai/shared-types';
import { ApiClient } from '../http/api.client';
import { NotificationService } from '../notifications/notification.service';
import { AuthStore } from './auth.store';
import {
  isIdleExpired,
  markActivity,
  markRefresh,
  markSessionStart,
  needsKeepAlive,
  readSessionActivity,
  sessionActivityKey,
  type ISessionActivity,
} from './session-activity';

const millisPerSecond = 1000;
/** Máxima frecuencia con la que se anota actividad; una rueda de ratón dispara decenas de eventos. */
const activityThrottleMs = 1000;
/** Margen para que el temporizador no despierte un tick antes del vencimiento. */
const timerSlackMs = 250;
/** Interacciones deliberadas. `mousemove` no cuenta: un roce no es usar la app. */
const activityEvents = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
const listenerOptions = { passive: true, capture: true } as const;

/**
 * Cierra la sesión tras la ventana de inactividad que fija el servidor y lleva al
 * login. Mientras haya actividad refresca los tokens para deslizar la ventana, así
 * que quien usa la app no se ve interrumpido y quien la deja quieta sale solo.
 * @class
 */
@Injectable({ providedIn: 'root' })
export class SessionIdleService {
  private readonly _api = inject(ApiClient);
  private readonly _auth = inject(AuthStore);
  private readonly _notify = inject(NotificationService);
  private readonly _router = inject(Router);

  private readonly _idleTimeoutMs = signal(defaultSessionIdleSeconds * millisPerSecond);

  /** Ventana de inactividad vigente en ms; hasta que llega la del servidor, la de por defecto. */
  readonly idleTimeoutMs = this._idleTimeoutMs.asReadonly();

  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _watching = false;
  private _policyRequested = false;
  private _expiring = false;
  private _keepAliveInFlight = false;
  private _lastRegisteredAt = 0;

  private readonly _onActivity = (): void => this._registerActivity();

  /** Volver a la pestaña no es actividad que renueve: se comprueba si ya venció. */
  private readonly _onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      this._scheduleCheck();
    }
  };

  /** Actividad en otra pestaña: la ventana es de la sesión, no de la pestaña. */
  private readonly _onStorage = (event: StorageEvent): void => {
    if (event.key === sessionActivityKey) {
      this._scheduleCheck();
    }
  };

  /**
   * Empieza a vigilar cuando hay sesión y deja de hacerlo cuando no.
   * @constructor
   */
  constructor() {
    effect(() => {
      const authenticated = this._auth.isAuthenticated();
      untracked(() => (authenticated ? this._start() : this._stop()));
    });
  }

  /**
   * Engancha los escuchadores de actividad y arranca el temporizador.
   * @private
   * @returns {void}
   */
  private _start(): void {
    if (this._watching) {
      return;
    }
    this._watching = true;
    this._expiring = false;
    for (const eventName of activityEvents) {
      document.addEventListener(eventName, this._onActivity, listenerOptions);
    }
    document.addEventListener('visibilitychange', this._onVisibilityChange);
    globalThis.addEventListener('storage', this._onStorage);
    void this._loadPolicy();
    this._scheduleCheck();
  }

  /**
   * Suelta los escuchadores y el temporizador.
   * @private
   * @returns {void}
   */
  private _stop(): void {
    if (!this._watching) {
      return;
    }
    this._watching = false;
    this._clearTimer();
    for (const eventName of activityEvents) {
      document.removeEventListener(eventName, this._onActivity, listenerOptions);
    }
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
    globalThis.removeEventListener('storage', this._onStorage);
  }

  /**
   * Anota la interacción, desliza la ventana y refresca los tokens si toca.
   * @private
   * @returns {void}
   */
  private _registerActivity(): void {
    const now = Date.now();
    if (now - this._lastRegisteredAt < activityThrottleMs) {
      return;
    }
    this._lastRegisteredAt = now;

    const activity = this._activityRecord(now);
    if (isIdleExpired(now, activity.lastActivityAt, this._idleTimeoutMs())) {
      void this._expire();
      return;
    }

    markActivity(now);
    this._scheduleCheck();
    if (needsKeepAlive(now, activity.lastRefreshAt, this._idleTimeoutMs())) {
      void this._keepAlive();
    }
  }

  /**
   * Reprograma la comprobación al vencimiento, o cierra si ya pasó.
   * @private
   * @returns {void}
   */
  private _scheduleCheck(): void {
    this._clearTimer();
    if (!this._watching) {
      return;
    }
    const now = Date.now();
    const activity = this._activityRecord(now);
    const remainingMs = activity.lastActivityAt + this._idleTimeoutMs() - now;
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
      void this._expire();
      return;
    }
    this._timer = setTimeout(() => this._scheduleCheck(), remainingMs + timerSlackMs);
  }

  /**
   * Cierra la sesión por inactividad, avisa y lleva al login.
   * @private
   * @returns {Promise<void>}
   */
  private async _expire(): Promise<void> {
    if (this._expiring) {
      return;
    }
    this._expiring = true;
    this._stop();
    await this._auth.logout();
    this._notify.warning('Cerramos tu sesión por inactividad. Vuelve a iniciar sesión.', {
      title: 'Sesión finalizada',
    });
    await this._router.navigateByUrl('/login');
  }

  /**
   * Rota el par de tokens para deslizar la ventana en el servidor. Sólo la pestaña
   * con el foco recibe eventos de actividad, así que no compiten dos rotaciones.
   * @private
   * @returns {Promise<void>}
   */
  private async _keepAlive(): Promise<void> {
    if (this._keepAliveInFlight) {
      return;
    }
    this._keepAliveInFlight = true;
    markRefresh(Date.now());
    try {
      await this._auth.keepAlive();
    } finally {
      this._keepAliveInFlight = false;
    }
  }

  /**
   * Pide la ventana de inactividad al servidor una sola vez por carga de página.
   * @private
   * @returns {Promise<void>}
   */
  private async _loadPolicy(): Promise<void> {
    if (this._policyRequested) {
      return;
    }
    this._policyRequested = true;
    try {
      const policy = await this._api.get<SessionPolicy>('auth/session-policy');
      const seconds = policy.idleTimeoutSeconds;
      if (Number.isFinite(seconds) && seconds > 0) {
        this._idleTimeoutMs.set(seconds * millisPerSecond);
        this._scheduleCheck();
      }
    } catch {
      // No poder leer la política deja el valor por defecto del cliente. La
      // garantía son los TTL del servidor, no esta ventana.
    }
  }

  /**
   * Marcas de la sesión, iniciándolas si el almacenamiento no las tenía.
   * @private
   * @param {number} now - Instante actual en ms epoch.
   * @returns {ISessionActivity}
   */
  private _activityRecord(now: number): ISessionActivity {
    const stored = readSessionActivity();
    if (stored) {
      return stored;
    }
    markSessionStart(now);
    return { lastActivityAt: now, lastRefreshAt: now };
  }

  /**
   * Cancela el temporizador pendiente.
   * @private
   * @returns {void}
   */
  private _clearTimer(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}
