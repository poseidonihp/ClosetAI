import { describe, expect, it } from 'vitest';
import type { GenerateOutfitsRequest } from '@closetai/shared-types';
import { generateLooks } from '../engine/engine';
import { maxGarmentsInEnum } from './stylist.contract';
import { basicCloset, makeGarment, makeInput, makeRequest } from '../engine/engine.fixtures';
import type { IEngineInput } from '../engine/engine.types';
import { buildStylistInput } from './stylist-input';

/**
 * Lo que se le enseña al modelo.
 */

const jeanId = '33333333-3333-4333-8333-333333333333';
const sneakersId = '55555555-5555-4555-8555-555555555555';

/**
 * Petición del estilista con los valores por defecto.
 * @param {Partial<GenerateOutfitsRequest>} [overrides] - Campos que el caso fija.
 * @returns {GenerateOutfitsRequest}
 */
function makeOutfitsRequest(
  overrides: Partial<GenerateOutfitsRequest> = {},
): GenerateOutfitsRequest {
  return {
    styleTag: 'MINIMALIST',
    occasion: null,
    temperatureC: null,
    climate: null,
    mustIncludeGarmentId: null,
    includeSuggested: false,
    limit: 3,
    ...overrides,
  };
}

/**
 * Corre el motor y construye la entrada del estilista sobre su resultado.
 * @param {IEngineInput} input - Entrada del motor.
 * @param {Partial<GenerateOutfitsRequest>} [overrides] - Campos de la petición.
 * @returns {ReturnType<typeof buildStylistInput>}
 */
function build(
  input: IEngineInput,
  overrides: Partial<GenerateOutfitsRequest> = {},
): ReturnType<typeof buildStylistInput> {
  return buildStylistInput(input, generateLooks(input), makeOutfitsRequest(overrides));
}

describe('buildStylistInput — el enum de prendas', () => {
  it('sólo lleva prendas del clóset y con ids posicionales', () => {
    const closet = basicCloset();
    const result = build(makeInput(closet));
    const closetIds = new Set(closet.map(garment => garment.id));

    expect(result.garmentsByShortId.size).toBeGreaterThan(0);
    for (const [shortId, garment] of result.garmentsByShortId) {
      expect(shortId).toMatch(/^g\d+$/);
      expect(closetIds.has(garment.id)).toBe(true);
    }
  });

  it('no incluye una prenda que el motor descartó', () => {
    const closet = basicCloset().map(garment =>
      garment.id === jeanId ? { ...garment, status: 'LAUNDRY' as const } : garment,
    );

    const result = build(makeInput(closet));

    expect([...result.garmentsByShortId.values()].some(garment => garment.id === jeanId)).toBe(
      false,
    );
  });

  it('tampoco cuela la prenda de la lavandería aunque el usuario la exija', () => {
    const closet = basicCloset().map(garment =>
      garment.id === jeanId ? { ...garment, status: 'LAUNDRY' as const } : garment,
    );

    const result = build(
      makeInput(closet, { request: makeRequest({ mustIncludeGarmentId: jeanId }) }),
      {
        mustIncludeGarmentId: jeanId,
      },
    );

    expect([...result.garmentsByShortId.values()].some(garment => garment.id === jeanId)).toBe(
      false,
    );
  });

  it('la prenda exigida disponible va primera, para que el recorte no la pierda', () => {
    const result = build(
      makeInput(basicCloset(), {
        request: makeRequest({ mustIncludeGarmentId: sneakersId }),
      }),
      { mustIncludeGarmentId: sneakersId },
    );

    expect(result.garmentsByShortId.get('g1')?.id).toBe(sneakersId);
  });

  it('respeta el tope del esquema con un clóset grande', () => {
    const extras = Array.from({ length: 40 }, (_unused, index) =>
      makeGarment(
        `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`,
        `Camiseta ${index}`,
        'TOP',
        { formality: 2 },
      ),
    );

    const result = build(makeInput([...basicCloset(), ...extras]));

    expect(result.garmentsByShortId.size).toBeLessThanOrEqual(maxGarmentsInEnum);
  });
});

describe('buildStylistInput — la composición va decidida', () => {
  /**
   * Clóset con una capa y un accesorio disponibles.
   * @returns {ReturnType<typeof basicCloset>}
   */
  function closetWithExtras(): ReturnType<typeof basicCloset> {
    return [
      ...basicCloset(),
      makeGarment('77777777-7777-4777-8777-777777777777', 'Chaqueta oliva', 'OUTERWEAR', {
        weatherMinC: -5,
        weatherMaxC: 20,
      }),
      makeGarment('88888888-8888-4888-8888-888888888888', 'Gafas de sol', 'ACCESSORY'),
    ];
  }

  it('con fresco dice que el look lleva capa y la nombra', () => {
    const result = build(
      makeInput(closetWithExtras(), { request: makeRequest({ temperatureC: 16 }) }),
    );
    const advice = result.promptInput.compositionAdvice.join(' ');

    expect(advice).toContain('LLEVA capa');
    expect(advice).toContain('Chaqueta oliva');
  });

  it('con temperatura templada la capa pasa a ser opcional pero sigue disponible', () => {
    const result = build(
      makeInput(closetWithExtras(), { request: makeRequest({ temperatureC: 24 }) }),
    );
    const advice = result.promptInput.compositionAdvice.join(' ');

    expect(advice).toContain('no hace falta capa');
    expect(advice).not.toContain('LLEVA capa');
    // El motor no la metió en ningún candidato porque a 24 °C no suma, pero tiene
    // que llegar igualmente al enum: la ocasión también puede pedirla, y eso lo
    // decide la Capa 2. Fuera del enum, el modelo no podría ni nombrarla.
    expect(
      [...result.garmentsByShortId.values()].some(garment => garment.slot === 'OUTERWEAR'),
    ).toBe(true);
  });

  it('sin capas en el clóset se le dice que no invente ninguna', () => {
    const result = build(makeInput(basicCloset(), { request: makeRequest({ temperatureC: 16 }) }));
    const advice = result.promptInput.compositionAdvice.join(' ');

    expect(advice).toContain('No hay ninguna capa disponible');
  });

  it('los accesorios disponibles se nombran uno a uno', () => {
    const result = build(makeInput(closetWithExtras()));
    const advice = result.promptInput.compositionAdvice.join(' ');

    expect(advice).toContain('Gafas de sol');
  });

  it('sin accesorios se le dice que no mencione ninguno', () => {
    const result = build(makeInput(basicCloset()));
    const advice = result.promptInput.compositionAdvice.join(' ');

    expect(advice).toContain('No hay accesorios disponibles');
  });
});

describe('buildStylistInput — combinaciones y huella', () => {
  it('las combinaciones citan ids que están en el enum', () => {
    const result = build(makeInput(basicCloset()));
    const shortIds = new Set(result.garmentsByShortId.keys());

    expect(result.promptInput.combinations.length).toBeGreaterThan(0);
    for (const combination of result.promptInput.combinations) {
      for (const shortId of combination.shortIds) {
        expect(shortIds.has(shortId)).toBe(true);
      }
    }
  });

  it('la misma entrada produce siempre la misma huella', () => {
    const first = build(makeInput(basicCloset()));
    const second = build(makeInput(basicCloset()));

    expect(first.candidateSetHash).toBe(second.candidateSetHash);
    expect(first.candidateSetHash).toHaveLength(16);
  });

  it('un clóset distinto produce otra huella', () => {
    const first = build(makeInput(basicCloset()));
    const second = build(
      makeInput([
        ...basicCloset(),
        makeGarment('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Mocasines', 'FOOTWEAR', {
          formality: 4,
        }),
      ]),
    );

    expect(first.candidateSetHash).not.toBe(second.candidateSetHash);
  });
});
