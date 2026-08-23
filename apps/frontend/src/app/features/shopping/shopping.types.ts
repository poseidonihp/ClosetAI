/**
 * Las dos mitades de "Qué comprar". Son preguntas distintas sobre el mismo
 * clóset: qué te falta en abstracto y si te conviene esta prenda concreta.
 */

/** Una pestaña de la página, con su id de URL y su etiqueta. */
export interface IShoppingTabOption {
  id: ShoppingTab;
  label: string;
}

export type ShoppingTab = 'vacios' | 'evaluar';

/** El id viaja en `?tab=` para poder abrir "Evaluar" directo desde el celular. */
export const shoppingTabs: readonly IShoppingTabOption[] = [
  { id: 'vacios', label: 'Qué me falta' },
  { id: 'evaluar', label: '¿Me lo compro?' },
];

/**
 * Qué se está haciendo sobre una candidata. La pantalla lo necesita para decir
 * **qué** está en curso y no sólo que algo lo está: medir es instantáneo y
 * gratis, y pedir el veredicto tarda segundos y cuesta.
 */
export type PurchaseAction = 'measure' | 'evaluate' | 'status' | 'remove';

/** La candidata sobre la que hay algo en vuelo, y qué. */
export interface IPurchaseBusy {
  garmentId: string;
  action: PurchaseAction;
}
