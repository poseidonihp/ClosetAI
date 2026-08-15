import { describe, expect, it } from 'vitest';
import type { Look, OutfitRejectedReason } from '@closetai/shared-types';
import { generateLooks } from './engine';
import { basicCloset, makeFeedback, makeGarment, makeInput, makeRequest } from './engine.fixtures';
import { garmentSetKey } from './outfit-draft';

/**
 * El bucle de aprendizaje de la Fase 4.
 */

const whiteTeeId = '11111111-1111-4111-8111-111111111111';
const blackTeeId = '22222222-2222-4222-8222-222222222222';
const jeanId = '33333333-3333-4333-8333-333333333333';
const chinoId = '44444444-4444-4444-8444-444444444444';
const sneakersId = '55555555-5555-4555-8555-555555555555';

/**
 * Ids de las prendas de un look, ordenados.
 * @param {Look} look - Look generado.
 * @returns {string[]}
 */
function idsOf(look: Look): string[] {
  return look.items.map(item => item.garmentId).sort();
}

/**
 * Nota de la señal de preferencias del mejor look.
 * @param {ReturnType<typeof generateLooks>} result - Resultado del motor.
 * @returns {number}
 */
function preferenceScore(result: ReturnType<typeof generateLooks>): number {
  const line = result.looks[0]?.scoreBreakdown.find(entry => entry.signal === 'PREFERENCE');
  return line?.score ?? 0;
}

/**
 * Razón de la señal de preferencias del mejor look.
 * @param {ReturnType<typeof generateLooks>} result - Resultado del motor.
 * @returns {string}
 */
function preferenceReason(result: ReturnType<typeof generateLooks>): string {
  const line = result.looks[0]?.scoreBreakdown.find(entry => entry.signal === 'PREFERENCE');
  return line?.reason ?? '';
}

/**
 * Genera looks con un rechazo concreto en el historial.
 * @param {readonly string[]} garmentIdList - Prendas del look rechazado.
 * @param {OutfitRejectedReason} reason - Motivo del rechazo.
 * @returns {ReturnType<typeof generateLooks>}
 */
function withRejection(
  garmentIdList: readonly string[],
  reason: OutfitRejectedReason,
): ReturnType<typeof generateLooks> {
  return generateLooks(
    makeInput(basicCloset(), {
      feedback: makeFeedback({
        rejected: [{ garmentIds: [...garmentIdList], reason }],
        generatedKeys: [garmentSetKey(garmentIdList)],
      }),
    }),
  );
}

describe('aprendizaje — el conjunto rechazado no vuelve', () => {
  it('el look que el usuario rechazó deja de ser el primero', () => {
    const before = generateLooks(makeInput(basicCloset(), { request: makeRequest({ limit: 1 }) }));
    const rejected = idsOf(before.looks[0] as Look);

    const after = generateLooks(
      makeInput(basicCloset(), {
        request: makeRequest({ limit: 1 }),
        feedback: makeFeedback({
          rejected: [{ garmentIds: rejected, reason: 'NOT_MY_STYLE' }],
          generatedKeys: [garmentSetKey(rejected)],
        }),
      }),
    );

    expect(idsOf(after.looks[0] as Look)).not.toEqual(rejected);
    expect(after.looks.length).toBeGreaterThan(0);
  });

  it('un conjunto ya propuesto baja de nota sin desaparecer', () => {
    const fresh = generateLooks(makeInput(basicCloset(), { request: makeRequest({ limit: 1 }) }));
    const proposed = idsOf(fresh.looks[0] as Look);

    const repeated = generateLooks(
      makeInput(basicCloset(), {
        request: makeRequest({ limit: 5 }),
        feedback: makeFeedback({ generatedKeys: [garmentSetKey(proposed)] }),
      }),
    );

    const keys = repeated.looks.map(look => garmentSetKey(idsOf(look)));
    expect(keys).toContain(garmentSetKey(proposed));
    expect(keys[0]).not.toBe(garmentSetKey(proposed));
  });
});

describe('aprendizaje — cada motivo penaliza lo suyo', () => {
  it('rechazar por color penaliza la paleta, no las prendas', () => {
    const withJean = withRejection([whiteTeeId, jeanId, sneakersId], 'COLOR');
    const jeanLooks = withJean.looks.filter(look => idsOf(look).includes(jeanId));
    const chinoLooks = withJean.looks.filter(look => idsOf(look).includes(chinoId));

    expect(chinoLooks.length).toBeGreaterThan(0);
    expect(idsOf(withJean.looks[0] as Look)).toContain(chinoId);
    expect(jeanLooks.length + chinoLooks.length).toBe(withJean.looks.length);
  });

  it('rechazar por demasiado casual empuja hacia el conjunto más formal que haya', () => {
    const casual = withRejection([whiteTeeId, jeanId, sneakersId], 'TOO_CASUAL');

    expect(idsOf(casual.looks[0] as Look)).toContain(chinoId);
    expect(preferenceScore(casual)).toBeLessThan(
      preferenceScore(generateLooks(makeInput(basicCloset()))),
    );
  });

  it('si ya no queda nada más formal, la nota lo explica', () => {
    const casual = withRejection([blackTeeId, chinoId, sneakersId], 'TOO_CASUAL');

    expect(preferenceReason(casual)).toContain('demasiado casual');
  });

  it('rechazar por incómodo penaliza los conjuntos con los mismos cortes', () => {
    const uncomfortable = withRejection([whiteTeeId, jeanId, sneakersId], 'UNCOMFORTABLE');

    expect(preferenceReason(uncomfortable)).toContain('incómodo');
  });

  it('una prenda no disponible no enseña nada al motor', () => {
    const unavailable = withRejection([whiteTeeId, jeanId, sneakersId], 'GARMENT_UNAVAILABLE');
    const reason = preferenceReason(unavailable);

    expect(reason).not.toContain('Ya rechazaste looks con');
  });
});

describe('aprendizaje — lo que gusta premia', () => {
  it('las prendas de looks guardados suben la nota del conjunto', () => {
    const neutral = generateLooks(makeInput(basicCloset(), { request: makeRequest({ limit: 1 }) }));
    const liked = generateLooks(
      makeInput(basicCloset(), {
        request: makeRequest({ limit: 1 }),
        feedback: makeFeedback({ likedGarmentIds: [blackTeeId, chinoId, sneakersId] }),
      }),
    );

    expect(idsOf(liked.looks[0] as Look)).toEqual([blackTeeId, chinoId, sneakersId].sort());
    expect(preferenceScore(liked)).toBeGreaterThan(preferenceScore(neutral));
    expect(preferenceReason(liked)).toContain('Guardaste o usaste');
  });

  it('sin historial la señal no penaliza a nadie y lo dice', () => {
    const result = generateLooks(makeInput(basicCloset()));

    expect(preferenceReason(result)).toContain('Todavía no has valorado');
  });
});

describe('aprendizaje — límites', () => {
  it('una prenda borrada del clóset no rompe el historial', () => {
    const ghostId = '99999999-9999-4999-8999-999999999999';
    const result = generateLooks(
      makeInput(basicCloset(), {
        feedback: makeFeedback({
          rejected: [{ garmentIds: [ghostId, jeanId, sneakersId], reason: 'COLOR' }],
          likedGarmentIds: [ghostId],
        }),
      }),
    );

    expect(result.looks.length).toBeGreaterThan(0);
  });

  it('rechazarlo todo sigue devolviendo el mejor look posible', () => {
    const everything = generateLooks(
      makeInput(basicCloset(), { request: makeRequest({ limit: 5 }) }),
    );
    const rejected = everything.looks.map(look => ({
      garmentIds: idsOf(look),
      reason: 'NOT_MY_STYLE' as const,
    }));

    const after = generateLooks(
      makeInput(
        [
          ...basicCloset(),
          makeGarment('66666666-6666-4666-8666-666666666666', 'Gorra negra', 'ACCESSORY'),
        ],
        {
          request: makeRequest({ limit: 1 }),
          feedback: makeFeedback({
            rejected,
            generatedKeys: rejected.map(entry => garmentSetKey(entry.garmentIds)),
          }),
        },
      ),
    );

    expect(after.looks).toHaveLength(1);
    expect(preferenceScore(after)).toBeLessThan(0.5);
  });
});
