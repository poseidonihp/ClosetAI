import { describe, expect, it } from 'vitest';
import type { Garment } from '@closetai/shared-types';
import { makeGarment } from '../../stylist/engine/engine.fixtures';
import type { AdviceDraft } from './advice.contract';
import { assembleAdvice } from './advice-assembly';

/**
 * El ensamblado es la última barrera contra que el modelo empareje la candidata
 * con ropa que el usuario no tiene.
 */

const jeanId = 'a2222222-2222-4222-8222-222222222222';
const bootsId = 'a3333333-3333-4333-8333-333333333333';

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
 * Respuesta del modelo con los ids que el caso quiera probar.
 * @param {string[]} pairedGarmentIds - Ids cortos que devolvió el modelo.
 * @returns {AdviceDraft}
 */
function makeDraft(pairedGarmentIds: string[]): AdviceDraft {
  return {
    pairedGarmentIds,
    headline: 'Te la recomiendo',
    reason: 'Abre dos conjuntos que hoy no puedes armar.',
    stylingNotes: ['Con el jean azul y las botas.'],
  };
}

describe('assembleAdvice', () => {
  it('resuelve los ids cortos contra las prendas reales', () => {
    const result = assembleAdvice(makeDraft(['g1', 'g2']), garmentsByShortId());

    expect(result.pairedGarmentIds).toEqual([jeanId, bootsId]);
    expect(result.discarded).toEqual([]);
  });

  it('descarta una prenda que no estaba entre las que se le enseñaron', () => {
    const result = assembleAdvice(makeDraft(['g1', 'g9']), garmentsByShortId());

    expect(result.pairedGarmentIds).toEqual([jeanId]);
    expect(result.discarded).toHaveLength(1);
    expect(result.discarded[0]).toContain('no estaba entre las tuyas');
  });

  it('descarta la prenda repetida sin perder la primera', () => {
    const result = assembleAdvice(makeDraft(['g1', 'g1']), garmentsByShortId());

    expect(result.pairedGarmentIds).toEqual([jeanId]);
    expect(result.discarded[0]).toContain('ya estaba en la lista');
  });

  it('conserva el texto tal como lo escribió el modelo', () => {
    const result = assembleAdvice(makeDraft([]), garmentsByShortId());

    expect(result.headline).toBe('Te la recomiendo');
    expect(result.stylingNotes).toEqual(['Con el jean azul y las botas.']);
  });
});
