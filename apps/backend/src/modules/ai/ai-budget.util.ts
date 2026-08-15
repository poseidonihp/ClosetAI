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
