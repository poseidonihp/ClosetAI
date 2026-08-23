import { colorFamilyFromHex, type Garment } from '@closetai/shared-types';
import { formalityBandBreakpoints } from './purchase-advice.constants';

/**
 * Qué prenda del clóset hace el mismo papel que la candidata.
 */

/**
 * Banda de formalidad de un nivel de la escala 1–5. Se comparan bandas y no
 * niveles porque una camisa de formalidad 3 y otra de 4 son la misma compra.
 * @param {number} formality - Nivel de formalidad de la prenda.
 * @returns {number}
 */
export function formalityBand(formality: number): number {
  return formalityBandBreakpoints.filter(breakpoint => formality > breakpoint).length;
}

/**
 * Prendas del clóset que duplican a la candidata: mismo tipo, mismo slot, misma
 * familia de color y misma banda de formalidad.
 * @param {Garment} candidate - Prenda que se está evaluando.
 * @param {readonly Garment[]} closet - Prendas que el usuario ya tiene.
 * @returns {string[]}
 */
export function findDuplicates(candidate: Garment, closet: readonly Garment[]): string[] {
  const family = colorFamilyFromHex(candidate.primaryColorHex);
  const band = formalityBand(candidate.formality);

  return closet
    .filter(
      garment =>
        garment.id !== candidate.id &&
        garment.slot === candidate.slot &&
        garment.garmentTypeId === candidate.garmentTypeId &&
        colorFamilyFromHex(garment.primaryColorHex) === family &&
        formalityBand(garment.formality) === band,
    )
    .map(garment => garment.id);
}
