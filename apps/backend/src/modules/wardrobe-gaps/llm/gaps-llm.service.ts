import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZodError } from 'zod';
import type { Env } from '../../../config/env.validation';
import { AiProviderError, OpenAiClient } from '../../ai/openai.client';
import { estimateCostUsd, type ITokenUsage } from '../../ai/openai-pricing';
import { buildGapsContract, gapsSchemaName, parseGapsDraft, type GapsDraft } from './gaps.contract';
import {
  buildGapsPrompt,
  gapsInstructions,
  gapsPromptVersion,
  type IGapsPromptInput,
} from './gaps.prompt.v1';
import type { IGapsResult } from './gaps.types';

/**
 * Capa 2 de la Fase 5: quien ordena y redacta las brechas.
 *
 * Usa el modelo del estilista y no uno propio: es la misma tarea —elegir entre
 * opciones que ya vienen validadas y escribir el porqué— y darle una variable de
 * entorno aparte sólo añadiría un sitio más donde desincronizar el precio.
 * @class
 */
@Injectable()
export class GapsLlmService {
  private readonly _logger = new Logger(GapsLlmService.name);

  /**
   * Inicializa el servicio de análisis de vacíos.
   * @constructor
   * @param {OpenAiClient} _openai - Adaptador del proveedor de IA.
   * @param {ConfigService<Env, true>} _config - Configuración tipada del entorno.
   */
  constructor(
    private readonly _openai: OpenAiClient,
    private readonly _config: ConfigService<Env, true>,
  ) {}

  /** Indica si hay proveedor configurado para el análisis. */
  get isAvailable(): boolean {
    return this._openai.isConfigured;
  }

  /** Modelo con el que se redactan las brechas ahora mismo. */
  get model(): string {
    return this._config.get('OPENAI_STYLIST_MODEL', { infer: true });
  }

  /** Versión del prompt y del esquema que se está usando. */
  get promptVersion(): string {
    return gapsPromptVersion;
  }

  /**
   * Costo que se reserva antes de llamar. Es una cota alta a propósito: el cierre
   * del job la sustituye por el costo real que devolvió la API.
   * @param {number} hypothesisCount - Prendas candidatas que se le enseñan.
   * @returns {number}
   */
  estimateCostUsd(hypothesisCount: number): number {
    const expectedUsage: ITokenUsage = {
      inputTokens: expectedBasePromptTokens + hypothesisCount * expectedTokensPerHypothesis,
      outputTokens: expectedOutputTokensPerGap * Math.max(hypothesisCount, 1),
      cachedInputTokens: 0,
    };
    return estimateCostUsd(this.model, expectedUsage);
  }

  /**
   * Pide al modelo que ordene y redacte las brechas.
   * @param {IGapsPromptInput} promptInput - Perfil, cobertura y prendas candidatas.
   * @returns {Promise<IGapsResult>}
   */
  async writeGaps(promptInput: IGapsPromptInput): Promise<IGapsResult> {
    const shortIds = promptInput.hypotheses.map(hypothesis => hypothesis.id);
    const contract = buildGapsContract(shortIds);

    const response = await this._openai.createStructured({
      model: this.model,
      instructions: gapsInstructions,
      prompt: buildGapsPrompt(promptInput),
      images: [],
      schemaName: gapsSchemaName,
      jsonSchema: contract.jsonSchema,
      maxOutputTokens: this._config.get('OPENAI_STYLIST_MAX_OUTPUT_TOKENS', { infer: true }),
    });

    return {
      draft: this._parse(response.rawText),
      model: this.model,
      promptVersion: gapsPromptVersion,
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
   * @returns {GapsDraft}
   */
  private _parse(rawText: string): GapsDraft {
    try {
      return parseGapsDraft(JSON.parse(rawText));
    } catch (error) {
      const detail = error instanceof ZodError ? error.issues[0]?.message : String(error);
      this._logger.warn(
        `GapsLlmService > _parse - la salida del modelo no cumple el contrato: ${detail ?? 'sin detalle'}`,
      );
      throw new AiProviderError('invalid-output', invalidOutputMessage, true);
    }
  }
}

/**
 * Tokens esperados del prompt sin candidatas —instrucciones, perfil y matriz— y
 * por candidata enseñada. Sólo sirven para reservar presupuesto antes de llamar;
 * el costo real sale del `usage` que devuelve la API.
 */
const expectedBasePromptTokens = 1200;
const expectedTokensPerHypothesis = 70;
const expectedOutputTokensPerGap = 220;

const invalidOutputMessage =
  'El análisis devolvió una respuesta que no encaja con el contrato. Puedes reintentarlo.';
