import { afterEach, describe, expect, it, vi } from 'vitest';
import { LayoutService, desktopMinWidthPx, mobileMaxWidthPx } from './layout.service';

const originalMatchMedia = window.matchMedia;

/**
 * Sustituye `window.matchMedia` por un doble que responde según el ancho dado.
 * @param {number} widthPx - Ancho de viewport simulado.
 * @returns {void}
 */
function stubViewportWidth(widthPx: number): void {
  window.matchMedia = ((query: string) => {
    const matches = query.includes('max-width')
      ? widthPx <= mobileMaxWidthPx
      : widthPx >= desktopMinWidthPx;
    return {
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  }) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe('LayoutService', () => {
  it('a 390px reporta móvil', () => {
    stubViewportWidth(390);

    const layout = new LayoutService();

    expect(layout.breakpoint()).toBe('mobile');
    expect(layout.isMobile()).toBe(true);
    expect(layout.isSidebarCollapsible()).toBe(false);
  });

  it('a 800px reporta tablet con sidebar colapsable', () => {
    stubViewportWidth(800);

    const layout = new LayoutService();

    expect(layout.breakpoint()).toBe('tablet');
    expect(layout.isSidebarCollapsible()).toBe(true);
    expect(layout.isDesktop()).toBe(false);
  });

  it('a 1440px reporta escritorio', () => {
    stubViewportWidth(1440);

    const layout = new LayoutService();

    expect(layout.breakpoint()).toBe('desktop');
    expect(layout.isDesktop()).toBe(true);
    expect(layout.isMobile()).toBe(false);
  });
});
