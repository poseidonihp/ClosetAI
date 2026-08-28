import type { Garment, GarmentType, StyleProfile } from '@closetai/shared-types';
import { makeGarment, makeProfile } from '../../stylist/engine/engine.fixtures';
import type { ICoverageInput } from './coverage.types';

/**
 * Catálogo y clósets sintéticos para los tests del análisis de vacíos.
 *
 * El catálogo es una versión reducida del sembrado: lo justo para que cada slot
 * tenga opciones formales y casuales, que es lo que decide qué hipótesis salen.
 */

/** Fecha fija: la señal de variedad del motor mira el calendario. */
export const fixedNow = new Date('2026-08-15T12:00:00.000Z');

const defaultType: Omit<GarmentType, 'id' | 'slug' | 'name' | 'slot'> = {
  appliesTo: 'BOTH',
  defaultFormality: 2,
  typicalSeasons: [],
  defaultWeatherMinC: null,
  defaultWeatherMaxC: null,
  sortOrder: 0,
};

/**
 * Construye un tipo de catálogo de prueba.
 * @param {string} id - Identificador del tipo.
 * @param {string} slug - Slug estable del catálogo.
 * @param {string} name - Nombre visible.
 * @param {GarmentType['slot']} slot - Slot que ocupa.
 * @param {Partial<GarmentType>} [overrides] - Atributos que el caso necesita fijar.
 * @returns {GarmentType}
 */
export function makeType(
  id: string,
  slug: string,
  name: string,
  slot: GarmentType['slot'],
  overrides: Partial<GarmentType> = {},
): GarmentType {
  return { ...defaultType, id, slug, name, slot, ...overrides };
}

/** Catálogo reducido: casual y formal en cada slot que importa. */
export function testCatalog(): GarmentType[] {
  return [
    makeType('c0000000-0000-4000-8000-000000000001', 'camiseta', 'Camiseta', 'TOP', {
      defaultFormality: 1,
      defaultWeatherMinC: 16,
      defaultWeatherMaxC: 40,
      sortOrder: 1,
    }),
    makeType('c0000000-0000-4000-8000-000000000002', 'camisa', 'Camisa', 'TOP', {
      defaultFormality: 4,
      defaultWeatherMinC: 10,
      defaultWeatherMaxC: 30,
      sortOrder: 2,
    }),
    makeType('c0000000-0000-4000-8000-000000000003', 'jean', 'Jean', 'BOTTOM', {
      defaultFormality: 2,
      defaultWeatherMinC: 0,
      defaultWeatherMaxC: 32,
      sortOrder: 3,
    }),
    makeType('c0000000-0000-4000-8000-000000000004', 'pantalon-vestir', 'Pantalón de vestir', 'BOTTOM', {
      defaultFormality: 4,
      defaultWeatherMinC: 5,
      defaultWeatherMaxC: 30,
      sortOrder: 4,
    }),
    makeType('c0000000-0000-4000-8000-000000000005', 'tenis', 'Tenis', 'FOOTWEAR', {
      defaultFormality: 2,
      defaultWeatherMinC: 0,
      defaultWeatherMaxC: 38,
      sortOrder: 5,
    }),
    makeType('c0000000-0000-4000-8000-000000000006', 'mocasines', 'Mocasines', 'FOOTWEAR', {
      defaultFormality: 4,
      defaultWeatherMinC: 5,
      defaultWeatherMaxC: 32,
      sortOrder: 6,
    }),
    makeType('c0000000-0000-4000-8000-000000000007', 'chaqueta', 'Chaqueta', 'OUTERWEAR', {
      defaultFormality: 3,
      defaultWeatherMinC: -5,
      defaultWeatherMaxC: 20,
      sortOrder: 7,
    }),
    makeType('c0000000-0000-4000-8000-000000000008', 'blazer', 'Blazer', 'OUTERWEAR', {
      defaultFormality: 4,
      defaultWeatherMinC: 0,
      defaultWeatherMaxC: 24,
      sortOrder: 8,
    }),
  ];
}

/**
 * Clóset que cubre sus escenarios: base casual completa más abrigo para el fresco.
 * Con un perfil minimalista y clima templado no debería faltar nada.
 * @returns {Garment[]}
 */
export function coveredCloset(): Garment[] {
  return [
    makeGarment('a1111111-1111-4111-8111-111111111111', 'Camiseta manga larga negra', 'TOP', {
      garmentTypeName: 'Camiseta de manga larga',
      primaryColorHex: '#1a1815',
      primaryColorName: 'Negro',
      formality: 2,
      weatherMinC: 5,
      weatherMaxC: 28,
    }),
    makeGarment('a2222222-2222-4222-8222-222222222222', 'Jean azul', 'BOTTOM', {
      garmentTypeName: 'Jean',
      primaryColorHex: '#3a5f96',
      primaryColorName: 'Azul',
      material: 'DENIM',
      formality: 2,
      weatherMinC: 0,
      weatherMaxC: 30,
    }),
    makeGarment('a3333333-3333-4333-8333-333333333333', 'Botas marrones', 'FOOTWEAR', {
      garmentTypeName: 'Botas',
      primaryColorHex: '#6b4a2f',
      primaryColorName: 'Marrón',
      formality: 3,
      weatherMinC: 0,
      weatherMaxC: 30,
    }),
    makeGarment('a4444444-4444-4444-8444-444444444444', 'Chaqueta gris', 'OUTERWEAR', {
      garmentTypeName: 'Chaqueta',
      primaryColorHex: '#8b8b8b',
      primaryColorName: 'Gris',
      formality: 3,
      weatherMinC: -5,
      weatherMaxC: 20,
    }),
  ];
}

/**
 * Ensambla la entrada del análisis.
 * @param {readonly Garment[]} garments - Clóset del caso.
 * @param {Partial<ICoverageInput>} [overrides] - Perfil, catálogo o descartes a fijar.
 * @returns {ICoverageInput}
 */
export function makeCoverageInput(
  garments: readonly Garment[],
  overrides: Partial<ICoverageInput> = {},
): ICoverageInput {
  return {
    garments,
    profile: makeProfile(),
    catalog: testCatalog(),
    dismissed: [],
    now: fixedNow,
    ...overrides,
  };
}

/**
 * Perfil minimalista con clima templado: dos escenarios, uno de ellos fresco.
 * @param {Partial<StyleProfile>} [overrides] - Campos que el caso necesita fijar.
 * @returns {StyleProfile}
 */
export function minimalistProfile(overrides: Partial<StyleProfile> = {}): StyleProfile {
  return makeProfile({ styleArchetypes: ['MINIMALIST'], climate: 'TEMPERATE', ...overrides });
}
