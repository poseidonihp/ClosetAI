import type { OutfitItemRole } from '@closetai/shared-types';
import type { IRenderGarmentPhoto, IRenderPhotoSelection } from './render.types';

/**
 * Fotos que se mandan como máximo. La API acepta muchas más, pero un look son
 * unas pocas prendas: el tope existe para que un conjunto raro no dispare el
 * costo de los tokens de entrada, no porque el proveedor lo exija.
 */
export const maxRenderImages = 8;

/** Qué se cae primero cuando sobran fotos: lo que no cambia el conjunto. */
const dropOrderByRole = { BASE: 0, FOOTWEAR: 1, LAYER: 2, ACCESSORY: 3 } as const satisfies Record<
  OutfitItemRole,
  number
>;

/**
 * Elige las fotos del render conservando el orden en que se listan las prendas.
 * @param {readonly IRenderGarmentPhoto[]} photos - Fotos de portada del look, en orden de ficha.
 * @param {number} [limit=maxRenderImages] - Tope de fotos que se mandan.
 * @returns {IRenderPhotoSelection}
 */
export function selectRenderPhotos(
  photos: readonly IRenderGarmentPhoto[],
  limit: number = maxRenderImages,
): IRenderPhotoSelection {
  if (photos.length <= limit) {
    return { selected: [...photos], droppedNames: [] };
  }

  const byPriority = photos
    .map((photo, position) => ({ photo, position }))
    .sort(
      (first, second) =>
        dropOrderByRole[first.photo.role] - dropOrderByRole[second.photo.role] ||
        first.position - second.position,
    );

  const keptPositions = new Set(byPriority.slice(0, limit).map(entry => entry.position));
  return {
    selected: photos.filter((_photo, position) => keptPositions.has(position)),
    droppedNames: photos
      .filter((_photo, position) => !keptPositions.has(position))
      .map(photo => photo.name),
  };
}
