import { describe, expect, it } from 'vitest';
import type { GarmentImage as GarmentImageRow } from '@prisma/client';
import { maxVisionImages } from '@closetai/shared-types';
import { GarmentTaggingService } from './garment-tagging.service';

/**
 * Qué fotos entran en la llamada y en qué orden no es un detalle: el prompt
 * declara la primera como la principal —es la que decide cuál es la prenda si
 * otra foto enseña más ropa— y el orden alimenta la clave de idempotencia, así
 * que si no fuera estable la misma prenda pagaría dos veces.
 */

/**
 * Fila de imagen con lo que mira la selección.
 * @param {Partial<GarmentImageRow>} overrides - Campos que el caso fija.
 * @returns {GarmentImageRow}
 */
function makeImage(overrides: Partial<GarmentImageRow>): GarmentImageRow {
  return {
    id: `img-${overrides.sortOrder ?? 0}-${overrides.kind ?? 'ORIGINAL'}`,
    garmentId: '11111111-1111-4111-8111-111111111111',
    kind: 'ORIGINAL',
    storageKey: 'user/garment/foto.webp',
    mimeType: 'image/webp',
    width: 1200,
    height: 1600,
    byteSize: 120_000,
    isPrimary: false,
    sortOrder: 0,
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    ...overrides,
  };
}

/**
 * Tira de fotos originales con su miniatura, como las guarda la subida.
 * @param {number} count - Cuántas fotos tiene la prenda.
 * @param {number} primarySortOrder - Cuál es la portada.
 * @returns {GarmentImageRow[]}
 */
function makeGallery(count: number, primarySortOrder = 0): GarmentImageRow[] {
  const images: GarmentImageRow[] = [];
  for (let sortOrder = 0; sortOrder < count; sortOrder += 1) {
    const isPrimary = sortOrder === primarySortOrder;
    images.push(makeImage({ sortOrder, isPrimary, kind: 'ORIGINAL' }));
    images.push(makeImage({ sortOrder, isPrimary, kind: 'THUMB' }));
  }
  return images;
}

describe('GarmentTaggingService.selectPhotos', () => {
  it('ignora las miniaturas: al modelo va la imagen acotada, no la del grid', () => {
    const selected = GarmentTaggingService.selectPhotos(makeGallery(2));

    expect(selected).toHaveLength(2);
    expect(selected.every(photo => photo.kind === 'ORIGINAL')).toBe(true);
  });

  it('pone la portada primero aunque se subiera al final', () => {
    const selected = GarmentTaggingService.selectPhotos(makeGallery(3, 2));

    expect(selected[0]?.sortOrder).toBe(2);
    expect(selected.map(photo => photo.sortOrder)).toEqual([2, 0, 1]);
  });

  it('sin portada marcada usa la primera que se subió', () => {
    const withoutPrimary = makeGallery(2).map(image => ({ ...image, isPrimary: false }));

    const selected = GarmentTaggingService.selectPhotos(withoutPrimary);

    expect(selected[0]?.sortOrder).toBe(0);
  });

  it('recorta al tope de fotos por llamada', () => {
    const selected = GarmentTaggingService.selectPhotos(makeGallery(maxVisionImages + 3));

    expect(selected).toHaveLength(maxVisionImages);
  });

  it('la portada nunca se pierde en el recorte', () => {
    const lastIsCover = maxVisionImages + 2;
    const selected = GarmentTaggingService.selectPhotos(makeGallery(lastIsCover + 1, lastIsCover));

    expect(selected[0]?.sortOrder).toBe(lastIsCover);
    expect(selected).toHaveLength(maxVisionImages);
  });

  it('no repite la portada dentro del conjunto', () => {
    const selected = GarmentTaggingService.selectPhotos(makeGallery(3, 1));
    const ids = selected.map(photo => photo.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('el orden es estable entre llamadas, para no pagar dos veces la misma entrada', () => {
    const gallery = makeGallery(3, 1);

    const first = GarmentTaggingService.selectPhotos(gallery).map(photo => photo.id);
    const second = GarmentTaggingService.selectPhotos([...gallery].reverse()).map(
      photo => photo.id,
    );

    expect(second).toEqual(first);
  });

  it('una prenda sin fotos originales no se puede etiquetar', () => {
    const onlyThumbs = makeGallery(1).filter(image => image.kind === 'THUMB');

    expect(() => GarmentTaggingService.selectPhotos(onlyThumbs)).toThrow();
    expect(() => GarmentTaggingService.selectPhotos([])).toThrow();
  });
});
