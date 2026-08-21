import type { AiJob } from '@prisma/client';
import type { WardrobeCoverage, WardrobeGap } from '@closetai/shared-types';
import type { IGapsResult } from './llm/gaps.types';

/** Todo lo que hace falta para guardar una tanda de brechas. */
export interface IPersistContext {
  job: AiJob;
  signature: string;
  coverage: WardrobeCoverage;
  llmResult: IGapsResult;
}

/** Cuerpo de la respuesta antes de añadirle los metadatos fijos. */
export interface IRespondParts {
  gaps: WardrobeGap[];
  coverage: WardrobeCoverage;
  note: string | null;
  discarded?: string[];
  costUsd?: number;
  reused?: boolean;
}
