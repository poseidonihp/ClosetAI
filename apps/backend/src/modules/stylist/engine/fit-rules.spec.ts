import { describe, expect, it } from 'vitest';
import { evaluateFitRules } from './fit-rules';
import { neutralFitScore } from './engine.constants';
import { makeGarment, makeProfile } from './engine.fixtures';
import type { IOutfitDraft } from './outfit-draft';

/**
 * Construye un conjunto de prueba con la base y el calzado que pida el caso.
 * @param {Partial<IOutfitDraft>} [overrides] - Prendas concretas del caso.
 * @returns {IOutfitDraft}
 */
function makeDraft(overrides: Partial<IOutfitDraft> = {}): IOutfitDraft {
  return {
    top: makeGarment('t1', 'Camiseta', 'TOP'),
    bottom: makeGarment('b1', 'Jean', 'BOTTOM'),
    fullBody: null,
    footwear: makeGarment('f1', 'Tenis', 'FOOTWEAR'),
    layers: [],
    accessories: [],
    ...overrides,
  };
}

describe('evaluateFitRules', () => {
  it('sin datos de perfil no dice nada y deja la nota neutra', () => {
    const evaluation = evaluateFitRules(makeDraft(), makeProfile());

    expect(evaluation.notes).toHaveLength(0);
    expect(evaluation.score).toBe(neutralFitScore);
  });

  it('premia el corte que el usuario marcó como cómodo', () => {
    const draft = makeDraft({ bottom: makeGarment('b1', 'Jean', 'BOTTOM', { fit: 'RELAXED' }) });

    const matching = evaluateFitRules(draft, makeProfile({ preferredFits: ['REGULAR'] }));
    const notMatching = evaluateFitRules(makeDraft(), makeProfile({ preferredFits: ['SLIM'] }));

    expect(matching.score).toBeGreaterThan(notMatching.score);
    expect(matching.notes[0]).toContain('cómodo');
  });

  it('avisa cuando se acumulan prendas holgadas', () => {
    const draft = makeDraft({
      top: makeGarment('t1', 'Camiseta', 'TOP', { fit: 'OVERSIZED' }),
      bottom: makeGarment('b1', 'Jean', 'BOTTOM', { fit: 'RELAXED' }),
    });

    const evaluation = evaluateFitRules(draft, makeProfile());

    expect(evaluation.notes.join(' ')).toContain('volumen');
  });

  it('con altura baja habla de proporción citando la altura declarada', () => {
    const evaluation = evaluateFitRules(makeDraft(), makeProfile({ heightCm: 162 }));

    expect(evaluation.notes.join(' ')).toContain('162 cm');
    expect(evaluation.score).toBeGreaterThan(neutralFitScore);
  });

  it('con altura alta avisa de mangas y bajos', () => {
    const evaluation = evaluateFitRules(makeDraft(), makeProfile({ heightCm: 192 }));

    expect(evaluation.notes.join(' ')).toContain('192 cm');
  });

  it('las medidas sólo pueden premiar o comentar, nunca penalizar', () => {
    const measurements = { version: 1 as const, unit: 'cm' as const, shoulder: 46, hips: 62 };
    const profile = makeProfile({ measurements });

    const mixedFits = evaluateFitRules(
      makeDraft({ bottom: makeGarment('b1', 'Jean', 'BOTTOM', { fit: 'RELAXED' }) }),
      profile,
    );
    const sameFits = evaluateFitRules(makeDraft(), profile);

    expect(mixedFits.score).toBeGreaterThan(neutralFitScore);
    expect(sameFits.score).toBe(neutralFitScore);
    expect(sameFits.notes.join(' ')).toContain('hombros 46 cm');
  });

  it('una diferencia pequeña de medidas no genera nota', () => {
    const measurements = { version: 1 as const, unit: 'cm' as const, shoulder: 46, hips: 48 };

    const evaluation = evaluateFitRules(makeDraft(), makeProfile({ measurements }));

    expect(evaluation.notes).toHaveLength(0);
  });
});
