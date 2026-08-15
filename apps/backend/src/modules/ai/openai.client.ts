import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, {
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  RateLimitError,
} from 'openai';
import type { Response as OpenAiResponse } from 'openai/resources/responses/responses';
import type { Env } from '../../config/env.validation';
import type { ITokenUsage } from './openai-pricing';

/**
 * Adaptador del proveedor de IA.
 */

/** Por qué falló la llamada. Determina si se puede reintentar y qué ve el usuario. */
export type AiErrorCode =
  | 'not-configured'
  | 'timeout'
  | 'rate-limited'
  | 'provider'
  | 'refusal'
  | 'incomplete'
  | 'invalid-output';

export class AiProviderError extends Error {
  /**
   * Construye el error con el motivo ya clasificado.
   * @constructor
   * @param {AiErrorCode} code - Motivo del fallo.
   * @param {string} message - Mensaje en español para el usuario.
   * @param {boolean} retryable - Si tiene sentido volver a intentarlo.
   * @param {string | null} [providerRequestId=null] - Identificador de la petición.
   */
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly providerRequestId: string | null = null,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

/** Imagen que se manda al modelo, ya en base64. */
export interface IStructuredImage {
  base64: string;
  mimeType: string;
  detail: 'auto' | 'low' | 'high';
}

export interface IStructuredRequest {
  model: string;
  /** Mensaje de sistema: rol, límites y política. */
  instructions: string;
  /** Mensaje del usuario con los datos concretos de esta petición. */
  prompt: string;
  images: readonly IStructuredImage[];
  schemaName: string;
  /** JSON Schema con `strict: true`; lo construye el módulo de dominio. */
  jsonSchema: Record<string, unknown>;
  maxOutputTokens: number;
}

export interface IStructuredResponse {
  /** Texto JSON devuelto por el modelo, todavía sin validar contra Zod. */
  rawText: string;
  usage: ITokenUsage;
  imageCount: number;
  latencyMs: number;
  providerRequestId: string | null;
}

const notConfiguredMessage =
  'El etiquetado por IA no está disponible: falta configurar OPENAI_API_KEY en el servidor.';
const timeoutMessage = 'El proveedor de IA tardó demasiado en responder. Puedes reintentarlo.';
const rateLimitMessage = 'El proveedor de IA está saturado ahora mismo. Reinténtalo en un minuto.';
const providerMessage = 'El proveedor de IA devolvió un error. Puedes reintentarlo.';
const refusalMessage = 'El modelo se negó a analizar esta imagen.';
const incompleteMessage =
  'La respuesta del modelo se cortó antes de terminar. Reintenta o sube una foto más simple.';
const emptyOutputMessage = 'El modelo no devolvió ninguna respuesta utilizable.';

/** Códigos HTTP a partir de los cuales el fallo es del servidor y conviene reintentar. */
const firstServerErrorStatus = 500;

@Injectable()
export class OpenAiClient {
  private readonly _logger = new Logger(OpenAiClient.name);
  private readonly _client: OpenAI | null;
  private readonly _timeoutMs: number;

  /**
   * Crea el cliente si hay clave configurada. Sin clave el backend arranca
   * igual y sólo los endpoints de IA responden que no está disponible.
   * @constructor
   * @param {ConfigService<Env, true>} _config - Configuración tipada del entorno.
   */
  constructor(private readonly _config: ConfigService<Env, true>) {
    const apiKey = this._config.get('OPENAI_API_KEY', { infer: true });
    const baseURL = this._config.get('OPENAI_BASE_URL', { infer: true });
    this._timeoutMs = this._config.get('AI_REQUEST_TIMEOUT_MS', { infer: true });
    this._client = apiKey
      ? new OpenAI({
          apiKey,
          maxRetries: 0,
          timeout: this._timeoutMs,
          ...(baseURL ? { baseURL } : {}),
        })
      : null;
    if (!this._client) {
      this._logger.warn(
        'OpenAiClient > constructor - sin OPENAI_API_KEY: los endpoints de IA quedan deshabilitados',
      );
    }
  }

  /** Indica si hay proveedor configurado. */
  get isConfigured(): boolean {
    return this._client !== null;
  }

  /**
   * Pide al modelo una respuesta que cumpla el esquema dado. Devuelve el texto
   * crudo para que el llamante lo valide con su propio esquema Zod: el `strict`
   * del proveedor reduce mucho el riesgo, pero no sustituye la validación.
   * @param {IStructuredRequest} request - Modelo, mensajes, imágenes y esquema.
   * @returns {Promise<IStructuredResponse>}
   */
  async createStructured(request: IStructuredRequest): Promise<IStructuredResponse> {
    const client = this._client;
    if (!client) {
      throw new AiProviderError('not-configured', notConfiguredMessage, false);
    }

    const startedAt = Date.now();
    let response: OpenAiResponse;
    try {
      response = await client.responses.create({
        model: request.model,
        instructions: request.instructions,
        max_output_tokens: request.maxOutputTokens,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: request.prompt },
              ...request.images.map(image => ({
                type: 'input_image' as const,
                image_url: `data:${image.mimeType};base64,${image.base64}`,
                detail: image.detail,
              })),
            ],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: request.schemaName,
            schema: request.jsonSchema,
            strict: true,
          },
        },
      });
    } catch (error) {
      throw OpenAiClient._toProviderError(error);
    }

    const providerRequestId = response.id || null;
    OpenAiClient._assertUsable(response, providerRequestId);

    return {
      rawText: response.output_text,
      usage: OpenAiClient._toUsage(response),
      imageCount: request.images.length,
      latencyMs: Date.now() - startedAt,
      providerRequestId,
    };
  }

  /**
   * Rechaza las respuestas que llegaron pero no sirven: negativa del modelo,
   * corte por límite de tokens o salida vacía.
   * @private
   * @param {OpenAiResponse} response - Respuesta del proveedor.
   * @param {string | null} providerRequestId - Identificador de la petición.
   * @returns {void}
   */
  private static _assertUsable(response: OpenAiResponse, providerRequestId: string | null): void {
    const refusal = OpenAiClient._findRefusal(response);
    if (refusal) {
      throw new AiProviderError(
        'refusal',
        `${refusalMessage} ${refusal}`,
        false,
        providerRequestId,
      );
    }
    if (response.status === 'incomplete') {
      throw new AiProviderError('incomplete', incompleteMessage, true, providerRequestId);
    }
    if (!response.output_text) {
      throw new AiProviderError('invalid-output', emptyOutputMessage, true, providerRequestId);
    }
  }

  /**
   * Busca el texto de una negativa del modelo dentro de la salida.
   * @private
   * @param {OpenAiResponse} response - Respuesta del proveedor.
   * @returns {string | null}
   */
  private static _findRefusal(response: OpenAiResponse): string | null {
    for (const item of response.output) {
      if (item.type === 'message') {
        const refusal = item.content.find(content => content.type === 'refusal');
        if (refusal) {
          return refusal.refusal;
        }
      }
    }
    return null;
  }

  /**
   * Normaliza el consumo devuelto por el proveedor.
   * @private
   * @param {OpenAiResponse} response - Respuesta del proveedor.
   * @returns {ITokenUsage}
   */
  private static _toUsage(response: OpenAiResponse): ITokenUsage {
    return {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
    };
  }

  /**
   * Clasifica el error del SDK para decidir si el job puede reintentarse.
   * @private
   * @param {unknown} error - Error lanzado por el cliente.
   * @returns {AiProviderError}
   */
  private static _toProviderError(error: unknown): AiProviderError {
    if (error instanceof AiProviderError) {
      return error;
    }
    if (error instanceof APIConnectionTimeoutError || error instanceof APIUserAbortError) {
      return new AiProviderError('timeout', timeoutMessage, true);
    }
    if (error instanceof RateLimitError) {
      return new AiProviderError('rate-limited', rateLimitMessage, true, error.requestID ?? null);
    }
    if (error instanceof APIError) {
      const status = error.status ?? 0;
      const retryable = status === 0 || status >= firstServerErrorStatus;
      return new AiProviderError('provider', providerMessage, retryable, error.requestID ?? null);
    }
    return new AiProviderError('provider', providerMessage, true);
  }
}
