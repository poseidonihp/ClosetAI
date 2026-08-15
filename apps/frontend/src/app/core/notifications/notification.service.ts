import { Injectable, signal } from '@angular/core';

export type NotificationKind = 'success' | 'error' | 'info' | 'warning';

export interface INotification {
  id: number;
  kind: NotificationKind;
  message: string;
  title?: string;
}

export interface INotificationOptions {
  title?: string;
  /** Milisegundos antes de auto-descartar. 0 = persistente (cierre manual). */
  timeoutMs?: number;
}

const defaultTimeoutMs = 4500;
const errorTimeoutMs = 7000;

/**
 * Cola de notificaciones (toasts) basada en signals; el host la renderiza.
 * Sustituye a `window.alert`.
 * @class
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private _sequence = 0;
  private readonly _items = signal<INotification[]>([]);

  readonly items = this._items.asReadonly();

  /**
   * Muestra un toast de éxito.
   * @param {string} message - Mensaje a mostrar.
   * @param {INotificationOptions} [options] - Título y duración.
   * @returns {number}
   */
  success(message: string, options?: INotificationOptions): number {
    return this._show('success', message, options);
  }

  /**
   * Muestra un toast de error (dura más que el resto).
   * @param {string} message - Mensaje a mostrar.
   * @param {INotificationOptions} [options] - Título y duración.
   * @returns {number}
   */
  error(message: string, options?: INotificationOptions): number {
    return this._show('error', message, { timeoutMs: errorTimeoutMs, ...options });
  }

  /**
   * Muestra un toast informativo.
   * @param {string} message - Mensaje a mostrar.
   * @param {INotificationOptions} [options] - Título y duración.
   * @returns {number}
   */
  info(message: string, options?: INotificationOptions): number {
    return this._show('info', message, options);
  }

  /**
   * Muestra un toast de advertencia.
   * @param {string} message - Mensaje a mostrar.
   * @param {INotificationOptions} [options] - Título y duración.
   * @returns {number}
   */
  warning(message: string, options?: INotificationOptions): number {
    return this._show('warning', message, options);
  }

  /**
   * Descarta un toast por id.
   * @param {number} id - Identificador del toast.
   * @returns {void}
   */
  dismiss(id: number): void {
    this._items.update(list => list.filter(item => item.id !== id));
  }

  /**
   * Vacía la cola de toasts.
   * @returns {void}
   */
  clear(): void {
    this._items.set([]);
  }

  /**
   * Encola un toast y programa su descarte automático.
   * @private
   * @param {NotificationKind} kind - Tipo de notificación.
   * @param {string} message - Mensaje a mostrar.
   * @param {INotificationOptions} [options] - Título y duración.
   * @returns {number}
   */
  private _show(kind: NotificationKind, message: string, options?: INotificationOptions): number {
    this._sequence += 1;
    const id = this._sequence;
    this._items.update(list => [...list, { id, kind, message, title: options?.title }]);

    const timeoutMs = options?.timeoutMs ?? defaultTimeoutMs;
    if (timeoutMs > 0) {
      setTimeout(() => this.dismiss(id), timeoutMs);
    }
    return id;
  }
}
