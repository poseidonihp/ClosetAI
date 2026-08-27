import { describe, expect, it } from 'vitest';
import type { Garment } from '@closetai/shared-types';
import { makeGarment } from '../../stylist/engine/engine.fixtures';
import { makeOpenGap } from '../purchase-advice.fixtures';
import type { IOpenGapRef } from '../purchase-advice.types';
import type { AdviceDraft } from './advice.contract';
import { assembleAdvice } from './advice-assembly';

/**
 * El ensamblado es la última barrera contra que el modelo empareje la candidata
 * con ropa que el usuario no tiene, o le proponga comprar algo que no está en su
 * lista.
 */

const jeanId = 'a2222222-2222-4222-8222-222222222222';
const bootsId = 'a3333333-3333-4333-8333-333333333333';
const coatGapId = 'd1111111-1111-4111-8111-111111111111';
const shoesGapId = 'd2222222-2222-4222-8222-222222222222';

/**
 * Clóset por id corto tal como se le enseñó al modelo.
 * @returns {Map<string, Garment>}
 */
function garmentsByShortId(): Map<string, Garment> {
  return new Map([
    ['g1', makeGarment(jeanId, 'Jean azul', 'BOTTOM')],
    ['g2', makeGarment(bootsId, 'Botas marrones', 'FOOTWEAR')],
  ]);
}

/**
 * Brechas abiertas por id corto tal como se le ofrecieron al modelo.
 * @returns {Map<string, IOpenGapRef>}
 */
function gapsByShortId(): Map<string, IOpenGapRef> {
  return new Map([
    ['b1', makeOpenGap(coatGapId, { description: 'abrigo de lana gris' })],
    ['b2', makeOpenGap(shoesGapId, { description: 'zapatos formales negros' })],
  ]);
}

/**
 * Respuesta del modelo con lo que el caso quiera probar.
 * @param {Partial<AdviceDraft>} [overrides] - Campos que el caso fija.
 * @returns {AdviceDraft}
 */
function makeDraft(overrides: Partial<AdviceDraft> = {}): AdviceDraft {
  return {
    headline: 'Póntela con el jean para el día a día.',
    reason: 'Abre dos conjuntos que hoy no puedes armar.',
    stylingNotes: ['Con el jean azul y las botas.'],
    pairedGarmentIds: [],
    alternativeGapId: null,
    alternativeNote: null,
    ...overrides,
  };
}

describe('assembleAdvice', () => {
  it('resuelve los ids cortos contra las prendas reales', () => {
    const result = assembleAdvice(
      makeDraft({ pairedGarmentIds: ['g1', 'g2'] }),
      garmentsByShortId(),
      gapsByShortId(),
    );

    expect(result.pairedGarmentIds).toEqual([jeanId, bootsId]);
    expect(result.discarded).toEqual([]);
  });

  it('descarta una prenda que no estaba entre las que se le enseñaron', () => {
    const result = assembleAdvice(
      makeDraft({ pairedGarmentIds: ['g1', 'g9'] }),
      garmentsByShortId(),
      gapsByShortId(),
    );

    expect(result.pairedGarmentIds).toEqual([jeanId]);
    expect(result.discarded).toHaveLength(1);
    expect(result.discarded[0]).toContain('no estaba entre las tuyas');
  });

  it('descarta la prenda repetida sin perder la primera', () => {
    const result = assembleAdvice(
      makeDraft({ pairedGarmentIds: ['g1', 'g1'] }),
      garmentsByShortId(),
      gapsByShortId(),
    );

    expect(result.pairedGarmentIds).toEqual([jeanId]);
    expect(result.discarded[0]).toContain('ya estaba en la lista');
  });

  it('conserva el texto tal como lo escribió el modelo', () => {
    const result = assembleAdvice(makeDraft(), garmentsByShortId(), gapsByShortId());

    expect(result.headline).toBe('Póntela con el jean para el día a día.');
    expect(result.stylingNotes).toEqual(['Con el jean azul y las botas.']);
  });
});

describe('assembleAdvice - la alternativa', () => {
  it('resuelve la brecha propuesta y copia su descripción', () => {
    const result = assembleAdvice(
      makeDraft({ alternativeGapId: 'b1', alternativeNote: 'Te abriga y lo usas más.' }),
      garmentsByShortId(),
      gapsByShortId(),
    );

    expect(result.alternative).toEqual({
      gapId: coatGapId,
      label: 'abrigo de lana gris',
      note: 'Te abriga y lo usas más.',
    });
    expect(result.discarded).toEqual([]);
  });

  it('descarta una alternativa que no estaba en la lista, sin tirar el resto', () => {
    const result = assembleAdvice(
      makeDraft({
        pairedGarmentIds: ['g1'],
        alternativeGapId: 'b9',
        alternativeNote: 'Cómprate otra cosa.',
      }),
      garmentsByShortId(),
      gapsByShortId(),
    );

    expect(result.alternative).toBeNull();
    expect(result.pairedGarmentIds).toEqual([jeanId]);
    expect(result.discarded[0]).toContain('no estaba en la lista');
  });

  it('no deja una nota suelta cuando el modelo no propuso ninguna brecha', () => {
    const result = assembleAdvice(
      makeDraft({ alternativeGapId: null, alternativeNote: 'Mejor compra otra cosa.' }),
      garmentsByShortId(),
      gapsByShortId(),
    );

    expect(result.alternative).toBeNull();
    expect(result.discarded[0]).toContain('no venía con ninguna brecha');
  });

  it('no inventa un descarte cuando sencillamente no hay alternativa', () => {
    const result = assembleAdvice(makeDraft(), garmentsByShortId(), gapsByShortId());

    expect(result.alternative).toBeNull();
    expect(result.discarded).toEqual([]);
  });

  it('acepta una brecha sin nota: la descripción ya dice qué comprar', () => {
    const result = assembleAdvice(
      makeDraft({ alternativeGapId: 'b2', alternativeNote: '   ' }),
      garmentsByShortId(),
      gapsByShortId(),
    );

    expect(result.alternative).toEqual({
      gapId: shoesGapId,
      label: 'zapatos formales negros',
      note: '',
    });
  });
});
