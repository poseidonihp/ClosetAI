import { describe, expect, it } from 'vitest';
import type { Garment } from '@closetai/shared-types';
import { emptyClosetFilters, hasActiveFilters, matchesFilters } from './closet-filters';

/**
 * Construye una prenda de prueba sobre una base razonable.
 * @param {Partial<Garment>} overrides - Campos que cambian respecto a la base.
 * @returns {Garment}
 */
function buildGarment(overrides: Partial<Garment> = {}): Garment {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Camiseta blanca',
    slot: 'TOP',
    garmentTypeId: '22222222-2222-2222-2222-222222222222',
    garmentTypeName: 'Camiseta',
    primaryColorHex: '#ffffff',
    primaryColorName: 'Blanco',
    secondaryColorHex: null,
    pattern: 'SOLID',
    patternScale: 'NONE',
    material: 'COTTON',
    fit: 'REGULAR',
    formality: 2,
    seasons: ['SPRING', 'SUMMER'],
    weatherMinC: 18,
    weatherMaxC: 34,
    brand: 'Uniqlo',
    brandGuess: null,
    size: 'M',
    taggingStatus: 'CONFIRMED',
    status: 'ACTIVE',
    wearCount: 0,
    lastWornAt: null,
    createdAt: '2026-08-05T00:00:00.000Z',
    photos: [],
    tagging: {
      status: 'CONFIRMED',
      version: null,
      taggedAt: null,
      model: null,
      jobStatus: null,
      attempts: 0,
      canRetry: true,
      costUsd: null,
      errorMessage: null,
      manualFields: [],
      reviewFields: [],
      personVisible: false,
      usableForTagging: true,
      unusableReason: null,
      notes: null,
    },
    ...overrides,
  };
}

describe('hasActiveFilters', () => {
  it('el clóset entero es el estado por defecto', () => {
    expect(hasActiveFilters(emptyClosetFilters)).toBe(false);
  });

  it('detecta cualquier filtro activo', () => {
    expect(hasActiveFilters({ ...emptyClosetFilters, search: 'jean' })).toBe(true);
    expect(hasActiveFilters({ ...emptyClosetFilters, slots: ['TOP'] })).toBe(true);
    expect(hasActiveFilters({ ...emptyClosetFilters, colorFamily: 'BLUE' })).toBe(true);
    expect(hasActiveFilters({ ...emptyClosetFilters, climate: 'COLD' })).toBe(true);
    expect(hasActiveFilters({ ...emptyClosetFilters, status: 'LAUNDRY' })).toBe(true);
  });

  it('ignora una búsqueda que sólo tiene espacios', () => {
    expect(hasActiveFilters({ ...emptyClosetFilters, search: '   ' })).toBe(false);
  });
});

describe('matchesFilters', () => {
  const garment = buildGarment();

  it('sin filtros pasa todo', () => {
    expect(matchesFilters(garment, emptyClosetFilters)).toBe(true);
  });

  it('busca en nombre, tipo, marca y color, sin distinguir mayúsculas', () => {
    for (const search of ['blanca', 'camiseta', 'uniqlo', 'BLANCO']) {
      expect(matchesFilters(garment, { ...emptyClosetFilters, search })).toBe(true);
    }
    expect(matchesFilters(garment, { ...emptyClosetFilters, search: 'botas' })).toBe(false);
  });

  it('filtra por slot', () => {
    expect(matchesFilters(garment, { ...emptyClosetFilters, slots: ['TOP'] })).toBe(true);
    expect(matchesFilters(garment, { ...emptyClosetFilters, slots: ['FOOTWEAR'] })).toBe(false);
    expect(matchesFilters(garment, { ...emptyClosetFilters, slots: ['TOP', 'BOTTOM'] })).toBe(true);
  });

  it('deriva la familia de color del hex, no del nombre escrito', () => {
    const azul = buildGarment({ primaryColorHex: '#3a5f96', primaryColorName: 'Cielo' });

    expect(matchesFilters(azul, { ...emptyClosetFilters, colorFamily: 'BLUE' })).toBe(true);
    expect(matchesFilters(azul, { ...emptyClosetFilters, colorFamily: 'WHITE' })).toBe(false);
  });

  it('compara el clima contra el rango de temperatura de la prenda', () => {
    // La camiseta va de 18 a 34 °C: sirve para clima cálido, no para frío.
    expect(matchesFilters(garment, { ...emptyClosetFilters, climate: 'HOT' })).toBe(true);
    expect(matchesFilters(garment, { ...emptyClosetFilters, climate: 'COLD' })).toBe(false);
  });

  it('no descarta una prenda sin rango de temperatura declarado', () => {
    const sinRango = buildGarment({ weatherMinC: null, weatherMaxC: null });

    expect(matchesFilters(sinRango, { ...emptyClosetFilters, climate: 'COLD' })).toBe(true);
  });

  it('el clima variable no acota nada', () => {
    expect(matchesFilters(garment, { ...emptyClosetFilters, climate: 'VARIABLE' })).toBe(true);
  });

  it('filtra por estado', () => {
    const enLavanderia = buildGarment({ status: 'LAUNDRY' });

    expect(matchesFilters(enLavanderia, { ...emptyClosetFilters, status: 'ACTIVE' })).toBe(false);
    expect(matchesFilters(enLavanderia, { ...emptyClosetFilters, status: 'LAUNDRY' })).toBe(true);
  });

  it('los filtros se acumulan', () => {
    const filters = {
      ...emptyClosetFilters,
      search: 'camiseta',
      slots: ['TOP'],
      colorFamily: 'WHITE' as const,
      climate: 'WARM' as const,
      status: 'ACTIVE' as const,
    };

    expect(matchesFilters(garment, filters)).toBe(true);
    expect(matchesFilters(garment, { ...filters, slots: ['BOTTOM'] })).toBe(false);
  });
});
