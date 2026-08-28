import { describe, expect, it } from 'vitest';
import { makeGarment } from '../stylist/engine/engine.fixtures';
import { coveredCloset, minimalistProfile } from '../wardrobe-gaps/coverage/coverage.fixtures';
import { evaluatePurchase } from './evaluation';
import { makeCandidate, makeEvaluationInput, makeOpenGap } from './purchase-advice.fixtures';

/**
 * Casos golden de la evaluación de compra. Como el motor, se escriben con objetos
 * literales: la capa es código puro y no necesita base de datos.
 */

/** Id del jean del clóset de prueba, que es lo que duplica el caso del duplicado. */
const closetJeanId = 'a2222222-2222-4222-8222-222222222222';

describe('evaluatePurchase', () => {
  it('recomienda una prenda que abre conjuntos que hoy no puedes armar', () => {
    const candidate = makeCandidate('Camisa blanca', 'TOP', {
      primaryColorHex: '#f5f1e8',
      primaryColorName: 'Blanco',
      formality: 4,
      weatherMinC: 10,
      weatherMaxC: 30,
    });

    const result = evaluatePurchase(makeEvaluationInput(candidate));

    expect(result.verdict).toBe('RECOMMENDED');
    expect(result.verdictReason).toBe('UNLOCKS_OUTFITS');
    expect(result.impact?.unlockedOutfitsEstimate).toBeGreaterThan(0);
    expect(result.impact?.outfitsUsingItEstimate).toBeGreaterThan(0);
  });

  it('justifica un abrigo por la nota aunque no abra ninguna combinación', () => {
    const candidate = makeCandidate('Abrigo azul marino', 'OUTERWEAR', {
      primaryColorHex: '#2c3e57',
      primaryColorName: 'Azul marino',
      formality: 3,
      weatherMinC: -5,
      weatherMaxC: 18,
    });
    const withoutLayer = coveredCloset().filter(garment => garment.slot !== 'OUTERWEAR');

    const result = evaluatePurchase(makeEvaluationInput(candidate, { closet: withoutLayer }));

    expect(result.impact?.unlockedOutfitsEstimate).toBe(0);
    expect(result.impact?.outfitsUsingItEstimate).toBeGreaterThan(0);
    expect(result.verdict).toBe('RECOMMENDED');
    expect(result.verdictReason).toBe('IMPROVES_SCORE');
  });

  it('mide la nota de una capa que empata con otra que ya tienes, en vez de darla por inservible', () => {
    const candidate = makeCandidate('Chaqueta verde oliva', 'OUTERWEAR', {
      primaryColorHex: '#4a4a3f',
      primaryColorName: 'Verde oliva',
      formality: 3,
      weatherMinC: -5,
      weatherMaxC: 20,
    });

    const result = evaluatePurchase(makeEvaluationInput(candidate));

    expect(result.impact?.outfitsUsingItEstimate).toBeGreaterThan(0);
    expect(result.impact?.bestOutfitScore).toBeGreaterThan(0);
    expect(result.impact?.bestOutfitScenarioId).not.toBeNull();
    expect(result.bestOutfitScenarioLabel).not.toBeNull();
    expect(result.note).toContain('de 100');
  });

  it('no cuenta como capa una candidata que las reglas duras descartan', () => {
    const candidate = makeCandidate('Parka polar', 'OUTERWEAR', {
      primaryColorHex: '#4a4a3f',
      primaryColorName: 'Verde oliva',
      formality: 3,
      weatherMinC: -20,
      weatherMaxC: -5,
    });

    const result = evaluatePurchase(makeEvaluationInput(candidate));

    expect(result.impact?.outfitsUsingItEstimate).toBe(0);
    expect(result.impact?.bestOutfitScore).toBe(0);
    expect(result.impact?.bestOutfitScenarioId).toBeNull();
  });

  it('no recomienda una prenda de un color que el usuario evita', () => {
    const candidate = makeCandidate('Camisa roja', 'TOP', {
      primaryColorHex: '#b53c3c',
      primaryColorName: 'Rojo',
    });

    const result = evaluatePurchase(
      makeEvaluationInput(candidate, {
        profile: minimalistProfile({ avoidedColors: ['rojo'] }),
      }),
    );

    expect(result.verdict).toBe('NOT_RECOMMENDED');
    expect(result.verdictReason).toBe('AVOIDED_COLOR');
  });

  it('no recomienda una prenda de un tipo que el usuario evita', () => {
    const candidate = makeCandidate('Camisa beige', 'TOP', {
      primaryColorHex: '#d8c9ae',
      primaryColorName: 'Beige',
    });

    const result = evaluatePurchase(
      makeEvaluationInput(candidate, {
        profile: minimalistProfile({ avoidedGarmentTypeIds: [candidate.garmentTypeId] }),
      }),
    );

    expect(result.verdict).toBe('NOT_RECOMMENDED');
    expect(result.verdictReason).toBe('AVOIDED_TYPE');
  });

  it('no recomienda algo casi igual a lo que ya tienes y dice cuál duplica', () => {
    const candidate = makeCandidate('Otro jean azul', 'BOTTOM', {
      primaryColorHex: '#3a5f96',
      primaryColorName: 'Azul',
      material: 'DENIM',
      formality: 2,
      weatherMinC: 0,
      weatherMaxC: 30,
    });

    const result = evaluatePurchase(makeEvaluationInput(candidate));

    expect(result.verdict).toBe('NOT_RECOMMENDED');
    expect(result.verdictReason).toBe('DUPLICATE');
    expect(result.duplicateGarmentIds).toContain(closetJeanId);
    expect(result.impact?.unlockedOutfitsEstimate).toBe(0);
  });

  it('recomienda la prenda que cubre una brecha ya apuntada', () => {
    const candidate = makeCandidate('Camisa beige', 'TOP', {
      primaryColorHex: '#d8c9ae',
      primaryColorName: 'Beige',
    });

    const result = evaluatePurchase(
      makeEvaluationInput(candidate, {
        openGaps: [
          makeOpenGap('dddddddd-dddd-4ddd-8ddd-dddddddddddd', {
            garmentTypeId: candidate.garmentTypeId,
          }),
        ],
      }),
    );

    expect(result.verdict).toBe('RECOMMENDED');
    expect(result.verdictReason).toBe('MATCHES_GAP');
    expect(result.matchedGapId).toBe('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  });

  it('no inventa números cuando de las fotos no sale una prenda', () => {
    const candidate = makeCandidate('Foto ilegible', 'TOP', {
      taggingStatus: 'FAILED',
    });
    candidate.tagging = {
      ...candidate.tagging,
      usableForTagging: false,
      unusableReason: 'No se ve ninguna prenda',
    };

    const result = evaluatePurchase(makeEvaluationInput(candidate));

    expect(result.verdict).toBe('CONDITIONAL');
    expect(result.verdictReason).toBe('UNUSABLE_IMAGE');
    expect(result.impact).toBeNull();
  });

  it('no evalúa una candidata todavía sin atributos', () => {
    const candidate = makeCandidate('Prenda por etiquetar', 'TOP', {
      taggingStatus: 'PENDING',
    });

    const result = evaluatePurchase(makeEvaluationInput(candidate));

    expect(result.verdict).toBe('CONDITIONAL');
    expect(result.verdictReason).toBe('PENDING_ATTRIBUTES');
    expect(result.impact).toBeNull();
  });

  it('no evalúa contra un clóset sin prendas confirmadas', () => {
    const candidate = makeCandidate('Camisa blanca', 'TOP');
    const unconfirmed = coveredCloset().map(garment =>
      makeGarment(garment.id, garment.name, garment.slot, {
        ...garment,
        taggingStatus: 'SUGGESTED',
      }),
    );

    const result = evaluatePurchase(makeEvaluationInput(candidate, { closet: unconfirmed }));

    expect(result.verdict).toBe('CONDITIONAL');
    expect(result.verdictReason).toBe('NO_CONFIRMED_WARDROBE');
    expect(result.impact).toBeNull();
  });
});
