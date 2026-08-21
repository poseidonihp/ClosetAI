import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RenderQuality, RenderSize } from '@closetai/shared-types';
import type { Env } from '../../../config/env.validation';
import { imageCostUsdFromUsage, type IImageTokenUsage } from '../../ai/openai-pricing';
import { OpenAiClient, type IImageSource } from '../../ai/openai.client';
import { buildRenderPrompt, renderInstructions, renderPromptVersion } from './render.prompt.v1';
import type { IRenderPromptInput, IRenderResult } from './render.types';

/**
 * Tokens de la imagen que sale, por tamaño y calidad. Es una **cota alta** común a
 * los modelos de imagen que sabemos tarifar y no la cuenta exacta de ninguno:
 * `gpt-image-2` calcula los suyos con una fórmula que da menos tokens que estos
 * para los tres tamaños que ofrecemos. Sólo sirve para reservar presupuesto antes
 * de llamar; el costo real sale del `usage` que devuelve la API.
 */
const expectedOutputImageTokens = {
  '1024x1024': { low: 272, medium: 1056, high: 4160 },
  '1024x1536': { low: 408, medium: 1584, high: 6240 },
  '1536x1024': { low: 400, medium: 1568, high: 6208 },
} as const satisfies Record<RenderSize, Record<RenderQuality, number>>;

/**
 * Cota alta de los tokens que cuesta cada foto de prenda que entra. Queda por
 * encima del tope de parches que aplica `gpt-image-2` a una imagen de entrada, así
 * que ninguna foto del clóset se reserva por debajo de lo que costará.
 */
const expectedInputTokensPerImage = 1600;
/** Instrucciones más la descripción de las prendas, redondeado hacia arriba. */
const expectedPromptTokens = 900;

/**
 * Render visual de un look. Aísla el endpoint, el modelo y los ajustes de imagen
 * para que el módulo de dominio no sepa con qué API se está hablando.
 * @class
 */
@Injectable()
export class RenderService {
  /**
   * Inicializa el servicio de render.
   * @constructor
   * @param {OpenAiClient} _openai - Adaptador del proveedor de IA.
   * @param {ConfigService<Env, true>} _config - Configuración tipada del entorno.
   */
  constructor(
    private readonly _openai: OpenAiClient,
    private readonly _config: ConfigService<Env, true>,
  ) {}

  /** Indica si hay proveedor configurado para renderizar. */
  get isAvailable(): boolean {
    return this._openai.isConfigured;
  }

  /** Modelo de imagen con el que se renderiza ahora mismo. */
  get model(): string {
    return this._config.get('OPENAI_IMAGE_MODEL', { infer: true });
  }

  /** Versión del prompt que se está usando. */
  get promptVersion(): string {
    return renderPromptVersion;
  }

  /** Calidad configurada del render. */
  get quality(): RenderQuality {
    return this._config.get('OPENAI_IMAGE_QUALITY', { infer: true });
  }

  /** Tamaño configurado del render. */
  get size(): RenderSize {
    return this._config.get('OPENAI_IMAGE_SIZE', { infer: true });
  }

  /**
   * Costo que se reserva antes de llamar, y el mismo número que se le confirma al
   * usuario. Es una cota alta a propósito: el cierre del job la sustituye por el
   * costo real que devolvió la API.
   * @param {number} imageCount - Fotos de prenda que se van a mandar.
   * @returns {number}
   */
  estimateCostUsd(imageCount: number): number {
    const expectedUsage: IImageTokenUsage = {
      inputTextTokens: expectedPromptTokens,
      inputImageTokens: expectedInputTokensPerImage * imageCount,
      outputImageTokens: expectedOutputImageTokens[this.size][this.quality],
    };
    return imageCostUsdFromUsage(this.model, expectedUsage);
  }

  /**
   * Pide al modelo la imagen del look a partir de las fotos de sus prendas.
   * @param {IRenderPromptInput} promptInput - Look, prendas y perfil.
   * @param {readonly IImageSource[]} images - Fotos ya leídas de almacenamiento.
   * @returns {Promise<IRenderResult>}
   */
  async renderLook(
    promptInput: IRenderPromptInput,
    images: readonly IImageSource[],
  ): Promise<IRenderResult> {
    const promptUsed = `${renderInstructions}\n\n${buildRenderPrompt(promptInput)}`;
    const response = await this._openai.editImage({
      images,
      model: this.model,
      prompt: promptUsed,
      size: this.size,
      quality: this.quality,
      inputFidelity: this._config.get('OPENAI_IMAGE_INPUT_FIDELITY', { infer: true }),
      outputCompression: this._config.get('OPENAI_IMAGE_OUTPUT_COMPRESSION', { infer: true }),
    });

    return {
      promptUsed,
      base64: response.base64,
      mimeType: response.mimeType,
      model: this.model,
      promptVersion: renderPromptVersion,
      quality: this.quality,
      size: this.size,
      usage: response.usage,
      imageCount: response.imageCount,
      latencyMs: response.latencyMs,
      providerRequestId: response.providerRequestId,
    };
  }
}
