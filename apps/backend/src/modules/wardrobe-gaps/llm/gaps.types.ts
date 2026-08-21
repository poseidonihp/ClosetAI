import type { GapHypothesis, ReferenceBrands } from '@closetai/shared-types';
import type { ITokenUsage } from '../../ai/openai-pricing';
import type { GapsDraft } from './gaps.contract';

/** Una brecha ya validada: prioridad y medidas del motor, texto del modelo. */
export interface IAssembledGap {
  hypothesis: GapHypothesis;
  priority: number;
  description: string;
  reason: string;
  referenceBrands: ReferenceBrands;
}

export interface IGapAssemblyResult {
  accepted: IAssembledGap[];
  discarded: string[];
}

/** Lo que devuelve el análisis: la respuesta validada más los datos de consumo. */
export interface IGapsResult {
  draft: GapsDraft;
  model: string;
  promptVersion: string;
  usage: ITokenUsage;
  latencyMs: number;
  providerRequestId: string | null;
}
