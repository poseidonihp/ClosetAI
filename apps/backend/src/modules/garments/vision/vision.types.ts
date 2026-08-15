import type { VisionAttributes } from '@closetai/shared-types';
import type { ITokenUsage } from '../../ai/openai-pricing';

/** Foto ya leída de almacenamiento, lista para mandarse al modelo. */
export interface IVisionImage {
  buffer: Buffer;
  mimeType: string;
}

/** Lo que devuelve el etiquetado: atributos validados más los datos de consumo. */
export interface IVisionResult {
  attributes: VisionAttributes;
  model: string;
  version: string;
  usage: ITokenUsage;
  imageCount: number;
  latencyMs: number;
  providerRequestId: string | null;
}
