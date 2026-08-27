import { describe, expect, it } from 'vitest';
import { engineVersion } from '../../stylist/engine/engine.constants';
import { measureVersion, type PurchaseMeasurement } from '@closetai/shared-types';
import { minimalistProfile } from '../../wardrobe-gaps/coverage/coverage.fixtures';
import { makeCandidate } from '../purchase-advice.fixtures';
import {
  adviceInstructions,
  buildAdvicePrompt,
  type IAdvicePromptGap,
  type IAdvicePromptInput,
} from './advice.prompt.v2';

/**
 * El prompt del veredicto. Lo que se comprueba aquí es lo que la v2 vino a
 * arreglar: que el modelo no repita el veredicto y que sólo pueda proponer lo
 * que de verdad está en la lista de la compra del usuario.
 */

const coatGap: IAdvicePromptGap = {
  shortId: 'b1',
  description: 'abrigo de lana gris',
  slot: 'OUTERWEAR',
  formality: 3,
  priority: 1,
  unlockedOutfitsEstimate: 4,
};

/**
 * Medición ya resuelta, con los números que el modelo puede citar.
 * @returns {PurchaseMeasurement}
 */
function makeMeasurement(): PurchaseMeasurement {
  return {
    garmentId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    verdict: 'CONDITIONAL',
    verdictReason: 'NO_IMPACT',
    impact: {
      unlockedOutfitsEstimate: 0,
      outfitsUsingItEstimate: 2,
      scoreGainPoints: 1,
      newlyCoveredScenarioLabels: [],
      pairedGarmentIds: [],
      duplicateGarmentIds: [],
      matchedGapId: null,
    },
    pairedGarments: [],
    duplicateGarments: [],
    note: null,
    canWriteAdvice: true,
    measureVersion,
    engineVersion,
  };
}

/**
 * Entrada del prompt con lo que el caso necesite cambiar.
 * @param {Partial<IAdvicePromptInput>} [overrides] - Campos que el caso fija.
 * @returns {IAdvicePromptInput}
 */
function makeInput(overrides: Partial<IAdvicePromptInput> = {}): IAdvicePromptInput {
  return {
    profile: minimalistProfile(),
    candidate: makeCandidate('Camisa beige', 'TOP'),
    measurement: makeMeasurement(),
    pairedGarments: [],
    duplicateNames: [],
    openGaps: [],
    hasPhoto: false,
    ...overrides,
  };
}

describe('adviceInstructions', () => {
  it('prohíbe repetir el veredicto, que es lo que hacía que no aportara nada', () => {
    expect(adviceInstructions).toContain('No repitas el veredicto ni lo parafrasees');
  });

  it('sigue prohibiendo contradecirlo', () => {
    expect(adviceInstructions).toContain('Tampoco lo contradigas ni lo suavices');
  });

  it('acota la alternativa a la lista y prohíbe inventarse una compra', () => {
    expect(adviceInstructions).toContain('SU LISTA DE LA COMPRA');
    expect(adviceInstructions).toContain('Nunca propongas algo que no esté ahí');
  });

  it('no deja describir a la persona de la foto', () => {
    expect(adviceInstructions).toContain('nunca a la persona que pueda aparecer en ella');
  });
});

describe('buildAdvicePrompt', () => {
  it('cita cada brecha por su id corto, con su puesto y lo que desbloquea', () => {
    const prompt = buildAdvicePrompt(makeInput({ openGaps: [coatGap] }));

    expect(prompt).toContain('SU LISTA DE LA COMPRA');
    expect(prompt).toContain('b1 · abrigo de lana gris');
    expect(prompt).toContain('puesto 1 de su lista');
    expect(prompt).toContain('desbloquearía 4 conjunto(s)');
  });

  it('omite el bloque de la lista si no hay brechas, en vez de dejarlo vacío', () => {
    const prompt = buildAdvicePrompt(makeInput());

    expect(prompt).not.toContain('SU LISTA DE LA COMPRA');
  });

  it('le dice al modelo que el veredicto ya está en pantalla', () => {
    const prompt = buildAdvicePrompt(makeInput());

    expect(prompt).toContain('VEREDICTO YA DECIDIDO (lo tiene delante, no lo repitas)');
  });

  it('no menciona ninguna foto cuando la prenda no tiene portada', () => {
    const prompt = buildAdvicePrompt(makeInput({ hasPhoto: false }));

    expect(prompt).not.toContain('La foto adjunta');
  });

  it('ata la foto a la prenda cuando sí viaja', () => {
    const prompt = buildAdvicePrompt(makeInput({ hasPhoto: true }));

    expect(prompt).toContain('La foto adjunta es esta prenda');
  });

  it('sólo cita los números que midió el motor', () => {
    const prompt = buildAdvicePrompt(makeInput());

    expect(prompt).toContain('Entra en 2 conjunto(s)');
    expect(prompt).toContain('De ésos, 0 son imposibles sin ella');
  });
});
