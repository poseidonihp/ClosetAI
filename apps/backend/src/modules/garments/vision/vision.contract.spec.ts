import { describe, expect, it } from 'vitest';
import { GarmentSlotEnum, type VisionAttributes } from '@closetai/shared-types';
import { buildVisionContract, parseVisionAttributes } from './vision.contract';

/**
 * El contrato es la única barrera entre "el modelo dijo algo" y "la prenda
 * cambió". Estos casos comprueban las dos mitades: que el esquema que viaja al
 * proveedor cumpla lo que exige `strict: true`, y que la validación del
 * servidor rechace lo que el proveedor no debería haber dejado pasar.
 */

const catalogSlugs = ['camiseta', 'jean', 'tenis'];

/**
 * Salida válida mínima con la que comparar las variantes rotas.
 * @param {Partial<VisionAttributes>} [overrides] - Campos que el caso cambia.
 * @returns {Record<string, unknown>}
 */
function validAttributes(overrides: Partial<VisionAttributes> = {}): Record<string, unknown> {
  return {
    garmentTypeSlug: 'camiseta',
    slot: 'TOP',
    suggestedName: 'Camiseta blanca de algodón',
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
    brandGuess: null,
    confidence: {
      garmentType: 'HIGH',
      color: 'HIGH',
      pattern: 'HIGH',
      material: 'MEDIUM',
      fit: 'MEDIUM',
      formality: 'HIGH',
      brand: 'LOW',
    },
    personVisible: false,
    notes: null,
    ...overrides,
  };
}

describe('buildVisionContract', () => {
  it('declara el catálogo real como enum, para que el modelo no invente un tipo', () => {
    const { jsonSchema } = buildVisionContract(catalogSlugs);
    const properties = jsonSchema.properties as Record<string, Record<string, unknown>>;

    expect(properties.garmentTypeSlug?.enum).toEqual(catalogSlugs);
  });

  it('cumple lo que exige strict: sin propiedades extra y con todas obligatorias', () => {
    const { jsonSchema } = buildVisionContract(catalogSlugs);
    const properties = jsonSchema.properties as Record<string, unknown>;

    expect(jsonSchema.additionalProperties).toBe(false);
    expect(jsonSchema.required).toEqual(Object.keys(properties));
  });

  it('expresa lo opcional como unión con null y no omitiendo el campo', () => {
    const { jsonSchema } = buildVisionContract(catalogSlugs);
    const properties = jsonSchema.properties as Record<string, Record<string, unknown>>;

    expect(properties.secondaryColorHex?.type).toEqual(['string', 'null']);
    expect(properties.brandGuess?.type).toEqual(['string', 'null']);
    expect(properties.weatherMinC?.type).toEqual(['integer', 'null']);
    expect(jsonSchema.required).toContain('brandGuess');
  });

  it('exige al menos una temporada, que es donde no basta la prosa del prompt', () => {
    const { jsonSchema } = buildVisionContract(catalogSlugs);
    const properties = jsonSchema.properties as Record<string, Record<string, unknown>>;

    expect(properties.seasons?.minItems).toBe(1);
    expect(properties.seasons?.maxItems).toBe(4);
  });

  it('el objeto anidado de confianza también es estricto', () => {
    const { jsonSchema } = buildVisionContract(catalogSlugs);
    const properties = jsonSchema.properties as Record<string, Record<string, unknown>>;
    const confidence = properties.confidence;

    expect(confidence?.additionalProperties).toBe(false);
    expect(confidence?.required).toEqual(Object.keys(confidence?.properties as object));
  });

  it('le da al modelo una forma de negarse, con su motivo', () => {
    const { jsonSchema } = buildVisionContract(catalogSlugs);
    const properties = jsonSchema.properties as Record<string, Record<string, unknown>>;

    expect(properties.usableForTagging?.type).toBe('boolean');
    expect(properties.unusableReason?.type).toEqual(['string', 'null']);
    expect(jsonSchema.required).toContain('usableForTagging');
    expect(jsonSchema.required).toContain('unusableReason');
  });

  it('distingue "hay una persona" de "no se puede catalogar"', () => {
    const { jsonSchema } = buildVisionContract(catalogSlugs);
    const properties = jsonSchema.properties as Record<string, Record<string, unknown>>;

    expect(properties.personVisible?.description).not.toBe(
      properties.usableForTagging?.description,
    );
    expect(String(properties.usableForTagging?.description)).toContain('aunque alguien la lleve');
  });

  it('no pide ningún atributo sobre la persona de la foto, sólo si aparece', () => {
    const { jsonSchema } = buildVisionContract(catalogSlugs);
    const fields = Object.keys(jsonSchema.properties as object);

    expect(fields).toContain('personVisible');
    expect(fields.filter(field => /gender|age|body|skin|ethnic/i.test(field))).toEqual([]);
  });

  it('declara los slots del dominio y no una lista propia', () => {
    const { jsonSchema } = buildVisionContract(catalogSlugs);
    const properties = jsonSchema.properties as Record<string, Record<string, unknown>>;

    expect(properties.slot?.enum).toEqual(GarmentSlotEnum.options);
  });
});

describe('parseVisionAttributes', () => {
  it('acepta una salida completa y bien formada', () => {
    const parsed = parseVisionAttributes(validAttributes(), catalogSlugs);

    expect(parsed.garmentTypeSlug).toBe('camiseta');
    expect(parsed.confidence.brand).toBe('LOW');
  });

  it('rechaza un tipo de prenda que no está en el catálogo', () => {
    const raw = validAttributes({ garmentTypeSlug: 'kimono-inventado' });

    expect(() => parseVisionAttributes(raw, catalogSlugs)).toThrow();
  });

  it('rechaza un color que no es hex', () => {
    const raw = validAttributes({ primaryColorHex: 'blanco roto' });

    expect(() => parseVisionAttributes(raw, catalogSlugs)).toThrow();
  });

  it('rechaza una formalidad fuera de la escala 1–5', () => {
    const raw = validAttributes({ formality: 9 });

    expect(() => parseVisionAttributes(raw, catalogSlugs)).toThrow();
  });

  it('rechaza una salida sin el bloque de confianza', () => {
    const raw = validAttributes();
    delete raw.confidence;

    expect(() => parseVisionAttributes(raw, catalogSlugs)).toThrow();
  });

  it('lee la negativa del modelo con su motivo', () => {
    const parsed = parseVisionAttributes(
      validAttributes({
        usableForTagging: false,
        unusableReason: 'Es un retrato: no se distingue ninguna prenda.',
      }),
      catalogSlugs,
    );

    expect(parsed.usableForTagging).toBe(false);
    expect(parsed.unusableReason).toContain('retrato');
  });

  it('un borrador guardado antes de v4 sigue parseando y se da por utilizable', () => {
    const legacy = validAttributes();
    delete legacy.usableForTagging;
    delete legacy.unusableReason;

    const parsed = parseVisionAttributes(legacy, catalogSlugs);

    expect(parsed.usableForTagging).toBe(true);
    expect(parsed.unusableReason).toBeNull();
  });
});
