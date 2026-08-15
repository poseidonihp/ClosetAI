import { describe, expect, it } from 'vitest';
import type { Garment } from '@closetai/shared-types';
import {
  basicCloset,
  dressCloset,
  makeGarment,
  makeInput,
  makeRequest,
} from '../engine/engine.fixtures';
import type { IEngineInput } from '../engine/engine.types';
import { assembleOutfits, type IAssemblyContext } from './outfit-assembly';
import { toGarmentShortId, type StylistDraft, type StylistLookDraft } from './stylist.contract';

/**
 * La validación de la salida del estilista.
 */

const whiteTeeId = '11111111-1111-4111-8111-111111111111';
const blackTeeId = '22222222-2222-4222-8222-222222222222';
const jeanId = '33333333-3333-4333-8333-333333333333';
const sneakersId = '55555555-5555-4555-8555-555555555555';

/**
 * Monta el contexto de ensamblado con un clóset dado. El mapa de ids cortos se
 * construye con las prendas del clóset, igual que en producción.
 * @param {readonly Garment[]} closet - Prendas disponibles.
 * @param {Partial<IEngineInput>} [overrides] - Perfil, petición o historial a fijar.
 * @returns {IAssemblyContext}
 */
function makeContext(
  closet: readonly Garment[],
  overrides: Partial<IEngineInput> = {},
): IAssemblyContext {
  return {
    input: makeInput(closet, overrides),
    garmentsByShortId: new Map(closet.map((garment, index) => [toGarmentShortId(index), garment])),
  };
}

/**
 * Id corto de una prenda del clóset por su id real.
 * @param {IAssemblyContext} context - Contexto de ensamblado.
 * @param {string} garmentId - Id real de la prenda.
 * @returns {string}
 */
function shortIdOf(context: IAssemblyContext, garmentId: string): string {
  const entry = [...context.garmentsByShortId].find(([, garment]) => garment.id === garmentId);
  return entry?.[0] ?? 'g0';
}

/**
 * Un look del modelo con las prendas indicadas.
 * @param {readonly string[]} shortIds - Ids cortos que cita el modelo.
 * @param {Partial<StylistLookDraft>} [overrides] - Campos que el caso necesita fijar.
 * @returns {StylistLookDraft}
 */
function makeLook(
  shortIds: readonly string[],
  overrides: Partial<StylistLookDraft> = {},
): StylistLookDraft {
  return {
    items: shortIds.map(shortId => ({ garmentId: shortId, why: `Aporta algo (${shortId}).` })),
    title: 'Look de prueba',
    oneLiner: 'Una frase.',
    description: 'Un párrafo corto.',
    occasions: ['DAILY'],
    styleNotes: ['Nota de estilo.'],
    fitNotes: [],
    referenceBrands: { luxury: ['Marca A'], affordable: ['Marca B'] },
    qualityNote: null,
    ...overrides,
  };
}

/**
 * Envuelve unos looks en la respuesta del modelo.
 * @param {readonly StylistLookDraft[]} looks - Looks propuestos.
 * @returns {StylistDraft}
 */
function makeDraft(looks: readonly StylistLookDraft[]): StylistDraft {
  return { looks: [...looks], note: null };
}

describe('assembleOutfits — sólo prendas que existen', () => {
  it('acepta un look completo y le pone los datos del servidor', () => {
    const context = makeContext(basicCloset());
    const look = makeLook([
      shortIdOf(context, whiteTeeId),
      shortIdOf(context, jeanId),
      shortIdOf(context, sneakersId),
    ]);

    const result = assembleOutfits(makeDraft([look]), context);
    const [outfit] = result.accepted;

    expect(result.discarded).toHaveLength(0);
    expect(outfit?.garmentIds).toEqual([whiteTeeId, jeanId, sneakersId].sort());
    expect(outfit?.engineScore).toBeGreaterThan(0);
    expect(outfit?.scoreBreakdown.length).toBeGreaterThan(0);
    expect(outfit?.whyByGarmentId.get(jeanId)).toContain('Aporta algo');
  });

  it('descarta el look que cita una prenda inexistente, no la tanda entera', () => {
    const context = makeContext(basicCloset());
    const valid = makeLook([
      shortIdOf(context, whiteTeeId),
      shortIdOf(context, jeanId),
      shortIdOf(context, sneakersId),
    ]);
    const invented = makeLook(['g99']);

    const result = assembleOutfits(makeDraft([valid, invented]), context);

    expect(result.accepted).toHaveLength(1);
    expect(result.discarded).toHaveLength(1);
    expect(result.discarded[0]).toContain('no estaba entre las disponibles');
  });

  it('descarta el look que repite la misma prenda', () => {
    const context = makeContext(basicCloset());
    const jean = shortIdOf(context, jeanId);
    const look = makeLook([
      shortIdOf(context, whiteTeeId),
      jean,
      jean,
      shortIdOf(context, sneakersId),
    ]);

    const result = assembleOutfits(makeDraft([look]), context);

    expect(result.accepted).toHaveLength(0);
    expect(result.discarded[0]).toContain('repetía la misma prenda');
  });
});

describe('assembleOutfits — un look tiene que ser un look', () => {
  it('descarta el conjunto sin calzado', () => {
    const context = makeContext(basicCloset());
    const look = makeLook([shortIdOf(context, whiteTeeId), shortIdOf(context, jeanId)]);

    const result = assembleOutfits(makeDraft([look]), context);

    expect(result.accepted).toHaveLength(0);
    expect(result.discarded[0]).toContain('calzado');
  });

  it('descarta el conjunto sin parte de abajo', () => {
    const context = makeContext(basicCloset());
    const look = makeLook([shortIdOf(context, whiteTeeId), shortIdOf(context, sneakersId)]);

    const result = assembleOutfits(makeDraft([look]), context);

    expect(result.discarded[0]).toContain('parte de abajo');
  });

  it('descarta dos prendas para el mismo sitio', () => {
    const context = makeContext(basicCloset());
    const look = makeLook([
      shortIdOf(context, whiteTeeId),
      shortIdOf(context, blackTeeId),
      shortIdOf(context, jeanId),
      shortIdOf(context, sneakersId),
    ]);

    const result = assembleOutfits(makeDraft([look]), context);

    expect(result.discarded[0]).toContain('más de una prenda');
  });

  it('acepta una prenda entera con calzado y rechaza mezclarla con separables', () => {
    const closet = dressCloset();
    const context = makeContext(closet);
    const [dress, flats] = closet;
    const separate = makeGarment('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Jean', 'BOTTOM');
    const withSeparate = makeContext([...closet, separate]);

    const valid = assembleOutfits(
      makeDraft([
        makeLook([shortIdOf(context, dress?.id ?? ''), shortIdOf(context, flats?.id ?? '')]),
      ]),
      context,
    );
    const mixed = assembleOutfits(
      makeDraft([
        makeLook([
          shortIdOf(withSeparate, dress?.id ?? ''),
          shortIdOf(withSeparate, separate.id),
          shortIdOf(withSeparate, flats?.id ?? ''),
        ]),
      ]),
      withSeparate,
    );

    expect(valid.accepted).toHaveLength(1);
    expect(mixed.accepted).toHaveLength(0);
    expect(mixed.discarded[0]).toContain('prenda entera');
  });
});

describe('assembleOutfits — la petición manda', () => {
  it('descarta el look que ignora la prenda que se pidió incluir', () => {
    const context = makeContext(basicCloset(), {
      request: makeRequest({ mustIncludeGarmentId: jeanId }),
    });
    const without = makeLook([
      shortIdOf(context, whiteTeeId),
      shortIdOf(context, '44444444-4444-4444-8444-444444444444'),
      shortIdOf(context, sneakersId),
    ]);

    const result = assembleOutfits(makeDraft([without]), context);

    expect(result.accepted).toHaveLength(0);
    expect(result.discarded[0]).toContain('la prenda que pediste usar');
  });

  it('descarta el mismo conjunto propuesto dos veces', () => {
    const context = makeContext(basicCloset());
    const shortIds = [
      shortIdOf(context, whiteTeeId),
      shortIdOf(context, jeanId),
      shortIdOf(context, sneakersId),
    ];
    const twice = makeDraft([makeLook(shortIds), makeLook([...shortIds].reverse())]);

    const result = assembleOutfits(twice, context);

    expect(result.accepted).toHaveLength(1);
    expect(result.discarded[0]).toContain('el mismo conjunto');
  });

  it('con un solo look pedido, un primer candidato inválido no vacía la tanda', () => {
    // El tope cuenta los aceptados, no los que llegaron: si contara los que llegaron,
    // este caso devolvería cero looks después de haber pagado la llamada.
    const context = makeContext(basicCloset(), { request: makeRequest({ limit: 1 }) });
    const broken = makeLook([shortIdOf(context, whiteTeeId), shortIdOf(context, jeanId)]);
    const valid = makeLook([
      shortIdOf(context, whiteTeeId),
      shortIdOf(context, jeanId),
      shortIdOf(context, sneakersId),
    ]);

    const result = assembleOutfits(makeDraft([broken, valid]), context);

    expect(result.accepted).toHaveLength(1);
    expect(result.discarded).toHaveLength(1);
  });

  it('no devuelve más looks de los que se pidieron', () => {
    const context = makeContext(basicCloset(), { request: makeRequest({ limit: 1 }) });
    const first = makeLook([
      shortIdOf(context, whiteTeeId),
      shortIdOf(context, jeanId),
      shortIdOf(context, sneakersId),
    ]);
    const second = makeLook([
      shortIdOf(context, blackTeeId),
      shortIdOf(context, '44444444-4444-4444-8444-444444444444'),
      shortIdOf(context, sneakersId),
    ]);

    const result = assembleOutfits(makeDraft([first, second]), context);

    expect(result.accepted).toHaveLength(1);
    expect(result.discarded).toHaveLength(0);
  });
});

describe('assembleOutfits — narrativa', () => {
  it('conserva lo que escribió el estilista', () => {
    const context = makeContext(basicCloset());
    const look = makeLook(
      [shortIdOf(context, whiteTeeId), shortIdOf(context, jeanId), shortIdOf(context, sneakersId)],
      {
        title: 'Blanco y denim',
        qualityNote: 'El calzado es lo menos formal del conjunto.',
        referenceBrands: { luxury: ['Lemaire'], affordable: ['Uniqlo'] },
      },
    );

    const [outfit] = assembleOutfits(makeDraft([look]), context).accepted;

    expect(outfit?.narrative.title).toBe('Blanco y denim');
    expect(outfit?.narrative.qualityNote).toContain('menos formal');
    expect(outfit?.narrative.referenceBrands.affordable).toEqual(['Uniqlo']);
  });

  it('sin notas de ajuste del modelo se usan las que calculó el motor', () => {
    const context = makeContext(basicCloset(), {
      profile: { ...makeInput(basicCloset()).profile, heightCm: 165 },
    });
    const look = makeLook([
      shortIdOf(context, whiteTeeId),
      shortIdOf(context, jeanId),
      shortIdOf(context, sneakersId),
    ]);

    const [outfit] = assembleOutfits(makeDraft([look]), context).accepted;

    expect(outfit?.narrative.fitNotes.join(' ')).toContain('165 cm');
  });
});
