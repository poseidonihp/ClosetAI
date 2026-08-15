import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZodError } from 'zod';
import type { Env } from '../../../config/env.validation';
import { AiProviderError, OpenAiClient } from '../../ai/openai.client';
import { estimateCostUsd, type ITokenUsage } from '../../ai/openai-pricing';
import {
  buildStylistContract,
  parseStylistDraft,
  stylistSchemaName,
  type StylistDraft,
} from './stylist.contract';
import {
  buildStylistPrompt,
  stylistInstructions,
  stylistPromptVersion,
  type IStylistPromptInput,
} from './stylist.prompt.v2';

/**
 * Capa 2 del motor de recomendación: el estilista.
 * @class
 */
@Injectable()
export class StylistLlmService {
  private readonly _logger = new Logger(StylistLlmService.name);

  /**
   * Inicializa el servicio del estilista.
   * @constructor
   * @param {OpenAiClient} _openai - Adaptador del proveedor de IA.
   * @param {ConfigService<Env, true>} _config - Configuración tipada del entorno.
   */
  constructor(
    private readonly _openai: OpenAiClient,
    private readonly _config: ConfigService<Env, true>,
  ) {}

  /** Indica si hay proveedor configurado para el estilismo. */
  get isAvailable(): boolean {
    return this._openai.isConfigured;
  }

  /** Modelo con el que se redactan los looks ahora mismo. */
  get model(): string {
    return this._config.get('OPENAI_STYLIST_MODEL', { infer: true });
  }

  /** Versión del prompt y del esquema que se está usando. */
  get promptVersion(): string {
    return stylistPromptVersion;
  }

  /**
   * Costo que se reserva antes de llamar. Es una cota alta a propósito: el cierre
   * del job la sustituye por el costo real que devolvió la API. Escala con el
   * número de prendas porque cada una son unas líneas de prompt.
   * @param {number} garmentCount - Prendas que se le enseñan al modelo.
   * @returns {number}
   */
  estimateCostUsd(garmentCount: number): number {
    const expectedUsage: ITokenUsage = {
      inputTokens: expectedBasePromptTokens + garmentCount * expectedTokensPerGarment,
      outputTokens: this._config.get('OPENAI_STYLIST_MAX_OUTPUT_TOKENS', { infer: true }),
      cachedInputTokens: 0,
    };
    return estimateCostUsd(this.model, expectedUsage);
  }

  /**
   * Pide al modelo que elija y redacte los looks.
   * @param {IStylistPromptInput} promptInput - Perfil, petición, prendas y preferencias.
   * @returns {Promise<IStylistResult>}
   */
  async writeLooks(promptInput: IStylistPromptInput): Promise<IStylistResult> {
    const shortIds = promptInput.garments.map(garment => garment.shortId);
    const contract = buildStylistContract(shortIds);

    const response = await this._openai.createStructured({
      model: this.model,
      instructions: stylistInstructions,
      prompt: buildStylistPrompt(promptInput),
      images: [],
      schemaName: stylistSchemaName,
      jsonSchema: contract.jsonSchema,
      maxOutputTokens: this._config.get('OPENAI_STYLIST_MAX_OUTPUT_TOKENS', { infer: true }),
    });

    return {
      draft: this._parse(response.rawText),
      model: this.model,
      promptVersion: stylistPromptVersion,
      usage: response.usage,
      latencyMs: response.latencyMs,
      providerRequestId: response.providerRequestId,
    };
  }

  /**
   * Parsea y valida la respuesta contra el esquema. Una salida que no lo cumple es
   * un fallo reintentable: el `strict` del proveedor debería impedirlo, así que
   * casi siempre es un problema puntual de esa generación.
   * @private
   * @param {string} rawText - Texto JSON devuelto por el modelo.
   * @returns {StylistDraft}
   */
  private _parse(rawText: string): StylistDraft {
    try {
      return parseStylistDraft(JSON.parse(rawText));
    } catch (error) {
      const detail = error instanceof ZodError ? error.issues[0]?.message : String(error);
      this._logger.warn(
        `StylistLlmService > _parse - la salida del modelo no cumple el contrato: ${detail ?? 'sin detalle'}`,
      );
      throw new AiProviderError('invalid-output', invalidOutputMessage, true);
    }
  }
}

/** Lo que devuelve el estilista: la respuesta validada más los datos de consumo. */
export interface IStylistResult {
  draft: StylistDraft;
  model: string;
  promptVersion: string;
  usage: ITokenUsage;
  latencyMs: number;
  providerRequestId: string | null;
}

/**
 * Tokens esperados del prompt sin candidatos —instrucciones, perfil y petición— y
 * por prenda enseñada. Sólo sirven para reservar presupuesto antes de llamar; el
 * costo real sale del `usage` que devuelve la API.
 */
const expectedBasePromptTokens = 1400;
const expectedTokensPerGarment = 60;

const invalidOutputMessage =
  'El estilista devolvió una respuesta que no encaja con el contrato. Puedes reintentarlo.';
