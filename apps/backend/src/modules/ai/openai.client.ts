import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, {
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  RateLimitError,
  toFile,
} from 'openai';
import type { ImagesResponse } from 'openai/resources/images';
import type { Response as OpenAiResponse } from 'openai/resources/responses/responses';
import type { Env } from '../../config/env.validation';
import type { IImageTokenUsage, ITokenUsage } from './openai-pricing';

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
   * @param {string | null} [detail=null] - Motivo técnico, sólo para el log.
   */
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly providerRequestId: string | null = null,
    readonly detail: string | null = null,
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

/** Una foto real de una prenda, tal como viaja al modelo de imagen. */
export interface IImageSource {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

export interface IImageEditRequest {
  model: string;
  /** Prompt que describe las prendas y la escena. Lo construye el módulo de dominio. */
  prompt: string;
  /** Fotos de las prendas del look, en el orden en que se citan en el prompt. */
  images: readonly IImageSource[];
  size: string;
  quality: 'low' | 'medium' | 'high';
  /** Cuánto respeta el modelo las fotos de entrada. Se omite si el modelo no lo acepta. */
  inputFidelity: 'low' | 'high';
  /** Compresión del WebP de salida, 1–100. */
  outputCompression: number;
}

export interface IImageEditResponse {
  /** Imagen generada en base64. El proveedor no devuelve URL para estos modelos. */
  base64: string;
  mimeType: string;
  usage: IImageTokenUsage;
  imageCount: number;
  latencyMs: number;
  providerRequestId: string | null;
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
  'Las funciones de IA no están disponibles: falta configurar OPENAI_API_KEY en el servidor.';
const timeoutMessage = 'El proveedor de IA tardó demasiado en responder. Puedes reintentarlo.';
const rateLimitMessage = 'El proveedor de IA está saturado ahora mismo. Reinténtalo en un minuto.';
const providerMessage = 'El proveedor de IA devolvió un error. Puedes reintentarlo.';
const refusalMessage = 'El modelo se negó a analizar esta imagen.';
const incompleteMessage =
  'La respuesta del modelo se cortó antes de terminar. Reintenta o sube una foto más simple.';
const emptyOutputMessage = 'El modelo no devolvió ninguna respuesta utilizable.';
const moderationMessage =
  'El proveedor rechazó generar la imagen por su política de contenido. La ficha del look sigue intacta.';
const emptyImageMessage = 'El proveedor no devolvió ninguna imagen.';

/** Formato en el que se pide la imagen. WebP es el formato de todo el storage. */
const imageOutputFormat = 'webp';
const imageOutputMimeType = 'image/webp';
/** Código con el que el proveedor marca un rechazo por política de contenido. */
const moderationErrorCode = 'moderation_blocked';

/** Códigos HTTP a partir de los cuales el fallo es del servidor y conviene reintentar. */
const firstServerErrorStatus = 500;

/**
 * Modelos que aceptan `input_fidelity`. Es una lista de lo permitido y no de lo
 * prohibido: omitir el parámetro sólo cuesta fidelidad, mientras que mandárselo a
 * un modelo que no lo acepta tumba la llamada con un 400. `gpt-image-2` está fuera
 * porque procesa toda entrada en alta fidelidad y rechaza el parámetro.
 */
const modelsWithInputFidelity: ReadonlySet<string> = new Set(['gpt-image-1', 'gpt-image-1.5']);

/**
 * Indica si el modelo acepta `input_fidelity`. Va atado al id del modelo y no al
 * entorno, por el mismo motivo que los precios: es una propiedad del modelo.
 * @param {string} model - Identificador del modelo de imagen.
 * @returns {boolean}
 */
export function supportsInputFidelity(model: string): boolean {
  return modelsWithInputFidelity.has(model);
}

@Injectable()
export class OpenAiClient {
  private readonly _logger = new Logger(OpenAiClient.name);
  private readonly _client: OpenAI | null;
  private readonly _timeoutMs: number;
  private readonly _imageTimeoutMs: number;

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
    this._imageTimeoutMs = this._config.get('AI_IMAGE_REQUEST_TIMEOUT_MS', { infer: true });
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
      throw this._toProviderError(error);
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
   * Genera una imagen a partir de las fotos que se le pasan. Devuelve el binario
   * en base64 y el consumo: guardar la imagen y validarla es cosa de quien la pidió.
   * @param {IImageEditRequest} request - Modelo, prompt, fotos y ajustes de salida.
   * @returns {Promise<IImageEditResponse>}
   */
  async editImage(request: IImageEditRequest): Promise<IImageEditResponse> {
    const client = this._client;
    if (!client) {
      throw new AiProviderError('not-configured', notConfiguredMessage, false);
    }

    const startedAt = Date.now();
    const files = await Promise.all(
      request.images.map(image => toFile(image.buffer, image.filename, { type: image.mimeType })),
    );

    let response: ImagesResponse;
    let providerRequestId: string | null;
    try {
      const raw = await client.images
        .edit(
          {
            model: request.model,
            image: files,
            prompt: request.prompt,
            size: request.size,
            quality: request.quality,
            ...(supportsInputFidelity(request.model)
              ? { input_fidelity: request.inputFidelity }
              : {}),
            output_format: imageOutputFormat,
            output_compression: request.outputCompression,
            n: 1,
            stream: false,
          },
          { timeout: this._imageTimeoutMs },
        )
        .withResponse();
      response = raw.data;
      providerRequestId = raw.request_id;
    } catch (error) {
      throw this._toProviderError(error);
    }

    const base64 = response.data?.[0]?.b64_json;
    if (!base64) {
      throw new AiProviderError('invalid-output', emptyImageMessage, true, providerRequestId);
    }

    return {
      base64,
      providerRequestId,
      mimeType: imageOutputMimeType,
      usage: OpenAiClient._toImageUsage(response),
      imageCount: request.images.length,
      latencyMs: Date.now() - startedAt,
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
   * Normaliza el consumo de una generación de imagen. Un proveedor que no lo
   * reporte deja el costo en cero y la reserva del job es lo que acota el gasto.
   * @private
   * @param {ImagesResponse} response - Respuesta del proveedor.
   * @returns {IImageTokenUsage}
   */
  private static _toImageUsage(response: ImagesResponse): IImageTokenUsage {
    return {
      inputTextTokens: response.usage?.input_tokens_details?.text_tokens ?? 0,
      inputImageTokens: response.usage?.input_tokens_details?.image_tokens ?? 0,
      outputImageTokens: response.usage?.output_tokens ?? 0,
    };
  }

  /**
   * Clasifica el error y deja en el log el motivo técnico. El mensaje que ve el
   * usuario es genérico a propósito, así que sin esta línea un fallo del
   * proveedor no se puede diagnosticar.
   * @private
   * @param {unknown} error - Error lanzado por el cliente.
   * @returns {AiProviderError}
   */
  private _toProviderError(error: unknown): AiProviderError {
    const providerError = OpenAiClient._classify(error);
    this._logger.error(
      `OpenAiClient > _toProviderError - llamada rechazada por el proveedor (${providerError.code})`,
      providerError.detail ?? providerError.message,
    );
    return providerError;
  }

  /**
   * Traduce el error del SDK al código de dominio y decide si se reintenta.
   * @private
   * @param {unknown} error - Error lanzado por el cliente.
   * @returns {AiProviderError}
   */
  private static _classify(error: unknown): AiProviderError {
    if (error instanceof AiProviderError) {
      return error;
    }
    if (error instanceof APIConnectionTimeoutError || error instanceof APIUserAbortError) {
      return new AiProviderError(
        'timeout',
        timeoutMessage,
        true,
        null,
        OpenAiClient._detail(error),
      );
    }
    if (error instanceof RateLimitError) {
      return new AiProviderError(
        'rate-limited',
        rateLimitMessage,
        true,
        error.requestID ?? null,
        OpenAiClient._detail(error),
      );
    }
    if (error instanceof APIError) {
      if (error.code === moderationErrorCode) {
        return new AiProviderError(
          'refusal',
          moderationMessage,
          false,
          error.requestID ?? null,
          OpenAiClient._detail(error),
        );
      }
      const status = error.status ?? 0;
      const retryable = status === 0 || status >= firstServerErrorStatus;
      return new AiProviderError(
        'provider',
        providerMessage,
        retryable,
        error.requestID ?? null,
        OpenAiClient._detail(error),
      );
    }
    return new AiProviderError(
      'provider',
      providerMessage,
      true,
      null,
      OpenAiClient._detail(error),
    );
  }

  /**
   * Motivo técnico del fallo, con el estado y el identificador que pide el
   * proveedor para rastrear la petición.
   * @private
   * @param {unknown} error - Error lanzado por el cliente.
   * @returns {string}
   */
  private static _detail(error: unknown): string {
    if (!(error instanceof APIError)) {
      return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    const parts = [
      `HTTP ${error.status ?? 'sin respuesta'}`,
      `tipo ${error.type ?? 'desconocido'}`,
      `código ${error.code ?? 'ninguno'}`,
      `param ${error.param ?? 'ninguno'}`,
      `requestId ${error.requestID ?? 'ninguno'}`,
      error.message,
    ];
    return parts.join(' · ');
  }
}
