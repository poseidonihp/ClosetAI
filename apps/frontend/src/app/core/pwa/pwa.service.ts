import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwUpdate } from '@angular/service-worker';
import { NotificationService } from '../notifications/notification.service';
import type { IBeforeInstallPromptEvent } from './pwa.types';

const beforeInstallPromptEvent = 'beforeinstallprompt';
const appInstalledEvent = 'appinstalled';
const standaloneQuery = '(display-mode: standalone)';
const installedMessage = 'closetAI quedó instalada. Ábrela desde tu pantalla de inicio.';
const unrecoverableMessage =
  'La versión instalada quedó incompleta. Se va a recargar para descargarla de nuevo.';

/** Cada cuánto se vuelve a preguntar por una versión nueva */
const minimumCheckIntervalMinutes = 15;
const minimumCheckIntervalMs = minimumCheckIntervalMinutes * 60 * 1000;

/**
 * Instalación y actualización de la PWA. El service worker lo registra
 * `provideServiceWorker`; aquí sólo vive lo que el usuario ve: si se puede
 * instalar, si ya está instalada y si hay una versión nueva esperando.
 * @class
 */
@Injectable({ providedIn: 'root' })
export class PwaService {
  private readonly _updates = inject(SwUpdate);
  private readonly _notifications = inject(NotificationService);

  /** Evento de instalación retenido. Sólo sirve una vez. */
  private readonly _installPrompt = signal<IBeforeInstallPromptEvent | null>(null);
  private readonly _updateReady = signal(false);
  private readonly _standalone = signal(PwaService._isStandalone());
  private _lastCheckedAt = 0;

  /** True cuando el navegador ofrece instalar y la app todavía no lo está. */
  readonly canInstall = computed(() => this._installPrompt() !== null && !this._standalone());
  /** True cuando la app corre como aplicación instalada y no dentro del navegador. */
  readonly isStandalone = this._standalone.asReadonly();
  /** True cuando hay una versión descargada esperando a que se recargue. */
  readonly updateReady = this._updateReady.asReadonly();

  /**
   * Escucha la oferta de instalación del navegador y las versiones nuevas que
   * descargue el service worker.
   * @constructor
   */
  constructor() {
    window.addEventListener(beforeInstallPromptEvent, event => {
      // Sin esto Chrome enseña su propio aviso y el botón de la app nunca aparece.
      event.preventDefault();
      this._installPrompt.set(event as IBeforeInstallPromptEvent);
    });
    window.addEventListener(appInstalledEvent, () => {
      this._installPrompt.set(null);
      this._standalone.set(true);
      this._notifications.success(installedMessage);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void this.checkForUpdate();
      }
    });

    this._updates.versionUpdates.pipe(takeUntilDestroyed()).subscribe(event => {
      if (event.type === 'VERSION_READY') {
        this._updateReady.set(true);
      }
    });
    this._updates.unrecoverable.pipe(takeUntilDestroyed()).subscribe(() => {
      this._notifications.error(unrecoverableMessage);
      this.applyUpdate();
    });
  }

  /**
   * Abre el diálogo de instalación del navegador. El evento sólo se puede usar
   * una vez, así que se descarta pase lo que pase.
   * @returns {Promise<boolean>}
   */
  async install(): Promise<boolean> {
    const prompt = this._installPrompt();
    if (!prompt) {
      return false;
    }
    this._installPrompt.set(null);
    await prompt.prompt();
    const choice = await prompt.userChoice;
    return choice.outcome === 'accepted';
  }

  /**
   * Pregunta al servidor si hay una versión nueva, como mucho una vez cada
   * cuarto de hora.
   * @returns {Promise<void>}
   */
  async checkForUpdate(): Promise<void> {
    const now = Date.now();
    if (!this._updates.isEnabled || now - this._lastCheckedAt < minimumCheckIntervalMs) {
      return;
    }
    this._lastCheckedAt = now;
    try {
      await this._updates.checkForUpdate();
    } catch {
      // Sin red o servidor caído: se reintenta al volver a la pestaña.
    }
  }

  /**
   * Activa la versión descargada. Recargar es obligatorio: el código viejo sigue
   * en memoria y mezclar los dos deja la app en un estado que nadie ha probado.
   * @returns {void}
   */
  applyUpdate(): void {
    void this._updates.activateUpdate().finally(() => document.location.reload());
  }

  /**
   * Detecta si la app corre instalada. `standalone` de Safari no está en la
   * librería DOM, así que se lee del navegador con narrowing.
   * @private
   * @returns {boolean}
   */
  private static _isStandalone(): boolean {
    if (window.matchMedia?.(standaloneQuery).matches) {
      return true;
    }
    const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone;
    return iosStandalone === true;
  }
}
