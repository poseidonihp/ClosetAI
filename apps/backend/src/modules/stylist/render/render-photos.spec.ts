import { describe, expect, it } from 'vitest';
import type { OutfitItemRole } from '@closetai/shared-types';
import { maxRenderImages, selectRenderPhotos } from './render-photos';
import type { IRenderGarmentPhoto } from './render.types';

/**
 * Qué fotos entran en el render decide qué prendas se ven en la imagen y cuánto
 * cuesta la llamada, así que el orden y el recorte no pueden depender de la suerte.
 */

/**
 * Foto de prenda con lo único que mira la selección.
 * @param {string} name - Nombre de la prenda.
 * @param {OutfitItemRole} role - Papel dentro del look.
 * @returns {IRenderGarmentPhoto}
 */
function makePhoto(name: string, role: OutfitItemRole): IRenderGarmentPhoto {
  return {
    name,
    role,
    garmentId: `garment-${name}`,
    storageKey: `user/outfit/${name}.webp`,
    mimeType: 'image/webp',
  };
}

const base = makePhoto('camiseta', 'BASE');
const bottom = makePhoto('jean', 'BASE');
const footwear = makePhoto('sneakers', 'FOOTWEAR');
const layer = makePhoto('chaqueta', 'LAYER');
const scarf = makePhoto('bufanda', 'ACCESSORY');
const cap = makePhoto('gorra', 'ACCESSORY');

describe('selectRenderPhotos', () => {
  it('conserva todas las fotos y su orden cuando caben', () => {
    const selection = selectRenderPhotos([base, bottom, footwear, layer]);

    expect(selection.selected.map(photo => photo.name)).toEqual([
      'camiseta',
      'jean',
      'sneakers',
      'chaqueta',
    ]);
    expect(selection.droppedNames).toEqual([]);
  });

  it('cuando sobran, deja fuera los accesorios antes que el núcleo', () => {
    const selection = selectRenderPhotos([base, bottom, footwear, layer, scarf, cap], 4);

    expect(selection.selected.map(photo => photo.name)).toEqual([
      'camiseta',
      'jean',
      'sneakers',
      'chaqueta',
    ]);
    expect(selection.droppedNames).toEqual(['bufanda', 'gorra']);
  });

  it('con el tope al mínimo conserva la base y el calzado, no las capas', () => {
    const selection = selectRenderPhotos([layer, base, bottom, footwear, scarf], 3);

    expect(selection.selected.map(photo => photo.role)).toEqual(['BASE', 'BASE', 'FOOTWEAR']);
    expect(selection.droppedNames).toEqual(['chaqueta', 'bufanda']);
  });

  it('un look sin fotos no manda ninguna', () => {
    expect(selectRenderPhotos([])).toEqual({ selected: [], droppedNames: [] });
  });

  it('el tope por defecto da para un look completo con capas y accesorios', () => {
    const complete = [base, bottom, footwear, layer, layer, scarf, cap];

    expect(complete.length).toBeLessThanOrEqual(maxRenderImages);
    expect(selectRenderPhotos(complete).droppedNames).toEqual([]);
  });
});
