import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZodError } from 'zod';
import { visionTaggingVersion, type VisionAttributes } from '@closetai/shared-types';
import type { Env } from '../../../config/env.validation';
import { AiProviderError, OpenAiClient } from '../../ai/openai.client';
import { estimateCostUsd, type ITokenUsage } from '../../ai/openai-pricing';
import { GarmentTypesService } from '../../garment-types/garment-types.service';
import { buildVisionContract, parseVisionAttributes, visionSchemaName } from './vision.contract';
import { buildVisionPrompt, visionInstructions } from './vision.prompt.v4';
import type { IVisionImage, IVisionResult } from './vision.types';

/**
 * Tokens de imagen esperados según el nivel de detalle. Sólo sirven para
 * reservar presupuesto antes de llamar; el costo real sale del `usage`.
 */
const expectedImageTokensByDetail = { low: 1500, auto: 3500, high: 7000 } as const;
/** Instrucciones más catálogo de tipos, redondeado hacia arriba. */
const expectedPromptTokens = 1800;

const invalidOutputMessage =
  'El modelo devolvió unos atributos que no encajan con el catálogo. Puedes reintentarlo.';

/**
 * Etiquetado de una prenda a partir de su foto.
 * @class
 */
@Injectable()
export class VisionService {
  private readonly _logger = new Logger(VisionService.name);

  /**
   * Inicializa el servicio de visión.
   * @constructor
   * @param {OpenAiClient} _openai - Adaptador del proveedor de IA.
   * @param {GarmentTypesService} _garmentTypes - Catálogo de tipos de prenda.
   * @param {ConfigService<Env, true>} _config - Configuración tipada del entorno.
   */
  constructor(
    private readonly _openai: OpenAiClient,
    private readonly _garmentTypes: GarmentTypesService,
    private readonly _config: ConfigService<Env, true>,
  ) {}

  /** Indica si hay proveedor configurado para etiquetar. */
  get isAvailable(): boolean {
    return this._openai.isConfigured;
  }

  /** Modelo con el que se etiqueta ahora mismo. */
  get model(): string {
    return this._config.get('OPENAI_VISION_MODEL', { infer: true });
  }

  /**
   * Costo que se reserva antes de llamar. Es una cota alta a propósito: el
   * cierre del job la sustituye por el costo real que devolvió la API. Escala con
   * el número de fotos porque cada imagen son tokens de entrada aparte.
   * @param {number} imageCount - Fotos que se van a mandar en la llamada.
   * @returns {number}
   */
  estimateCostUsd(imageCount: number): number {
    const detail = this._config.get('OPENAI_VISION_IMAGE_DETAIL', { infer: true });
    const expectedUsage: ITokenUsage = {
      inputTokens: expectedImageTokensByDetail[detail] * imageCount + expectedPromptTokens,
      outputTokens: this._config.get('OPENAI_VISION_MAX_OUTPUT_TOKENS', { infer: true }),
      cachedInputTokens: 0,
    };
    return estimateCostUsd(this.model, expectedUsage);
  }

  /**
   * Pide al modelo los atributos de la prenda que aparece en las fotos.
   * @param {readonly IVisionImage[]} images - Fotos ya leídas de almacenamiento.
   * @returns {Promise<IVisionResult>}
   */
  async describeGarment(images: readonly IVisionImage[]): Promise<IVisionResult> {
    const catalog = await this._garmentTypes.list();
    const contract = buildVisionContract(catalog.map(type => type.slug));
    const detail = this._config.get('OPENAI_VISION_IMAGE_DETAIL', { infer: true });

    const response = await this._openai.createStructured({
      model: this.model,
      instructions: visionInstructions,
      prompt: buildVisionPrompt(
        catalog.map(type => ({ slug: type.slug, name: type.name, slot: type.slot })),
        images.length,
      ),
      images: images.map(image => ({
        detail,
        mimeType: image.mimeType,
        base64: image.buffer.toString('base64'),
      })),
      schemaName: visionSchemaName,
      jsonSchema: contract.jsonSchema,
      maxOutputTokens: this._config.get('OPENAI_VISION_MAX_OUTPUT_TOKENS', { infer: true }),
    });

    const attributes = this._parse(response.rawText, contract.garmentTypeSlugs);
    return {
      attributes,
      model: this.model,
      version: visionTaggingVersion,
      usage: response.usage,
      imageCount: response.imageCount,
      latencyMs: response.latencyMs,
      providerRequestId: response.providerRequestId,
    };
  }

  /**
   * Parsea y valida la respuesta. Una salida que no cumple el contrato es un
   * fallo reintentable: el `strict` del proveedor debería impedirlo, así que
   * casi siempre es un problema puntual de esa generación.
   * @private
   * @param {string} rawText - Texto JSON devuelto por el modelo.
   * @param {readonly string[]} garmentTypeSlugs - Slugs válidos del catálogo.
   * @returns {VisionAttributes}
   */
  private _parse(rawText: string, garmentTypeSlugs: readonly string[]): VisionAttributes {
    try {
      return parseVisionAttributes(JSON.parse(rawText), garmentTypeSlugs);
    } catch (error) {
      const detail = error instanceof ZodError ? error.issues[0]?.message : String(error);
      this._logger.warn(
        `VisionService > _parse - la salida del modelo no cumple el contrato: ${detail ?? 'sin detalle'}`,
      );
      throw new AiProviderError('invalid-output', invalidOutputMessage, true);
    }
  }
}
