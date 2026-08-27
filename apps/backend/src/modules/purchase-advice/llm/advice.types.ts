import type { PurchaseAlternative } from '@closetai/shared-types';
import type { ITokenUsage } from '../../ai/openai-pricing';
import type { AdviceDraft } from './advice.contract';

/** La portada de la candidata, ya leída de almacenamiento. */
export interface IAdviceImage {
  buffer: Buffer;
  mimeType: string;
}

/**
 * Un veredicto ya validado: texto del modelo, prendas y alternativa resueltas
 * por el servidor.
 */
export interface IAssembledAdvice {
  headline: string;
  reason: string;
  stylingNotes: string[];
  pairedGarmentIds: string[];
  alternative: PurchaseAlternative | null;
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
