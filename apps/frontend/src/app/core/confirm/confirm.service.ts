import { Injectable, signal } from '@angular/core';

export type ConfirmTone = 'default' | 'danger';

export interface IConfirmOptions {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
}

export interface IConfirmRequest extends Required<Omit<IConfirmOptions, 'title'>> {
  id: number;
  title?: string;
  resolve: (confirmed: boolean) => void;
}

/**
 * Diálogo de confirmación basado en signals, en sustitución de `window.confirm`.
 * `ask()` devuelve una promesa que se resuelve cuando el usuario decide.
 * @class
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private _sequence = 0;
  private readonly _request = signal<IConfirmRequest | null>(null);

  readonly request = this._request.asReadonly();

  /**
   * Pregunta al usuario y resuelve a `true` si confirma, `false` si cancela.
   * @param {IConfirmOptions | string} options - Opciones o mensaje suelto.
   * @returns {Promise<boolean>}
   */
  ask(options: IConfirmOptions | string): Promise<boolean> {
    const resolved = typeof options === 'string' ? { message: options } : options;
    this._sequence += 1;
    return new Promise<boolean>((resolve): void => {
      this._request.set({
        id: this._sequence,
        message: resolved.message,
        title: resolved.title,
        confirmLabel: resolved.confirmLabel ?? 'Confirmar',
        cancelLabel: resolved.cancelLabel ?? 'Cancelar',
        tone: resolved.tone ?? 'default',
        resolve,
      });
    });
  }

  /**
   * Resuelve la petición activa y cierra el diálogo.
   * @param {boolean} confirmed - Decisión del usuario.
   * @returns {void}
   */
  resolve(confirmed: boolean): void {
    const current = this._request();
    if (!current) {
      return;
    }
    this._request.set(null);
    current.resolve(confirmed);
  }
}
