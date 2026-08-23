import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZodError } from 'zod';
import type { Env } from '../../../config/env.validation';
import { estimateCostUsd, type ITokenUsage } from '../../ai/openai-pricing';
import { AiProviderError, OpenAiClient } from '../../ai/openai.client';
import {
  adviceSchemaName,
  buildAdviceContract,
  parseAdviceDraft,
  type AdviceDraft,
} from './advice.contract';
import {
  adviceInstructions,
  advicePromptVersion,
  buildAdvicePrompt,
  type IAdvicePromptInput,
} from './advice.prompt.v1';
import type { IAdviceResult } from './advice.types';

/**
 * Usa el modelo del estilista y no uno propio: es la misma tarea —escribir el
 * porqué de algo que el servidor ya decidió— y darle una variable de entorno
 * aparte sólo añadiría un sitio más donde desincronizar el precio.
 * @class
 */
@Injectable()
export class AdviceLlmService {
  private readonly _logger = new Logger(AdviceLlmService.name);

  /**
   * Inicializa el servicio de redacción del veredicto.
   * @constructor
   * @param {OpenAiClient} _openai - Adaptador del proveedor de IA.
   * @param {ConfigService<Env, true>} _config - Configuración tipada del entorno.
   */
  constructor(
    private readonly _openai: OpenAiClient,
    private readonly _config: ConfigService<Env, true>,
  ) {}

  /** Indica si hay proveedor configurado para redactar el veredicto. */
  get isAvailable(): boolean {
    return this._openai.isConfigured;
  }

  /** Modelo con el que se redacta el veredicto ahora mismo. */
  get model(): string {
    return this._config.get('OPENAI_STYLIST_MODEL', { infer: true });
  }

  /** Versión del prompt y del esquema que se está usando. */
  get promptVersion(): string {
    return advicePromptVersion;
  }

  /**
   * Costo que se reserva antes de llamar. Es una cota alta a propósito: el cierre
   * del job la sustituye por el costo real que devolvió la API.
   * @param {number} garmentCount - Prendas propias que se le enseñan.
   * @returns {number}
   */
  estimateCostUsd(garmentCount: number): number {
    const expectedUsage: ITokenUsage = {
      inputTokens: expectedBasePromptTokens + garmentCount * expectedTokensPerGarment,
      outputTokens: expectedOutputTokens,
      cachedInputTokens: 0,
    };
    return estimateCostUsd(this.model, expectedUsage);
  }

  /**
   * Pide al modelo que redacte el veredicto ya decidido.
   * @param {IAdvicePromptInput} promptInput - Perfil, candidata, medición y clóset.
   * @returns {Promise<IAdviceResult>}
   */
  async writeAdvice(promptInput: IAdvicePromptInput): Promise<IAdviceResult> {
    const shortIds = promptInput.pairedGarments.map(garment => garment.shortId);
    const contract = buildAdviceContract(shortIds);

    const response = await this._openai.createStructured({
      model: this.model,
      instructions: adviceInstructions,
      prompt: buildAdvicePrompt(promptInput),
      images: [],
      schemaName: adviceSchemaName,
      jsonSchema: contract.jsonSchema,
      maxOutputTokens: this._config.get('OPENAI_STYLIST_MAX_OUTPUT_TOKENS', { infer: true }),
    });

    return {
      draft: this._parse(response.rawText),
      model: this.model,
      promptVersion: advicePromptVersion,
      usage: response.usage,
      latencyMs: response.latencyMs,
      providerRequestId: response.providerRequestId,
    };
  }

  /**
   * Parsea y valida la respuesta contra el esquema. Una salida que no lo cumple es
   * un fallo reintentable: el `strict` del proveedor debería impedirlo.
   * @private
   * @param {string} rawText - Texto JSON devuelto por el modelo.
   * @returns {AdviceDraft}
   */
  private _parse(rawText: string): AdviceDraft {
    try {
      return parseAdviceDraft(JSON.parse(rawText));
    } catch (error) {
      const detail = error instanceof ZodError ? error.issues[0]?.message : String(error);
      this._logger.warn(
        `AdviceLlmService > _parse - la salida del modelo no cumple el contrato: ${detail ?? 'sin detalle'}`,
      );
      throw new AiProviderError('invalid-output', invalidOutputMessage, true);
    }
  }
}

/**
 * Tokens esperados del prompt sin prendas —instrucciones, perfil, candidata y
 * medición— y por prenda propia enseñada. Sólo sirven para reservar presupuesto
 * antes de llamar; el costo real sale del `usage` que devuelve la API.
 */
const expectedBasePromptTokens = 900;
const expectedTokensPerGarment = 40;
const expectedOutputTokens = 500;

const invalidOutputMessage =
  'El veredicto llegó con una respuesta que no encaja con el contrato. Puedes reintentarlo.';
