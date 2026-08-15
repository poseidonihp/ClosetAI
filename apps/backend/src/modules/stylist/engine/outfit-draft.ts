import {
  enumLabels,
  type Garment,
  type GarmentSlot,
  type OutfitItemRole,
} from '@closetai/shared-types';
import { maxAccessoriesPerOutfit, maxLayersPerOutfit, slotDisplayOrder } from './engine.constants';

/**
 * Un conjunto candidato antes de puntuarlo.
 */
export interface IOutfitDraft {
  top: Garment | null;
  bottom: Garment | null;
  fullBody: Garment | null;
  footwear: Garment;
  layers: readonly Garment[];
  accessories: readonly Garment[];
}

/** Papel de cada slot dentro del look. El servidor nunca lo recibe del cliente. */
const roleBySlot = {
  TOP: 'BASE',
  BOTTOM: 'BASE',
  FULL_BODY: 'BASE',
  MID_LAYER: 'LAYER',
  OUTERWEAR: 'LAYER',
  FOOTWEAR: 'FOOTWEAR',
  ACCESSORY: 'ACCESSORY',
} as const satisfies Record<GarmentSlot, OutfitItemRole>;

/**
 * Prendas que definen el look: base completa más calzado. Es sobre estas que se
 * calculan formalidad, color y ajuste.
 * @param {IOutfitDraft} draft - Conjunto candidato.
 * @returns {Garment[]}
 */
export function coreGarments(draft: IOutfitDraft): Garment[] {
  const core = [draft.fullBody, draft.top, draft.bottom, draft.footwear];
  return core.filter((garment): garment is Garment => garment !== null);
}

/**
 * Todas las prendas del conjunto, en el orden en que se listan en la ficha.
 * @param {IOutfitDraft} draft - Conjunto candidato.
 * @returns {Garment[]}
 */
export function allGarments(draft: IOutfitDraft): Garment[] {
  const everything = [...coreGarments(draft), ...draft.layers, ...draft.accessories];
  return [...everything].sort(
    (first, second) => slotDisplayOrder.indexOf(first.slot) - slotDisplayOrder.indexOf(second.slot),
  );
}

/**
 * Identificadores del conjunto, ordenados: sirven para comparar y deduplicar.
 * @param {IOutfitDraft} draft - Conjunto candidato.
 * @returns {string[]}
 */
export function garmentIds(draft: IOutfitDraft): string[] {
  return allGarments(draft)
    .map(garment => garment.id)
    .sort((first, second) => first.localeCompare(second));
}

/**
 * Clave estable de un conjunto de prendas. Vive aquí y en un solo sitio porque la
 * comparan cosas distintas —deduplicar candidatos y reconocer un look ya
 * rechazado— y dos formas de ordenar los ids no se reconocerían entre sí.
 * @param {readonly string[]} garmentIdList - Ids de las prendas del conjunto.
 * @returns {string}
 */
export function garmentSetKey(garmentIdList: readonly string[]): string {
  return [...garmentIdList].sort((first, second) => first.localeCompare(second)).join('|');
}

/**
 * Clave estable del conjunto, para no devolver dos veces la misma combinación.
 * @param {IOutfitDraft} draft - Conjunto candidato.
 * @returns {string}
 */
export function draftKey(draft: IOutfitDraft): string {
  return garmentSetKey(garmentIds(draft));
}

/**
 * Indica si el conjunto contiene una prenda concreta.
 * @param {IOutfitDraft} draft - Conjunto candidato.
 * @param {string} garmentId - Prenda buscada.
 * @returns {boolean}
 */
export function includesGarment(draft: IOutfitDraft, garmentId: string): boolean {
  return allGarments(draft).some(garment => garment.id === garmentId);
}

/**
 * Devuelve el papel de una prenda dentro del look a partir de su slot.
 * @param {GarmentSlot} slot - Slot de la prenda.
 * @returns {OutfitItemRole}
 */
export function roleForSlot(slot: GarmentSlot): OutfitItemRole {
  return roleBySlot[slot];
}

/** Resultado de comprobar si un puñado de prendas forma un look válido. */
export interface IDraftValidation {
  draft: IOutfitDraft | null;
  error: string | null;
}

const notAValidLook = 'No es un conjunto completo: falta';
const tooManyFor = 'Lleva más de una prenda para';

/** Slots de los que un look no puede llevar dos prendas. */
const singleOccupancySlots: readonly GarmentSlot[] = [
  'TOP',
  'BOTTOM',
  'FULL_BODY',
  'FOOTWEAR',
  'MID_LAYER',
  'OUTERWEAR',
];

/**
 * Comprueba si un conjunto de prendas forma un look válido y lo estructura.
 * @param {readonly Garment[]} garments - Prendas del conjunto propuesto.
 * @returns {IDraftValidation}
 */
export function buildDraft(garments: readonly Garment[]): IDraftValidation {
  const bySlot = (slot: GarmentSlot): Garment[] =>
    garments.filter(garment => garment.slot === slot);
  const [footwear] = bySlot('FOOTWEAR');
  const [fullBody] = bySlot('FULL_BODY');
  const [top] = bySlot('TOP');
  const [bottom] = bySlot('BOTTOM');
  const layers = [...bySlot('MID_LAYER'), ...bySlot('OUTERWEAR')];
  const accessories = bySlot('ACCESSORY');

  const structuralError = findStructuralError({ garments, footwear, fullBody, top, bottom });
  if (structuralError !== null) {
    return { draft: null, error: structuralError };
  }
  if (!footwear) {
    return { draft: null, error: `${notAValidLook} el calzado.` };
  }
  if (layers.length > maxLayersPerOutfit) {
    return {
      draft: null,
      error: `Lleva ${layers.length} capas y el máximo es ${maxLayersPerOutfit}.`,
    };
  }
  if (accessories.length > maxAccessoriesPerOutfit) {
    return {
      draft: null,
      error: `Lleva ${accessories.length} accesorios y el máximo es ${maxAccessoriesPerOutfit}.`,
    };
  }

  return {
    error: null,
    draft: {
      footwear,
      layers,
      accessories,
      top: fullBody ? null : (top ?? null),
      bottom: fullBody ? null : (bottom ?? null),
      fullBody: fullBody ?? null,
    },
  };
}

/** Piezas del núcleo ya extraídas, para comprobar su estructura. */
interface ICoreCandidate {
  garments: readonly Garment[];
  footwear: Garment | undefined;
  fullBody: Garment | undefined;
  top: Garment | undefined;
  bottom: Garment | undefined;
}

/**
 * Devuelve el problema estructural del núcleo, o null si no lo hay: una base
 * incompleta, una prenda entera mezclada con separables, o dos prendas para el
 * mismo sitio.
 * @param {ICoreCandidate} candidate - Piezas del conjunto propuesto.
 * @returns {string | null}
 */
function findStructuralError(candidate: ICoreCandidate): string | null {
  const { garments, fullBody, top, bottom } = candidate;
  const countOf = (slot: GarmentSlot): number =>
    garments.filter(garment => garment.slot === slot).length;

  for (const slot of singleOccupancySlots) {
    if (countOf(slot) > 1) {
      return `${tooManyFor} ${enumLabels.garmentSlot[slot].toLowerCase()}.`;
    }
  }
  if (fullBody && (top || bottom)) {
    return 'Mezcla una prenda entera con una parte de arriba o de abajo.';
  }
  if (!fullBody && !top) {
    return `${notAValidLook} la parte de arriba.`;
  }
  if (!fullBody && !bottom) {
    return `${notAValidLook} la parte de abajo.`;
  }
  return null;
}
