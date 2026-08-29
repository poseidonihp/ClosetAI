import { Prisma } from '@prisma/client';

/** Ventana de un mes natural en UTC, usada para acotar el gasto en IA. */
export interface IMonthWindow {
  startsAt: Date;
  endsAt: Date;
}

/**
 * Calcula el mes natural (en UTC) que contiene la fecha dada. Se fija UTC a
 * propósito: el corte del presupuesto no puede depender de la zona horaria del
 * proceso ni de la del usuario, o el mismo job caería en meses distintos.
 * @param {Date} reference - Fecha dentro del mes que se quiere acotar.
 * @returns {IMonthWindow}
 */
export function resolveMonthWindow(reference: Date): IMonthWindow {
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth();
  return {
    startsAt: new Date(Date.UTC(year, month, 1)),
    endsAt: new Date(Date.UTC(year, month + 1, 1)),
  };
}

/**
 * Decide si una reserva se pasa del techo. Existe como función y no como una
 * comparación suelta porque hay **dos** techos —el del usuario y el de toda la
 * instalación— y tienen que tratar el borde igual: gastar exactamente el techo
 * está permitido, pasarse de él no.
 * @param {Prisma.Decimal} committedUsd - Gasto ya comprometido este mes.
 * @param {Prisma.Decimal} estimatedUsd - Costo estimado de la llamada nueva.
 * @param {Prisma.Decimal} budgetUsd - Techo aplicable.
 * @returns {boolean}
 */
export function exceedsBudget(
  committedUsd: Prisma.Decimal,
  estimatedUsd: Prisma.Decimal,
  budgetUsd: Prisma.Decimal,
): boolean {
  return committedUsd.plus(estimatedUsd).greaterThan(budgetUsd);
}
