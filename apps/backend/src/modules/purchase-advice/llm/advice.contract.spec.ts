import { describe, expect, it } from 'vitest';
import { buildAdviceContract, parseAdviceDraft, type AdviceDraft } from './advice.contract';

/**
 * El contrato del veredicto. Comprueba las dos mitades: que el esquema que viaja
 * al proveedor cumpla lo que exige `strict: true`, y que la validación del
 * servidor rechace lo que el proveedor no debería haber dejado pasar.
 */

const garmentShortIds = ['g1', 'g2'];
const gapShortIds = ['b1', 'b2', 'b3'];

/**
 * Devuelve una propiedad de primer nivel del esquema.
 * @param {Record<string, unknown>} schema - Esquema construido.
 * @param {string} name - Nombre de la propiedad.
 * @returns {Record<string, unknown>}
 */
function propertyOf(schema: Record<string, unknown>, name: string): Record<string, unknown> {
  const properties = schema['properties'] as Record<string, Record<string, unknown>>;
  return properties[name] ?? {};
}

/**
 * Una respuesta con la forma mínima que exige el esquema.
 * @param {Partial<AdviceDraft>} [overrides] - Campos que el caso necesita fijar.
 * @returns {Record<string, unknown>}
 */
function makeDraft(overrides: Partial<AdviceDraft> = {}): Record<string, unknown> {
  return {
    headline: 'Póntela con el jean para el día a día.',
    reason: 'Entra en tres conjuntos y dos son imposibles sin ella.',
    stylingNotes: ['Con el jean azul.'],
    pairedGarmentIds: ['g1'],
    alternativeGapId: null,
    alternativeNote: null,
    ...overrides,
  };
}

describe('buildAdviceContract', () => {
  it('el esquema es estricto: nada de propiedades extra y todas obligatorias', () => {
    const { jsonSchema } = buildAdviceContract(garmentShortIds, gapShortIds);

    expect(jsonSchema['additionalProperties']).toBe(false);
    expect(jsonSchema['required']).toEqual([
      'headline',
      'reason',
      'stylingNotes',
      'pairedGarmentIds',
      'alternativeGapId',
      'alternativeNote',
    ]);
  });

  it('la alternativa sólo admite las brechas de esta petición, o ninguna', () => {
    const { jsonSchema } = buildAdviceContract(garmentShortIds, gapShortIds);
    const alternative = propertyOf(jsonSchema, 'alternativeGapId');

    expect(alternative['enum']).toEqual(['b1', 'b2', 'b3', null]);
    expect(alternative['type']).toEqual(['string', 'null']);
  });

  it('sin brechas abiertas no hay dónde inventarse una compra', () => {
    const { jsonSchema } = buildAdviceContract(garmentShortIds, []);
    const alternative = propertyOf(jsonSchema, 'alternativeGapId');

    expect(alternative['type']).toBe('null');
    expect(alternative['enum']).toBeUndefined();
  });

  it('devuelve los ids que se le pasaron, para que el ensamblado los resuelva', () => {
    const contract = buildAdviceContract(garmentShortIds, gapShortIds);

    expect(contract.garmentShortIds).toEqual(garmentShortIds);
    expect(contract.gapShortIds).toEqual(gapShortIds);
  });
});

describe('parseAdviceDraft', () => {
  it('acepta una respuesta bien formada', () => {
    const parsed = parseAdviceDraft(makeDraft());

    expect(parsed.headline).toContain('Póntela');
    expect(parsed.alternativeGapId).toBeNull();
  });

  it('acepta una alternativa con su nota', () => {
    const parsed = parseAdviceDraft(
      makeDraft({ alternativeGapId: 'b2', alternativeNote: 'Eso lo usarías más.' }),
    );

    expect(parsed.alternativeGapId).toBe('b2');
    expect(parsed.alternativeNote).toBe('Eso lo usarías más.');
  });

  it('rechaza una respuesta a la que le falta la alternativa', () => {
    const draft = makeDraft();
    delete draft['alternativeGapId'];

    expect(() => parseAdviceDraft(draft)).toThrow();
  });

  it('rechaza más notas de combinación de las permitidas', () => {
    const stylingNotes = ['Una.', 'Dos.', 'Tres.', 'Cuatro.'];

    expect(() => parseAdviceDraft(makeDraft({ stylingNotes }))).toThrow();
  });

  it('no comprueba que la brecha exista: eso es del ensamblado', () => {
    const parsed = parseAdviceDraft(makeDraft({ alternativeGapId: 'b9' }));

    expect(parsed.alternativeGapId).toBe('b9');
  });
});
