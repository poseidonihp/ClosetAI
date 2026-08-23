import type { ITokenUsage } from '../../ai/openai-pricing';
import type { AdviceDraft } from './advice.contract';

/** Un veredicto ya validado: texto del modelo, prendas resueltas por el servidor. */
export interface IAssembledAdvice {
  headline: string;
  reason: string;
  stylingNotes: string[];
  pairedGarmentIds: string[];
  discarded: string[];
}

/** Lo que devuelve la redacción: la respuesta validada más los datos de consumo. */
export interface IAdviceResult {
  draft: AdviceDraft;
  model: string;
  promptVersion: string;
  usage: ITokenUsage;
  latencyMs: number;
  providerRequestId: string | null;
}
