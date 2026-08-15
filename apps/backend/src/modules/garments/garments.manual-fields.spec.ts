import { describe, expect, it } from 'vitest';
import type { CreateGarment } from '@closetai/shared-types';
import { GarmentsService, type GarmentRowWithRelations } from './garments.service';

/**
 * Fila de prenda mínima pero completa, con los atributos que miran los casos.
 * @param {Partial<GarmentRowWithRelations>} [overrides] - Campos que el caso fija.
 * @returns {GarmentRowWithRelations}
 */
function makeRow(overrides: Partial<GarmentRowWithRelations> = {}): GarmentRowWithRelations {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    name: 'Camiseta blanca',
    slot: 'TOP',
    garmentTypeId: '33333333-3333-4333-8333-333333333333',
    primaryColorHex: '#f5f5f5',
    primaryColorName: 'Blanco',
    secondaryColorHex: null,
    pattern: 'SOLID',
    patternScale: 'NONE',
    material: 'COTTON',
    fit: 'REGULAR',
    formality: 2,
    seasons: ['SPRING', 'SUMMER'],
    weatherMinC: 16,
    weatherMaxC: 34,
    brand: null,
    brandGuess: null,
    size: null,
    aiAttributes: null,
    attributeConfidence: null,
    taggingVersion: null,
    taggedAt: null,
    taggingStatus: 'SUGGESTED',
    taggingJobId: null,
    manualFields: [],
    status: 'ACTIVE',
    wearCount: 0,
    lastWornAt: null,
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    updatedAt: new Date('2026-08-01T10:00:00.000Z'),
    garmentType: { name: 'Camiseta' },
    images: [],
    taggingJob: null,
    ...overrides,
  };
}

describe('GarmentsService.manualFieldsAfter', () => {
  it('no marca nada cuando el formulario reenvía los mismos valores', () => {
    const current = makeRow();
    const dto: Partial<CreateGarment> = {
      name: current.name,
      formality: current.formality,
      material: current.material,
      seasons: [...current.seasons],
    };

    expect(GarmentsService.manualFieldsAfter(current, dto)).toEqual([]);
  });

  it('marca sólo el atributo que cambia de valor', () => {
    const current = makeRow();
    const dto: Partial<CreateGarment> = {
      name: current.name,
      material: 'LINEN',
    };

    expect(GarmentsService.manualFieldsAfter(current, dto)).toEqual(['material']);
  });

  it('compara los arrays por contenido y no por identidad', () => {
    const current = makeRow();

    expect(GarmentsService.manualFieldsAfter(current, { seasons: ['SPRING', 'SUMMER'] })).toEqual(
      [],
    );
    expect(GarmentsService.manualFieldsAfter(current, { seasons: ['WINTER'] })).toEqual([
      'seasons',
    ]);
  });

  it('conserva los atributos ya marcados aunque esta vez no se toquen', () => {
    const current = makeRow({ manualFields: ['primaryColorHex'] });

    const result = GarmentsService.manualFieldsAfter(current, { material: 'LINEN' });

    expect(result).toContain('primaryColorHex');
    expect(result).toContain('material');
  });

  it('descarta nombres guardados que ya no son atributos válidos', () => {
    const current = makeRow({ manualFields: ['primaryColorHex', 'campoDeUnaVersionVieja'] });

    expect(GarmentsService.manualFieldsAfter(current, {})).toEqual(['primaryColorHex']);
  });

  it('un campo que se vacía a null también cuenta como corrección manual', () => {
    const current = makeRow({ weatherMinC: 16 });

    expect(GarmentsService.manualFieldsAfter(current, { weatherMinC: null })).toEqual([
      'weatherMinC',
    ]);
  });
});
