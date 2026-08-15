import { describe, expect, it } from 'vitest';
import { resolveMonthWindow } from './ai-budget.util';

describe('resolveMonthWindow', () => {
  it('acota el mes natural en UTC', () => {
    const window = resolveMonthWindow(new Date('2026-08-14T18:30:00.000Z'));

    expect(window.startsAt.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(window.endsAt.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('cruza el cambio de año sin salirse del rango', () => {
    const window = resolveMonthWindow(new Date('2026-12-31T23:59:59.999Z'));

    expect(window.startsAt.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(window.endsAt.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('mete el primer instante del mes dentro de su propia ventana', () => {
    const firstInstant = new Date('2026-08-01T00:00:00.000Z');
    const window = resolveMonthWindow(firstInstant);

    expect(window.startsAt.getTime()).toBe(firstInstant.getTime());
    expect(window.endsAt.getTime()).toBeGreaterThan(firstInstant.getTime());
  });
});
