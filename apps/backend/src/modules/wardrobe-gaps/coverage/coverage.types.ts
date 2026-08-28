import type {
  CoverageScenario,
  Garment,
  GarmentType,
  GapHypothesis,
  StyleArchetype,
  StyleProfile,
  WardrobeCoverage,
} from '@closetai/shared-types';
import type { IScoredOutfit } from '../../stylist/engine/engine.types';

/**
 * Tipos del análisis de cobertura. Como el motor, este módulo es **código puro**
 * sobre los DTO de `shared-types`: no conoce Prisma ni Nest, así que un caso
 * golden se escribe con objetos literales.
 */

/** Una brecha que el usuario descartó: no se le vuelve a proponer. */
export interface IDismissedGap {
  garmentTypeId: string;
  colorHex: string;
}

export interface ICoverageInput {
  garments: readonly Garment[];
  profile: StyleProfile;
  catalog: readonly GarmentType[];
  dismissed: readonly IDismissedGap[];
  now: Date;
}

/** Un escenario antes de evaluarlo: sólo lo que lo define. */
export interface IScenarioSpec {
  id: string;
  styleTag: StyleArchetype;
  temperatureC: number;
  label: string;
}

/** Lo que el motor produjo para un escenario. */
export interface IScenarioRun {
  spec: IScenarioSpec;
  scenario: CoverageScenario;
  eligible: readonly Garment[];
  scored: readonly IScoredOutfit[];
  coreKeys: ReadonlySet<string>;
}

export interface ICoverageResult {
  coverage: WardrobeCoverage;
  hypotheses: GapHypothesis[];
  note: string | null;
}
