import { Injectable, computed, effect, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

const storageKey = 'closetai:theme';

/**
 * Tema claro/oscuro. Escribe la clase `.dark` en <html> y recuerda la elección.
 * @class
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly _theme = signal<Theme>(ThemeService._read());

  readonly theme = this._theme.asReadonly();
  readonly isDark = computed(() => this._theme() === 'dark');

  /**
   * Sincroniza la clase del documento y el almacenamiento con el tema activo.
   * @constructor
   */
  constructor() {
    effect(() => {
      const theme = this._theme();
      document.documentElement.classList.toggle('dark', theme === 'dark');
      try {
        localStorage.setItem(storageKey, theme);
      } catch {
        // localStorage no disponible: el tema sigue aplicándose en esta sesión.
      }
    });
  }

  /**
   * Alterna entre claro y oscuro.
   * @returns {void}
   */
  toggle(): void {
    this._theme.update(theme => (theme === 'dark' ? 'light' : 'dark'));
  }

  /**
   * Fija un tema concreto.
   * @param {Theme} theme - Tema a aplicar.
   * @returns {void}
   */
  set(theme: Theme): void {
    this._theme.set(theme);
  }

  /**
   * Lee el tema guardado y, si no hay, el que prefiere el sistema.
   * @private
   * @returns {Theme}
   */
  private static _read(): Theme {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === 'dark' || stored === 'light') {
        return stored;
      }
    } catch {
      // Sin `localStorage` se cae a la preferencia del sistema, que es justo lo
      // que devuelve el resto de la función.
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
}
