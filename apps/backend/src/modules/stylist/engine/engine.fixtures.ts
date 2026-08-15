import type { Garment, GarmentSlot, StyleProfile } from '@closetai/shared-types';
import type { IEngineInput, IEngineRequest } from './engine.types';
import { emptyFeedback, type IStyleFeedback } from './learning';

/**
 * Clósets sintéticos para los tests del motor.
 */

/** Fecha fija: la señal de variedad mira el calendario y debe ser estable. */
export const fixedNow = new Date('2026-08-06T12:00:00.000Z');

const defaultGarment: Omit<Garment, 'id' | 'name' | 'slot'> = {
  garmentTypeId: '00000000-0000-4000-8000-000000000000',
  garmentTypeName: 'Prenda',
  primaryColorHex: '#1a1815',
  primaryColorName: 'Negro',
  secondaryColorHex: null,
  pattern: 'SOLID',
  patternScale: 'NONE',
  material: 'COTTON',
  fit: 'REGULAR',
  formality: 2,
  seasons: [],
  weatherMinC: null,
  weatherMaxC: null,
  brand: null,
  brandGuess: null,
  size: null,
  taggingStatus: 'CONFIRMED',
  status: 'ACTIVE',
  wearCount: 0,
  lastWornAt: null,
  createdAt: '2026-07-01T10:00:00.000Z',
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
};

/**
 * Construye una prenda de prueba con valores por defecto razonables.
 * @param {string} id - Identificador de la prenda.
 * @param {string} name - Nombre visible.
 * @param {GarmentSlot} slot - Slot que ocupa.
 * @param {Partial<Garment>} [overrides] - Atributos que el caso necesita fijar.
 * @returns {Garment}
 */
export function makeGarment(
  id: string,
  name: string,
  slot: GarmentSlot,
  overrides: Partial<Garment> = {},
): Garment {
  return { ...defaultGarment, id, name, slot, ...overrides };
}

/**
 * Perfil vacío: todos los campos opcionales sin declarar, que es el caso por
 * defecto del producto.
 * @param {Partial<StyleProfile>} [overrides] - Campos que el caso necesita fijar.
 * @returns {StyleProfile}
 */
export function makeProfile(overrides: Partial<StyleProfile> = {}): StyleProfile {
  return {
    gender: null,
    heightCm: null,
    weightKg: null,
    bodyShape: null,
    shoeSize: null,
    skinTone: null,
    hairColor: null,
    measurements: null,
    presentationPreferences: [],
    styleArchetypes: [],
    preferredFits: [],
    avoidedColors: [],
    avoidedGarmentTypeIds: [],
    budgetTier: null,
    country: null,
    currency: null,
    city: null,
    climate: null,
    notes: null,
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

/**
 * Petición ya normalizada, con los valores por defecto del motor.
 * @param {Partial<IEngineRequest>} [overrides] - Campos que el caso necesita fijar.
 * @returns {IEngineRequest}
 */
export function makeRequest(overrides: Partial<IEngineRequest> = {}): IEngineRequest {
  return {
    styleTag: 'MINIMALIST',
    temperatureC: null,
    mustIncludeGarmentId: null,
    includeSuggested: false,
    limit: 3,
    ...overrides,
  };
}

/**
 * Historial de valoraciones. Por defecto vacío, que es el caso de un usuario que
 * todavía no ha guardado ni rechazado ningún look.
 * @param {Partial<IStyleFeedback>} [overrides] - Campos que el caso necesita fijar.
 * @returns {IStyleFeedback}
 */
export function makeFeedback(overrides: Partial<IStyleFeedback> = {}): IStyleFeedback {
  return { ...emptyFeedback, ...overrides };
}

/**
 * Ensambla la entrada completa del motor.
 * @param {readonly Garment[]} garments - Clóset del caso.
 * @param {Partial<IEngineInput>} [overrides] - Perfil, petición, fecha o historial a fijar.
 * @returns {IEngineInput}
 */
export function makeInput(
  garments: readonly Garment[],
  overrides: Partial<IEngineInput> = {},
): IEngineInput {
  return {
    garments,
    profile: makeProfile(),
    request: makeRequest(),
    now: fixedNow,
    feedback: emptyFeedback,
    ...overrides,
  };
}

/**
 * El clóset real de la verificación de la Fase 1: camiseta blanca, camiseta
 * negra, jean azul, chino negro y tenis blancos. Casual de principio a fin.
 * @returns {Garment[]}
 */
export function basicCloset(): Garment[] {
  return [
    makeGarment('11111111-1111-4111-8111-111111111111', 'Camiseta blanca', 'TOP', {
      garmentTypeName: 'Camiseta',
      primaryColorHex: '#f5f1e8',
      primaryColorName: 'Blanco',
      formality: 1,
      weatherMinC: 16,
      weatherMaxC: 40,
    }),
    makeGarment('22222222-2222-4222-8222-222222222222', 'Camiseta negra', 'TOP', {
      garmentTypeName: 'Camiseta',
      primaryColorHex: '#1a1815',
      primaryColorName: 'Negro',
      formality: 1,
      weatherMinC: 16,
      weatherMaxC: 40,
    }),
    makeGarment('33333333-3333-4333-8333-333333333333', 'Jean azul', 'BOTTOM', {
      garmentTypeName: 'Jean',
      primaryColorHex: '#3a5f96',
      primaryColorName: 'Azul',
      material: 'DENIM',
      formality: 2,
      weatherMinC: 5,
      weatherMaxC: 30,
    }),
    makeGarment('44444444-4444-4444-8444-444444444444', 'Chino negro', 'BOTTOM', {
      garmentTypeName: 'Pantalón chino',
      primaryColorHex: '#1a1815',
      primaryColorName: 'Negro',
      formality: 3,
      weatherMinC: 8,
      weatherMaxC: 30,
    }),
    makeGarment('55555555-5555-4555-8555-555555555555', 'Tenis blancos', 'FOOTWEAR', {
      garmentTypeName: 'Tenis',
      primaryColorHex: '#f5f1e8',
      primaryColorName: 'Blanco',
      formality: 2,
      weatherMinC: 5,
      weatherMaxC: 38,
    }),
  ];
}

/**
 * Clóset cuya única base es un vestido: sin la rama `FULL_BODY` no generaría nada.
 * @returns {Garment[]}
 */
export function dressCloset(): Garment[] {
  return [
    makeGarment('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Vestido midi verde', 'FULL_BODY', {
      garmentTypeName: 'Vestido casual',
      primaryColorHex: '#4a7c50',
      primaryColorName: 'Verde',
      formality: 3,
      weatherMinC: 18,
      weatherMaxC: 38,
    }),
    makeGarment('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Bailarinas beige', 'FOOTWEAR', {
      garmentTypeName: 'Bailarinas',
      primaryColorHex: '#d8c9ae',
      primaryColorName: 'Beige',
      formality: 3,
      weatherMinC: 14,
      weatherMaxC: 34,
    }),
    makeGarment('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Cárdigan crudo', 'MID_LAYER', {
      garmentTypeName: 'Cárdigan',
      primaryColorHex: '#f0ebdf',
      primaryColorName: 'Crudo',
      material: 'KNIT',
      formality: 3,
      weatherMinC: 8,
      weatherMaxC: 22,
    }),
  ];
}
