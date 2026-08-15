import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  Prisma,
  type AiJob,
  type GarmentImage as GarmentImageRow,
  type GarmentType as GarmentTypeRow,
} from '@prisma/client';
import {
  VisionAttributesSchema,
  maxVisionImages,
  visionTaggingVersion,
  type Garment,
  type TagGarmentResponse,
  type UpdateGarment,
  type VisionAttributes,
} from '@closetai/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageDriver } from '../../storage/storage.driver';
import { AiJobsService } from '../ai/ai-jobs.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { costUsdFromUsage } from '../ai/openai-pricing';
import { AiProviderError } from '../ai/openai.client';
import { GarmentTypesService } from '../garment-types/garment-types.service';
import { GarmentsService, garmentInclude, type GarmentRowWithRelations } from './garments.service';
import { VisionService } from './vision/vision.service';
import type { IVisionImage, IVisionResult } from './vision/vision.types';

const noPhotoMessage = 'Sube una foto de la prenda antes de etiquetarla con IA.';
const missingBinaryMessage =
  'No se pudo leer la foto de la prenda. Vuelve a subirla e inténtalo otra vez.';
const noAttemptsLeftMessage =
  'Se agotaron los intentos de etiquetado de esta prenda. Usa "volver a etiquetar" o complétala a mano.';
const alreadyTaggedMessage =
  'Este etiquetado ya se ejecutó y se cobró. Usa "volver a etiquetar" si quieres uno nuevo.';
const unavailableMessage =
  'El etiquetado por IA no está disponible: falta configurar OPENAI_API_KEY en el servidor.';
const unexpectedErrorMessage = 'No se pudo etiquetar la prenda. Puedes reintentarlo.';

/** Prefijo de la clave de idempotencia. Fija el tipo de job y su versión. */
const idempotencyPrefix = 'tagging';
/** Caracteres del hash de fotos que entran en la clave. 16 hex ya no colisionan. */
const fingerprintLength = 16;

/**
 * Ciclo de vida del etiquetado por visión de una prenda.
 *
 * @class
 */
@Injectable()
export class GarmentTaggingService {
  private readonly _logger = new Logger(GarmentTaggingService.name);

  /**
   * Inicializa el servicio de etiquetado.
   * @constructor
   * @param {PrismaService} _prisma - Cliente de base de datos.
   * @param {StorageDriver} _storage - Driver de almacenamiento de imágenes.
   * @param {GarmentsService} _garments - Servicio de prendas (propiedad y DTO).
   * @param {GarmentTypesService} _garmentTypes - Catálogo de tipos de prenda.
   * @param {VisionService} _vision - Adaptador de visión.
   * @param {AiJobsService} _jobs - Presupuesto, idempotencia y reintentos.
   * @param {AiUsageService} _usage - Registro de auditoría del consumo.
   */
  constructor(
    private readonly _prisma: PrismaService,
    private readonly _storage: StorageDriver,
    private readonly _garments: GarmentsService,
    private readonly _garmentTypes: GarmentTypesService,
    private readonly _vision: VisionService,
    private readonly _jobs: AiJobsService,
    private readonly _usage: AiUsageService,
  ) {}

  /**
   * Etiqueta una prenda con sus fotos, empezando por la portada.
   * @param {string} userId - Usuario autenticado.
   * @param {string} garmentId - Prenda a etiquetar.
   * @param {boolean} force - Autorización explícita para volver a pagar y pisar
   * también los atributos corregidos a mano.
   * @returns {Promise<TagGarmentResponse>}
   */
  async tag(userId: string, garmentId: string, force: boolean): Promise<TagGarmentResponse> {
    if (!this._vision.isAvailable) {
      throw new ServiceUnavailableException(unavailableMessage);
    }

    const garment = await this._garments.requireOwned(userId, garmentId);
    const photos = GarmentTaggingService.selectPhotos(garment.images);

    const reused = await this._tryReuse(garment, photos, force);
    if (reused) {
      return { garment: reused, reused: true };
    }

    const job = await this._reserve(userId, garmentId, photos, force);
    if (job.status === 'FAILED') {
      throw new HttpException(noAttemptsLeftMessage, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (job.status === 'SUCCEEDED') {
      throw new HttpException(alreadyTaggedMessage, HttpStatus.CONFLICT);
    }

    return { garment: await this._run(userId, garment, photos, job, force), reused: false };
  }

  /**
   * Guarda las correcciones del usuario y da el etiquetado por bueno. A partir
   * de aquí la prenda está `CONFIRMED` y el motor puede usarla.
   * @param {string} userId - Usuario autenticado.
   * @param {string} garmentId - Prenda a confirmar.
   * @param {UpdateGarment} dto - Atributos finales tal como los dejó el usuario.
   * @returns {Promise<Garment>}
   */
  async confirm(userId: string, garmentId: string, dto: UpdateGarment): Promise<Garment> {
    const current = await this._garments.requireOwned(userId, garmentId);
    if (dto.garmentTypeId) {
      await this._garmentTypes.requireById(dto.garmentTypeId);
    }
    const updated = await this._prisma.garment.update({
      where: { id: garmentId },
      include: garmentInclude,
      data: {
        ...dto,
        manualFields: GarmentsService.manualFieldsAfter(current, dto),
        taggingStatus: 'CONFIRMED',
      },
    });
    return this._garments.toDto(updated);
  }

  /**
   * Intenta resolver la petición sin llamar al proveedor.
   * @private
   * @param {GarmentRowWithRelations} garment - Prenda tal como está guardada.
   * @param {readonly GarmentImageRow[]} photos - Fotos que se mandarían ahora.
   * @param {boolean} force - Si el usuario pidió reetiquetar desde cero.
   * @returns {Promise<Garment | null>}
   */
  private async _tryReuse(
    garment: GarmentRowWithRelations,
    photos: readonly GarmentImageRow[],
    force: boolean,
  ): Promise<Garment | null> {
    if (force) {
      return null;
    }
    if (garment.taggingStatus === 'CONFIRMED' && garment.taggingVersion !== null) {
      return this._garments.toDto(garment);
    }
    const stored = GarmentTaggingService._storedAttributes(garment);
    if (!stored || !GarmentTaggingService._matchesPhotos(garment, photos)) {
      return null;
    }
    return this._apply(garment, stored, false);
  }

  /**
   * Indica si el borrador guardado salió del mismo conjunto de fotos que se
   * mandaría ahora.
   * @private
   * @param {GarmentRowWithRelations} garment - Prenda con su último job.
   * @param {readonly GarmentImageRow[]} photos - Fotos que se mandarían ahora.
   * @returns {boolean}
   */
  private static _matchesPhotos(
    garment: GarmentRowWithRelations,
    photos: readonly GarmentImageRow[],
  ): boolean {
    const storedKey = garment.taggingJob?.idempotencyKey;
    if (!storedKey) {
      return true;
    }
    return storedKey.startsWith(GarmentTaggingService._baseKey(garment.id, photos));
  }

  /**
   * Reserva presupuesto para esta prenda y este conjunto de fotos.
   * @private
   * @param {string} userId - Usuario autenticado.
   * @param {string} garmentId - Prenda a etiquetar.
   * @param {readonly GarmentImageRow[]} photos - Fotos que se van a mandar.
   * @param {boolean} force - Si el usuario pidió reetiquetar desde cero.
   * @returns {Promise<AiJob>}
   */
  private async _reserve(
    userId: string,
    garmentId: string,
    photos: readonly GarmentImageRow[],
    force: boolean,
  ): Promise<AiJob> {
    const baseKey = GarmentTaggingService._baseKey(garmentId, photos);
    const previousRuns = force
      ? await this._prisma.aiJob.count({
          where: { userId, idempotencyKey: { startsWith: baseKey } },
        })
      : 0;

    return this._jobs.reserve({
      userId,
      kind: 'TAGGING',
      idempotencyKey: previousRuns === 0 ? baseKey : `${baseKey}#${previousRuns}`,
      estimatedCostUsd: this._vision.estimateCostUsd(photos.length),
      model: this._vision.model,
    });
  }

  /**
   * Clave base de un etiquetado: versión, prenda y huella del conjunto de fotos.
   * @private
   * @param {string} garmentId - Prenda a etiquetar.
   * @param {readonly GarmentImageRow[]} photos - Fotos en el orden en que se mandan.
   * @returns {string}
   */
  private static _baseKey(garmentId: string, photos: readonly GarmentImageRow[]): string {
    const digest = createHash('sha256')
      .update(photos.map(photo => photo.id).join(','))
      .digest('hex')
      .slice(0, fingerprintLength);
    return `${idempotencyPrefix}:${visionTaggingVersion}:${garmentId}:${digest}`;
  }

  /**
   * Ejecuta la llamada al modelo y cierra el job con su costo real. Un fallo
   * deja la prenda en `FAILED` con el motivo, nunca a medio escribir.
   * @private
   * @param {string} userId - Usuario autenticado.
   * @param {GarmentRowWithRelations} garment - Prenda a etiquetar.
   * @param {readonly GarmentImageRow[]} photos - Fotos a mandar, portada primero.
   * @param {AiJob} job - Job ya reservado.
   * @param {boolean} force - Si se pueden pisar los atributos manuales.
   * @returns {Promise<Garment>}
   */
  private async _run(
    userId: string,
    garment: GarmentRowWithRelations,
    photos: readonly GarmentImageRow[],
    job: AiJob,
    force: boolean,
  ): Promise<Garment> {
    const images = await this._readImages(photos);
    if (images.length === 0) {
      await this._jobs.markFailed(userId, job.id, { errorMessage: missingBinaryMessage });
      throw new BadRequestException(missingBinaryMessage);
    }

    await this._jobs.markRunning(userId, job.id);

    let result: IVisionResult;
    try {
      result = await this._vision.describeGarment(images);
    } catch (error) {
      return this._fail(userId, garment.id, job, error);
    }

    const costUsd = costUsdFromUsage(result.model, result.usage);
    await this._jobs.markSucceeded(userId, job.id, {
      actualCostUsd: costUsd,
      model: result.model,
      ...(result.providerRequestId ? { providerRequestId: result.providerRequestId } : {}),
    });
    await this._logUsage(userId, job.id, result, costUsd);

    return this._apply(garment, result.attributes, force, job.id);
  }

  /**
   * Cierra el job como fallido, marca la prenda y traduce el error al mensaje
   * que verá el usuario.
   * @private
   * @param {string} userId - Usuario autenticado.
   * @param {string} garmentId - Prenda que se estaba etiquetando.
   * @param {AiJob} job - Job en curso.
   * @param {unknown} error - Error capturado.
   * @returns {Promise<never>}
   */
  private async _fail(
    userId: string,
    garmentId: string,
    job: AiJob,
    error: unknown,
  ): Promise<never> {
    const providerError =
      error instanceof AiProviderError
        ? error
        : new AiProviderError('provider', unexpectedErrorMessage, true);

    this._logger.error(
      `GarmentTaggingService > _fail - etiquetado fallido de la prenda ${garmentId} (${providerError.code})`,
      providerError.message,
    );

    await this._jobs.markFailed(userId, job.id, {
      errorMessage: providerError.message,
      retryable: providerError.retryable,
      ...(providerError.providerRequestId
        ? { providerRequestId: providerError.providerRequestId }
        : {}),
    });
    await this._usage.log({
      userId,
      jobId: job.id,
      kind: 'TAGGING',
      model: this._vision.model,
      status: 'FAILED',
      costUsd: 0,
      latencyMs: 0,
      errorCode: providerError.code,
      errorMessage: providerError.message,
    });
    await this._prisma.garment.update({
      where: { id: garmentId },
      data: { taggingStatus: 'FAILED', taggingJobId: job.id },
    });

    throw new HttpException(
      providerError.message,
      providerError.retryable ? HttpStatus.BAD_GATEWAY : HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  /**
   * Escribe el borrador sobre la prenda respetando los atributos corregidos a
   * mano y la deja en `SUGGESTED`.
   * @private
   * @param {GarmentRowWithRelations} garment - Prenda tal como está guardada.
   * @param {VisionAttributes} attributes - Atributos devueltos por el modelo.
   * @param {boolean} force - Si se pueden pisar los atributos manuales.
   * @param {string} [jobId] - Job que produjo estos atributos, si es nuevo.
   * @returns {Promise<Garment>}
   */
  private async _apply(
    garment: GarmentRowWithRelations,
    attributes: VisionAttributes,
    force: boolean,
    jobId?: string,
  ): Promise<Garment> {
    if (!attributes.usableForTagging) {
      return this._applyUnusable(garment, attributes, jobId);
    }
    const garmentType = await this._garmentTypes.requireBySlug(attributes.garmentTypeSlug);
    if (attributes.slot !== garmentType.slot) {
      this._logger.warn(
        `GarmentTaggingService > _apply - el modelo propuso el slot ${attributes.slot} para el tipo ${garmentType.slug} (${garmentType.slot}); manda el catálogo`,
      );
    }

    const suggested = GarmentTaggingService.toSuggestedData(attributes, garmentType);
    if (!force) {
      for (const field of GarmentsService.toTaggableFields(garment.manualFields)) {
        delete suggested[field];
      }
    }

    const updated = await this._prisma.garment.update({
      where: { id: garment.id },
      include: garmentInclude,
      data: {
        ...suggested,
        brandGuess: attributes.brandGuess,
        aiAttributes: attributes as unknown as Prisma.InputJsonValue,
        attributeConfidence: attributes.confidence,
        taggingVersion: visionTaggingVersion,
        taggedAt: new Date(),
        taggingStatus: 'SUGGESTED',
        ...(jobId ? { taggingJobId: jobId } : {}),
      },
    });
    return this._garments.toDto(updated);
  }

  /**
   * El modelo dice que de estas fotos no sale una prenda.
   * @private
   * @param {GarmentRowWithRelations} garment - Prenda tal como está guardada.
   * @param {VisionAttributes} attributes - Respuesta del modelo, con su motivo.
   * @param {string} [jobId] - Job que produjo esta respuesta, si es nuevo.
   * @returns {Promise<Garment>}
   */
  private async _applyUnusable(
    garment: GarmentRowWithRelations,
    attributes: VisionAttributes,
    jobId?: string,
  ): Promise<Garment> {
    this._logger.log(
      `GarmentTaggingService > _applyUnusable - la prenda ${garment.id} no se pudo catalogar: ${attributes.unusableReason ?? 'sin motivo declarado'}`,
    );
    const updated = await this._prisma.garment.update({
      where: { id: garment.id },
      include: garmentInclude,
      data: {
        aiAttributes: attributes as unknown as Prisma.InputJsonValue,
        taggingVersion: visionTaggingVersion,
        taggedAt: new Date(),
        taggingStatus: garment.taggingStatus === 'CONFIRMED' ? 'CONFIRMED' : 'FAILED',
        ...(jobId ? { taggingJobId: jobId } : {}),
      },
    });
    return this._garments.toDto(updated);
  }

  /**
   * Traduce los atributos del modelo a columnas de la prenda.
   * @param {VisionAttributes} attributes - Atributos devueltos por el modelo.
   * @param {GarmentTypeRow} garmentType - Tipo del catálogo que corresponde al slug.
   * @returns {Prisma.GarmentUncheckedUpdateInput}
   */
  static toSuggestedData(
    attributes: VisionAttributes,
    garmentType: GarmentTypeRow,
  ): Prisma.GarmentUncheckedUpdateInput {
    return {
      garmentTypeId: garmentType.id,
      slot: garmentType.slot,
      name: attributes.suggestedName,
      primaryColorHex: attributes.primaryColorHex,
      primaryColorName: attributes.primaryColorName,
      secondaryColorHex: attributes.secondaryColorHex,
      pattern: attributes.pattern,
      patternScale: attributes.patternScale,
      material: attributes.material,
      fit: attributes.fit,
      formality: attributes.formality,
      seasons: attributes.seasons.length > 0 ? attributes.seasons : garmentType.typicalSeasons,
      weatherMinC: attributes.weatherMinC,
      weatherMaxC: attributes.weatherMaxC,
    };
  }

  /**
   * Registra el consumo de la llamada en la auditoría.
   * @private
   * @param {string} userId - Usuario autenticado.
   * @param {string} jobId - Job asociado.
   * @param {IVisionResult} result - Resultado de la llamada al modelo.
   * @param {number} costUsd - Costo real calculado desde el consumo.
   * @returns {Promise<void>}
   */
  private async _logUsage(
    userId: string,
    jobId: string,
    result: IVisionResult,
    costUsd: number,
  ): Promise<void> {
    await this._usage.log({
      userId,
      jobId,
      costUsd,
      kind: 'TAGGING',
      status: 'SUCCEEDED',
      model: result.model,
      latencyMs: result.latencyMs,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cachedInputTokens: result.usage.cachedInputTokens,
      imageCount: result.imageCount,
      ...(result.providerRequestId ? { providerRequestId: result.providerRequestId } : {}),
    });
  }

  /**
   * Devuelve los atributos ya guardados si siguen siendo de la versión vigente.
   * Es lo que permite reaplicar un etiquetado sin volver a pagar.
   * @private
   * @param {GarmentRowWithRelations} garment - Prenda con su borrador guardado.
   * @returns {VisionAttributes | null}
   */
  private static _storedAttributes(garment: GarmentRowWithRelations): VisionAttributes | null {
    if (garment.taggingVersion !== visionTaggingVersion) {
      return null;
    }
    const parsed = VisionAttributesSchema.safeParse(garment.aiAttributes);
    return parsed.success ? parsed.data : null;
  }

  /**
   * Fotos que se le mandan al modelo: la portada primero y después el resto en
   * el orden en que se subieron, hasta `maxVisionImages`.
   * @param {readonly GarmentImageRow[]} images - Filas de imagen de la prenda.
   * @returns {GarmentImageRow[]}
   */
  static selectPhotos(images: readonly GarmentImageRow[]): GarmentImageRow[] {
    const originals = images
      .filter(image => image.kind === 'ORIGINAL')
      .sort((first, second) => first.sortOrder - second.sortOrder);
    const cover = originals.find(image => image.isPrimary) ?? originals[0];
    if (!cover) {
      throw new BadRequestException(noPhotoMessage);
    }
    const rest = originals.filter(image => image.id !== cover.id);
    return [cover, ...rest].slice(0, maxVisionImages);
  }

  /**
   * Lee los binarios de las fotos y descarta los que ya no estén en disco. Una
   * foto perdida no debe tumbar el etiquetado si las demás siguen ahí: el modelo
   * trabaja igual con las que queden y el aviso queda en el log.
   * @private
   * @param {readonly GarmentImageRow[]} photos - Fotos a leer.
   * @returns {Promise<IVisionImage[]>}
   */
  private async _readImages(photos: readonly GarmentImageRow[]): Promise<IVisionImage[]> {
    const read = await Promise.all(photos.map(photo => this._storage.read(photo.storageKey)));
    const missing = read.filter(image => image === null).length;
    if (missing > 0) {
      this._logger.warn(
        `GarmentTaggingService > _readImages - ${missing} de ${photos.length} fotos no están en almacenamiento`,
      );
    }
    return read
      .filter((image): image is NonNullable<typeof image> => image !== null)
      .map(image => ({ buffer: image.buffer, mimeType: image.mimeType }));
  }
}
