import { describe, expect, it } from 'vitest';
import type { GarmentType as GarmentTypeRow } from '@prisma/client';
import type { VisionAttributes } from '@closetai/shared-types';
import { GarmentTaggingService } from './garment-tagging.service';

/**
 * Traducción de lo que dice el modelo a columnas de la prenda. Lo que se prueba
 * aquí es dónde manda el catálogo y no el modelo: el slot, porque el tipo ya lo
 * determina, y las temporadas cuando el modelo no acota ninguna.
 */

/**
 * Tipo del catálogo con las temporadas que declara.
 * @param {Partial<GarmentTypeRow>} overrides - Campos que el caso fija.
 * @returns {GarmentTypeRow}
 */
function makeType(overrides: Partial<GarmentTypeRow> = {}): GarmentTypeRow {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    slug: 'jean',
    name: 'Jean',
    slot: 'BOTTOM',
    appliesTo: 'BOTH',
    defaultFormality: 2,
    typicalSeasons: ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'],
    defaultWeatherMinC: 5,
    defaultWeatherMaxC: 30,
    sortOrder: 20,
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    updatedAt: new Date('2026-08-01T10:00:00.000Z'),
    ...overrides,
  };
}

/**
 * Salida del modelo con lo mínimo que mira el mapeo.
 * @param {Partial<VisionAttributes>} overrides - Campos que el caso fija.
 * @returns {VisionAttributes}
 */
function makeAttributes(overrides: Partial<VisionAttributes> = {}): VisionAttributes {
  return {
    garmentTypeSlug: 'jean',
    slot: 'BOTTOM',
    suggestedName: 'Jean azul de corte slim',
    primaryColorHex: '#3b5b92',
    primaryColorName: 'Azul medio',
    secondaryColorHex: null,
    pattern: 'SOLID',
    patternScale: 'NONE',
    material: 'DENIM',
    fit: 'SLIM',
    formality: 2,
    seasons: ['AUTUMN', 'WINTER'],
    weatherMinC: 10,
    weatherMaxC: 28,
    brandGuess: null,
    confidence: {
      garmentType: 'HIGH',
      color: 'HIGH',
      pattern: 'HIGH',
      material: 'HIGH',
      fit: 'MEDIUM',
      formality: 'MEDIUM',
      brand: 'LOW',
    },
    personVisible: false,
    usableForTagging: true,
    unusableReason: null,
    notes: null,
    ...overrides,
  };
}

describe('GarmentTaggingService.toSuggestedData', () => {
  it('respeta las temporadas que sí acotó el modelo', () => {
    const data = GarmentTaggingService.toSuggestedData(makeAttributes(), makeType());

    expect(data.seasons).toEqual(['AUTUMN', 'WINTER']);
  });

  it('una lista vacía cae al catálogo, no se guarda como "ninguna temporada"', () => {
    const data = GarmentTaggingService.toSuggestedData(makeAttributes({ seasons: [] }), makeType());

    expect(data.seasons).toEqual(['SPRING', 'SUMMER', 'AUTUMN', 'WINTER']);
  });

  it('el catálogo del abrigo no se convierte en "cualquier época" al caer vacío', () => {
    const coat = makeType({
      slug: 'abrigo',
      slot: 'OUTERWEAR',
      typicalSeasons: ['AUTUMN', 'WINTER'],
    });

    const data = GarmentTaggingService.toSuggestedData(makeAttributes({ seasons: [] }), coat);

    expect(data.seasons).toEqual(['AUTUMN', 'WINTER']);
  });

  it('el slot lo pone el catálogo, aunque el modelo proponga otro', () => {
    const data = GarmentTaggingService.toSuggestedData(
      makeAttributes({ slot: 'TOP' }),
      makeType({ slot: 'BOTTOM' }),
    );

    expect(data.slot).toBe('BOTTOM');
    expect(data.garmentTypeId).toBe(makeType().id);
  });

  it('no escribe la marca: una conjetura no es un dato del usuario', () => {
    const data = GarmentTaggingService.toSuggestedData(
      makeAttributes({ brandGuess: 'Levi’s' }),
      makeType(),
    );

    expect(data).not.toHaveProperty('brand');
    expect(data).not.toHaveProperty('brandGuess');
  });

  it('sólo propone atributos de la prenda, nunca estado ni talla', () => {
    const data = GarmentTaggingService.toSuggestedData(makeAttributes(), makeType());

    expect(data).not.toHaveProperty('status');
    expect(data).not.toHaveProperty('size');
  });
});
