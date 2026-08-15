import { Injectable, computed, signal } from '@angular/core';

export type LayoutBreakpoint = 'mobile' | 'tablet' | 'desktop';

/**
 * Anchos de corte del layout, alineados con los breakpoints de Tailwind:
 * móvil <640px, tablet 640–1023px, escritorio ≥1024px.
 */
export const mobileMaxWidthPx = 639;
export const desktopMinWidthPx = 1024;

const mobileQuery = `(max-width: ${mobileMaxWidthPx}px)`;
const desktopQuery = `(min-width: ${desktopMinWidthPx}px)`;

/**
 * Breakpoint activo como signal. Sólo para cambios de **estructura** (sidebar fija
 * vs. drawer vs. bottom nav); lo puramente visual se resuelve con CSS.
 * @class
 */
@Injectable({ providedIn: 'root' })
export class LayoutService {
  private readonly _breakpoint = signal<LayoutBreakpoint>(LayoutService._read());

  readonly breakpoint = this._breakpoint.asReadonly();
  readonly isMobile = computed(() => this._breakpoint() === 'mobile');
  readonly isTablet = computed(() => this._breakpoint() === 'tablet');
  readonly isDesktop = computed(() => this._breakpoint() === 'desktop');
  readonly isSidebarCollapsible = computed(() => this._breakpoint() === 'tablet');

  /**
   * Suscribe los cambios de breakpoint una única vez por aplicación.
   * @constructor
   */
  constructor() {
    const onChange = (): void => this._breakpoint.set(LayoutService._read());
    for (const query of [mobileQuery, desktopQuery]) {
      window.matchMedia?.(query).addEventListener('change', onChange);
    }
  }

  /**
   * Resuelve el breakpoint actual consultando `matchMedia`.
   * @private
   * @returns {LayoutBreakpoint}
   */
  private static _read(): LayoutBreakpoint {
    if (window.matchMedia?.(mobileQuery).matches) {
      return 'mobile';
    }
    return window.matchMedia?.(desktopQuery).matches ? 'desktop' : 'tablet';
  }
}
