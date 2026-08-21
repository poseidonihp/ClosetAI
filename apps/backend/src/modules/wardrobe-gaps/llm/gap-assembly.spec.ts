import { describe, expect, it } from 'vitest';
import type { GapHypothesis } from '@closetai/shared-types';
import { assembleGaps } from './gap-assembly';
import type { GapDraft, GapsDraft } from './gaps.contract';

/**
 * El ensamblado es la última barrera: lo que el modelo diga que no case con una
 * prenda candidata no llega a guardarse, y los demás sobreviven.
 */

const emptyBrands = { luxury: [], affordable: [] };

/**
 * Construye una prenda candidata de prueba.
 * @param {string} id - Id corto de la candidata.
 * @param {Partial<GapHypothesis>} [overrides] - Campos que el caso necesita fijar.
 * @returns {GapHypothesis}
 */
function makeHypothesis(id: string, overrides: Partial<GapHypothesis> = {}): GapHypothesis {
  return {
    id,
    garmentTypeId: '00000000-0000-4000-8000-000000000001',
    garmentTypeSlug: 'blazer',
    garmentTypeName: 'Blazer',
    slot: 'OUTERWEAR',
    colorName: 'Negro',
    colorHex: '#1a1815',
    formality: 4,
    unlockedOutfitsEstimate: 3,
    newlyCoveredScenarioIds: [],
    scoreGain: 8,
    priorityScore: 11,
    rationale: 'Abre 3 conjuntos que hoy no puedes armar.',
    ...overrides,
  };
}

/**
 * Construye una brecha tal como la redactaría el modelo.
 * @param {string} hypothesisId - Id corto que cita.
 * @param {Partial<GapDraft>} [overrides] - Campos que el caso necesita fijar.
 * @returns {GapDraft}
 */
function makeGapDraft(hypothesisId: string, overrides: Partial<GapDraft> = {}): GapDraft {
  return {
    hypothesisId,
    description: 'Blazer negro, corte regular',
    reason: 'Es lo único que te falta para llegar a una cena.',
    referenceBrands: emptyBrands,
    ...overrides,
  };
}

/**
 * Envuelve unas brechas en la respuesta completa del modelo.
 * @param {GapDraft[]} gaps - Brechas propuestas.
 * @returns {GapsDraft}
 */
function makeDraft(gaps: GapDraft[]): GapsDraft {
  return { gaps, note: null };
}

describe('assembleGaps', () => {
  it('el orden del modelo es la prioridad y los datos salen del motor', () => {
    const hypotheses = [
      makeHypothesis('h1', { unlockedOutfitsEstimate: 2 }),
      makeHypothesis('h2', { unlockedOutfitsEstimate: 7, garmentTypeSlug: 'mocasines' }),
    ];
    const result = assembleGaps(makeDraft([makeGapDraft('h2'), makeGapDraft('h1')]), hypotheses);

    expect(result.discarded).toEqual([]);
    expect(result.accepted.map(gap => gap.priority)).toEqual([1, 2]);
    expect(result.accepted[0]?.hypothesis.id).toBe('h2');
    expect(result.accepted[0]?.hypothesis.unlockedOutfitsEstimate).toBe(7);
  });

  it('descarta una brecha que cita una prenda inexistente y conserva las demás', () => {
    const result = assembleGaps(makeDraft([makeGapDraft('h9'), makeGapDraft('h1')]), [
      makeHypothesis('h1'),
    ]);

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.priority).toBe(1);
    expect(result.discarded[0]).toContain('propuesta 1');
  });

  it('descarta una prenda repetida sin tirar la primera', () => {
    const result = assembleGaps(
      makeDraft([makeGapDraft('h1'), makeGapDraft('h1', { description: 'Otro blazer' })]),
      [makeHypothesis('h1')],
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.description).toBe('Blazer negro, corte regular');
    expect(result.discarded[0]).toContain('repetía');
  });

  it('una respuesta sin brechas no es un error: el modelo puede no ver ninguna', () => {
    const result = assembleGaps(makeDraft([]), [makeHypothesis('h1')]);

    expect(result.accepted).toEqual([]);
    expect(result.discarded).toEqual([]);
  });
});
