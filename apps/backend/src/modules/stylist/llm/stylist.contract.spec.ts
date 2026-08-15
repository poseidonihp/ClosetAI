import { describe, expect, it } from 'vitest';
import { LookOccasionEnum } from '@closetai/shared-types';
import {
  buildStylistContract,
  parseStylistDraft,
  toGarmentShortId,
  type StylistLookDraft,
} from './stylist.contract';

/**
 * El contrato del estilista.
 */

const shortIds = ['g1', 'g2', 'g3'];

/**
 * Navega el JSON Schema hasta el enum de `garmentId`.
 * @param {Record<string, unknown>} schema - Esquema construido.
 * @returns {unknown}
 */
function garmentIdEnum(schema: Record<string, unknown>): unknown {
  const properties = schema['properties'] as Record<string, Record<string, unknown>>;
  const looks = properties['looks'] as Record<string, Record<string, unknown>>;
  const lookItems = looks['items'] as Record<string, Record<string, unknown>>;
  const lookProperties = lookItems['properties'] as Record<string, Record<string, unknown>>;
  const items = lookProperties['items'] as Record<string, Record<string, unknown>>;
  const entry = items['items'] as Record<string, Record<string, unknown>>;
  const entryProperties = entry['properties'] as Record<string, Record<string, unknown>>;
  return entryProperties['garmentId']?.['enum'];
}

/**
 * Un look con la forma mínima que exige el esquema.
 * @param {Partial<StylistLookDraft>} [overrides] - Campos que el caso necesita fijar.
 * @returns {Record<string, unknown>}
 */
function makeLook(overrides: Partial<StylistLookDraft> = {}): Record<string, unknown> {
  return {
    items: [{ garmentId: 'g1', why: 'Ancla el conjunto.' }],
    title: 'Minimalista en blanco',
    oneLiner: 'Sencillo y directo.',
    description: 'Una base neutra con calzado limpio.',
    occasions: ['DAILY'],
    styleNotes: ['Paleta corta.'],
    fitNotes: [],
    referenceBrands: { luxury: [], affordable: [] },
    qualityNote: null,
    ...overrides,
  };
}

/**
 * Copia un look sin una de sus propiedades, para comprobar que el esquema la exige.
 * @param {Record<string, unknown>} look - Look de partida.
 * @param {string} key - Propiedad que se quita.
 * @returns {Record<string, unknown>}
 */
function withoutKey(look: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(look).filter(([name]) => name !== key));
}

describe('buildStylistContract', () => {
  it('el enum de prendas es exactamente el de esta petición', () => {
    const contract = buildStylistContract(shortIds);

    expect(garmentIdEnum(contract.jsonSchema)).toEqual(shortIds);
    expect(contract.garmentShortIds).toEqual(shortIds);
  });

  it('el esquema es estricto: nada de propiedades extra y todas obligatorias', () => {
    const contract = buildStylistContract(shortIds);

    expect(contract.jsonSchema['additionalProperties']).toBe(false);
    expect(contract.jsonSchema['required']).toEqual(['looks', 'note']);
  });

  it('las ocasiones se restringen al vocabulario del producto', () => {
    const contract = buildStylistContract(shortIds);
    const properties = contract.jsonSchema['properties'] as Record<string, Record<string, unknown>>;
    const looks = properties['looks'] as Record<string, Record<string, unknown>>;
    const lookItems = looks['items'] as Record<string, Record<string, unknown>>;
    const lookProperties = lookItems['properties'] as Record<string, Record<string, unknown>>;
    const occasions = lookProperties['occasions'] as Record<string, Record<string, unknown>>;

    expect(occasions['items']?.['enum']).toEqual(LookOccasionEnum.options);
  });

  it('los ids cortos son posicionales y empiezan en g1', () => {
    expect(toGarmentShortId(0)).toBe('g1');
    expect(toGarmentShortId(39)).toBe('g40');
  });
});

describe('parseStylistDraft', () => {
  it('acepta una respuesta bien formada', () => {
    const parsed = parseStylistDraft({ looks: [makeLook()], note: null });

    expect(parsed.looks).toHaveLength(1);
    expect(parsed.looks[0]?.items[0]?.garmentId).toBe('g1');
  });

  it('acepta una respuesta sin looks: el modelo puede no encontrar ninguno', () => {
    const parsed = parseStylistDraft({ looks: [], note: 'No tienes calzado formal.' });

    expect(parsed.looks).toHaveLength(0);
    expect(parsed.note).toContain('calzado formal');
  });

  it('rechaza un look sin prendas', () => {
    expect(() => parseStylistDraft({ looks: [makeLook({ items: [] })], note: null })).toThrow();
  });

  it('rechaza una ocasión que no está en el vocabulario', () => {
    expect(() =>
      parseStylistDraft({ looks: [{ ...makeLook(), occasions: ['BODA'] }], note: null }),
    ).toThrow();
  });

  it('rechaza que falte un campo del esquema', () => {
    expect(() =>
      parseStylistDraft({ looks: [withoutKey(makeLook(), 'qualityNote')], note: null }),
    ).toThrow();
  });

  it('no comprueba que la prenda exista: eso es del ensamblado', () => {
    const parsed = parseStylistDraft({
      looks: [makeLook({ items: [{ garmentId: 'g99', why: 'No existe.' }] })],
      note: null,
    });

    expect(parsed.looks[0]?.items[0]?.garmentId).toBe('g99');
  });
});
