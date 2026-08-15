import type {
  ExcludedGarment,
  Garment,
  GenerateLooksRequest,
  Look,
  LookDiagnostics,
  LookScoreLine,
  StyleProfile,
} from '@closetai/shared-types';
import type { IStyleFeedback } from './learning';
import type { IOutfitDraft } from './outfit-draft';

/**
 * Tipos internos del motor. El motor no conoce Prisma ni Nest: trabaja sobre los
 * DTO de `shared-types`, que son datos planos. Por eso un test golden se escribe
 * con objetos literales y sin base de datos.
 */

/** Petición ya normalizada: la temperatura efectiva se resolvió antes de entrar. */
export interface IEngineRequest extends Omit<GenerateLooksRequest, 'climate' | 'temperatureC'> {
  /** Temperatura resuelta desde la petición, el clima o el perfil. Null si no hay. */
  temperatureC: number | null;
}

export interface IEngineInput {
  garments: readonly Garment[];
  profile: StyleProfile;
  request: IEngineRequest;
  now: Date;
  feedback: IStyleFeedback;
}

/** Conjunto puntuado: el borrador más su nota y el desglose que la explica. */
export interface IScoredOutfit {
  draft: IOutfitDraft;
  rawScore: number;
  engineScore: number;
  breakdown: LookScoreLine[];
  fitNotes: string[];
  averageFormality: number;
  formalityGap: number;
}

export interface IEngineResult {
  looks: Look[];
  diagnostics: LookDiagnostics;
  eligible: Garment[];
  excluded: ExcludedGarment[];
  scored: IScoredOutfit[];
}
