import {
  GarmentSlotEnum,
  colorFamilyFromHex,
  colorFamilyLabels,
  colorFamilySwatches,
  coverageVersion,
  type ColorFamily,
  type CoverageColor,
  type CoverageSlot,
  type Garment,
  type WardrobeCoverage,
} from '@closetai/shared-types';
import { splitEligibility } from '../../stylist/engine/garment-rules';
import { maxCoverageColors } from './coverage.constants';
import type { ICoverageInput, ICoverageResult, IScenarioRun } from './coverage.types';
import { allowedColors, buildHypotheses } from './hypotheses';
import { runScenario } from './scenario-runner';
import { buildScenarios } from './scenarios';

/**
 * Capa 1 de la Fase 5: la cobertura real del clóset, calculada con el motor.
 *
 * Todo lo que aquí sale son números que se pueden reproducir sin llamar a nadie:
 * cuántos conjuntos da el clóset, qué escenarios no cubre y qué desbloquearía
 * cada prenda que no tiene. El modelo llega después y sólo ordena y redacta.
 */

const coveredNote =
  'Tu clóset cubre todos los escenarios que se han evaluado y ninguna prenda suelta desbloquearía conjuntos nuevos. No hay nada que comprar por ahora.';
const emptyClosetNote =
  'Con las prendas confirmadas no se puede armar ningún conjunto. Un look necesita parte de arriba, parte de abajo y calzado, o una prenda entera con calzado.';
const noColorNote =
  'Todos los colores versátiles que se proponen están entre los que evitas. Quita alguno de tu perfil para poder sugerirte prendas concretas.';
const suggestedPendingNote =
  'Hay prendas con el etiquetado sin confirmar: no cuentan para la cobertura hasta que las revises, así que confirmarlas puede cerrar brechas sin comprar nada.';

/**
 * Calcula la cobertura del clóset y las prendas que la mejorarían.
 * @param {ICoverageInput} input - Clóset, perfil, catálogo y descartes previos.
 * @returns {ICoverageResult}
 */
export function analyzeCoverage(input: ICoverageInput): ICoverageResult {
  const runs = buildScenarios(input.profile).map<IScenarioRun>(spec => {
    const outcome = runScenario(input, spec, null);
    return { spec, ...outcome };
  });

  const coverage = toCoverage(input, runs);
  const hypotheses =
    allowedColors(input.profile.avoidedColors).length === 0
      ? []
      : buildHypotheses({ input, runs });

  return { coverage, hypotheses, note: toNote(input, coverage, hypotheses.length) };
}

/**
 * Ensambla la matriz que se enseña y que ve el modelo.
 * @param {ICoverageInput} input - Clóset, perfil y catálogo.
 * @param {readonly IScenarioRun[]} runs - Escenarios ya evaluados.
 * @returns {WardrobeCoverage}
 */
function toCoverage(input: ICoverageInput, runs: readonly IScenarioRun[]): WardrobeCoverage {
  const eligible = neutralEligibility(input);
  const distinct = new Set(runs.flatMap(run => [...run.coreKeys]));

  return {
    version: coverageVersion,
    closetSize: input.garments.length,
    eligibleCount: eligible.length,
    slots: toSlots(input.garments, eligible),
    colors: toColors(eligible),
    scenarios: runs.map(run => run.scenario),
    distinctOutfits: distinct.size,
    uncoveredScenarioIds: runs
      .filter(run => run.scenario.outfitCount === 0)
      .map(run => run.spec.id),
  };
}

/**
 * Prendas que el motor podría usar sin mirar el clima: es la foto del clóset,
 * independiente del escenario, y por eso se calcula con la temperatura sin fijar.
 * @param {ICoverageInput} input - Clóset y perfil.
 * @returns {Garment[]}
 */
function neutralEligibility(input: ICoverageInput): Garment[] {
  return splitEligibility(input.garments, {
    profile: input.profile,
    request: {
      styleTag: 'MINIMALIST',
      temperatureC: null,
      mustIncludeGarmentId: null,
      includeSuggested: false,
      limit: 1,
    },
  }).eligible;
}

/**
 * Fila de la matriz por slot: qué hay, qué se puede usar y en qué franja de
 * formalidad se mueve.
 * @param {readonly Garment[]} garments - Clóset completo.
 * @param {readonly Garment[]} eligible - Prendas que el motor puede usar.
 * @returns {CoverageSlot[]}
 */
function toSlots(garments: readonly Garment[], eligible: readonly Garment[]): CoverageSlot[] {
  return GarmentSlotEnum.options.map(slot => {
    const available = eligible.filter(garment => garment.slot === slot);
    const formalities = available.map(garment => garment.formality);
    return {
      slot,
      availableCount: available.length,
      totalCount: garments.filter(garment => garment.slot === slot).length,
      minFormality: formalities.length === 0 ? null : Math.min(...formalities),
      maxFormality: formalities.length === 0 ? null : Math.max(...formalities),
    };
  });
}

/**
 * Reparto de la paleta por familia de color, de más a menos prendas.
 * @param {readonly Garment[]} eligible - Prendas que el motor puede usar.
 * @returns {CoverageColor[]}
 */
function toColors(eligible: readonly Garment[]): CoverageColor[] {
  const counts = new Map<ColorFamily, number>();
  for (const garment of eligible) {
    const family = colorFamilyFromHex(garment.primaryColorHex);
    if (family) {
      counts.set(family, (counts.get(family) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((first, second) => second[1] - first[1])
    .slice(0, maxCoverageColors)
    .map(([family, count]) => ({
      family,
      count,
      label: colorFamilyLabels[family],
      hex: colorFamilySwatches[family],
    }));
}

/**
 * Qué contar cuando no hay brechas que proponer, o qué matiza a las que hay.
 * @param {ICoverageInput} input - Clóset y perfil.
 * @param {WardrobeCoverage} coverage - Matriz ya calculada.
 * @param {number} hypothesisCount - Prendas hipotéticas que sobrevivieron.
 * @returns {string | null}
 */
function toNote(
  input: ICoverageInput,
  coverage: WardrobeCoverage,
  hypothesisCount: number,
): string | null {
  if (allowedColors(input.profile.avoidedColors).length === 0) {
    return noColorNote;
  }
  const pending = input.garments.some(garment => garment.taggingStatus === 'SUGGESTED');
  const base = toBaseNote(coverage, hypothesisCount);
  if (!pending) {
    return base;
  }
  return base === null ? suggestedPendingNote : `${base} ${suggestedPendingNote}`;
}

/**
 * Lo que hay que contar del clóset, antes de añadirle avisos.
 * @param {WardrobeCoverage} coverage - Matriz ya calculada.
 * @param {number} hypothesisCount - Prendas hipotéticas que sobrevivieron.
 * @returns {string | null}
 */
function toBaseNote(coverage: WardrobeCoverage, hypothesisCount: number): string | null {
  if (coverage.distinctOutfits === 0) {
    return emptyClosetNote;
  }
  return hypothesisCount === 0 ? coveredNote : null;
}
