import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { exceedsBudget, resolveMonthWindow } from './ai-budget.util';

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

describe('exceedsBudget', () => {
  const budget = new Prisma.Decimal(10);

  it('deja pasar una llamada que cabe justo en lo que queda', () => {
    expect(exceedsBudget(new Prisma.Decimal('9.9'), new Prisma.Decimal('0.1'), budget)).toBe(false);
  });

  it('corta la que se pasa por poco que sea', () => {
    expect(exceedsBudget(new Prisma.Decimal('9.9'), new Prisma.Decimal('0.11'), budget)).toBe(true);
  });

  it('no acumula el error del punto flotante: la cuenta es decimal', () => {
    const committed = new Prisma.Decimal('0.1').plus('0.2');

    expect(exceedsBudget(committed, new Prisma.Decimal('9.7'), budget)).toBe(false);
  });

  it('corta cualquier llamada cuando el techo es cero', () => {
    expect(
      exceedsBudget(new Prisma.Decimal(0), new Prisma.Decimal('0.0001'), new Prisma.Decimal(0)),
    ).toBe(true);
  });
});
