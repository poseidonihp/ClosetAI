import { visionTaggingVersion, type Garment } from '@closetai/shared-types';
import { makeGarment } from '../stylist/engine/engine.fixtures';
import {
  coveredCloset,
  fixedNow,
  minimalistProfile,
  testCatalog,
} from '../wardrobe-gaps/coverage/coverage.fixtures';
import type { IOpenGapRef, IPurchaseEvaluationInput } from './purchase-advice.types';

/**
 * Candidatas sintéticas para los tests de "¿me lo compro?".
 */

/** Id del tipo "camisa" del catálogo reducido, que es formal. */
export const shirtTypeId = 'c0000000-0000-4000-8000-000000000002';

/** Id fijo de la candidata: los casos la citan por él. */
export const candidateId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/**
 * Construye la candidata que se va a evaluar. Nace como la deja el etiquetado:
 * `CONSIDERED` y `SUGGESTED`, nunca confirmada.
 * @param {string} name - Nombre visible de la prenda.
 * @param {Garment['slot']} slot - Slot que ocupa.
 * @param {Partial<Garment>} [overrides] - Atributos que el caso necesita fijar.
 * @returns {Garment}
 */
export function makeCandidate(
  name: string,
  slot: Garment['slot'],
  overrides: Partial<Garment> = {},
): Garment {
  const base = makeGarment(candidateId, name, slot);
  return {
    ...base,
    ownership: 'CONSIDERED',
    taggingStatus: 'SUGGESTED',
    tagging: { ...base.tagging, status: 'SUGGESTED', version: visionTaggingVersion },
    ...overrides,
  };
}

/**
 * Construye una brecha `OPEN` con lo que hace falta para cruzarla y ofrecerla.
 * @param {string} id - Id de la brecha.
 * @param {Partial<IOpenGapRef>} [overrides] - Lo que el caso necesita fijar.
 * @returns {IOpenGapRef}
 */
export function makeOpenGap(id: string, overrides: Partial<IOpenGapRef> = {}): IOpenGapRef {
  return {
    id,
    garmentTypeId: shirtTypeId,
    slot: 'TOP',
    colorHex: '#d8c9ae',
    colorName: 'Beige',
    formality: 3,
    description: 'camisa beige de corte regular',
    priority: 1,
    unlockedOutfitsEstimate: 2,
    ...overrides,
  };
}

/**
 * Ensambla la entrada de la evaluación sobre el clóset de la cobertura.
 * @param {Garment} candidate - Prenda que se está evaluando.
 * @param {Partial<IPurchaseEvaluationInput>} [overrides] - Lo que el caso fija.
 * @returns {IPurchaseEvaluationInput}
 */
export function makeEvaluationInput(
  candidate: Garment,
  overrides: Partial<IPurchaseEvaluationInput> = {},
): IPurchaseEvaluationInput {
  return {
    candidate,
    closet: coveredCloset(),
    profile: minimalistProfile(),
    catalog: testCatalog(),
    openGaps: [],
    now: fixedNow,
    ...overrides,
  };
}
