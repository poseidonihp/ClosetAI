import { describe, expect, it } from 'vitest';
import type { GapHypothesis } from '@closetai/shared-types';
import { basicCloset, makeGarment, makeProfile } from '../../stylist/engine/engine.fixtures';
import { analyzeCoverage } from './coverage';
import { versatileColors } from './coverage.constants';
import { coveredCloset, makeCoverageInput, minimalistProfile } from './coverage.fixtures';

/**
 * Casos golden del análisis de cobertura. Cubren lo que la Fase 5 promete: que la
 * lista de la compra salga de medir el clóset y no de opinar sobre él, que un
 * clóset ya cubierto devuelva vacío, y que lo descartado no vuelva a aparecer.
 */

/**
 * Ids de las prendas hipotéticas propuestas.
 * @param {readonly GapHypothesis[]} hypotheses - Hipótesis del análisis.
 * @returns {string[]}
 */
function slugsOf(hypotheses: readonly GapHypothesis[]): string[] {
  return hypotheses.map(hypothesis => hypothesis.garmentTypeSlug);
}

describe('analyzeCoverage', () => {
  it('un clóset vacío no cubre nada y pide las tres piezas de la base', () => {
    const result = analyzeCoverage(makeCoverageInput([], { profile: minimalistProfile() }));

    expect(result.coverage.distinctOutfits).toBe(0);
    expect(result.coverage.uncoveredScenarioIds).toEqual(
      result.coverage.scenarios.map(scenario => scenario.id),
    );
    expect(new Set(result.hypotheses.map(hypothesis => hypothesis.slot))).toEqual(
      new Set(['TOP', 'BOTTOM', 'FOOTWEAR']),
    );
    expect(result.note).not.toBeNull();
  });

  it('el clóset básico de cinco prendas arma conjuntos pero no llega a lo formal', () => {
    const result = analyzeCoverage(
      makeCoverageInput(basicCloset(), {
        profile: makeProfile({ styleArchetypes: ['MINIMALIST', 'CLASSIC'], climate: 'WARM' }),
      }),
    );

    expect(result.coverage.distinctOutfits).toBeGreaterThan(0);
    expect(result.coverage.eligibleCount).toBe(basicCloset().length);
    // Formalidad 1–2 en todo el clóset: para CLASSIC (4–5) faltan piezas formales.
    expect(slugsOf(result.hypotheses)).toContain('mocasines');
    expect(result.hypotheses.every(hypothesis => hypothesis.formality >= 3)).toBe(true);
  });

  it('cada hipótesis declara qué desbloquea y ninguna se propone sin aportar nada', () => {
    const result = analyzeCoverage(
      makeCoverageInput(basicCloset(), { profile: minimalistProfile() }),
    );

    for (const hypothesis of result.hypotheses) {
      const aportaAlgo =
        hypothesis.unlockedOutfitsEstimate > 0 ||
        hypothesis.newlyCoveredScenarioIds.length > 0 ||
        hypothesis.scoreGain > 0;
      expect(aportaAlgo).toBe(true);
      expect(hypothesis.rationale.length).toBeGreaterThan(0);
    }
  });

  it('un clóset que cubre sus escenarios no propone ninguna compra', () => {
    const result = analyzeCoverage(
      makeCoverageInput(coveredCloset(), { profile: minimalistProfile() }),
    );

    expect(result.coverage.uncoveredScenarioIds).toEqual([]);
    expect(result.hypotheses).toEqual([]);
    expect(result.note).toContain('No hay nada que comprar');
  });

  it('una prenda descartada no se vuelve a proponer', () => {
    const input = makeCoverageInput(basicCloset(), { profile: minimalistProfile() });
    const [first] = analyzeCoverage(input).hypotheses;
    expect(first).toBeDefined();

    const withDismissal = analyzeCoverage({
      ...input,
      dismissed: [{ garmentTypeId: first?.garmentTypeId ?? '', colorHex: first?.colorHex ?? '' }],
    });

    expect(
      withDismissal.hypotheses.some(
        hypothesis =>
          hypothesis.garmentTypeId === first?.garmentTypeId &&
          hypothesis.colorHex === first?.colorHex,
      ),
    ).toBe(false);
  });

  it('nunca propone un color que el usuario evita', () => {
    const result = analyzeCoverage(
      makeCoverageInput(basicCloset(), {
        profile: minimalistProfile({ avoidedColors: ['Negro'] }),
      }),
    );

    expect(result.hypotheses.length).toBeGreaterThan(0);
    expect(result.hypotheses.some(hypothesis => hypothesis.colorName === 'Negro')).toBe(false);
  });

  it('si evita todos los colores versátiles lo dice en vez de proponer uno', () => {
    const result = analyzeCoverage(
      makeCoverageInput(basicCloset(), {
        profile: minimalistProfile({
          avoidedColors: versatileColors.map(color => color.name),
        }),
      }),
    );

    expect(result.hypotheses).toEqual([]);
    expect(result.note).toContain('colores versátiles');
  });

  it('una prenda sin confirmar no cuenta como cobertura y el análisis lo avisa', () => {
    const pending = makeGarment('b1111111-1111-4111-8111-111111111111', 'Camisa sin revisar', 'TOP', {
      taggingStatus: 'SUGGESTED',
    });
    const result = analyzeCoverage(
      makeCoverageInput([...coveredCloset(), pending], { profile: minimalistProfile() }),
    );

    expect(result.coverage.eligibleCount).toBe(coveredCloset().length);
    expect(result.note).toContain('sin confirmar');
  });

  it('la matriz reparte las prendas por slot y por familia de color', () => {
    const result = analyzeCoverage(
      makeCoverageInput(basicCloset(), { profile: minimalistProfile() }),
    );

    const tops = result.coverage.slots.find(slot => slot.slot === 'TOP');
    expect(tops?.availableCount).toBe(2);
    expect(tops?.minFormality).toBe(1);
    expect(result.coverage.colors.map(color => color.family)).toContain('WHITE');
  });
});
