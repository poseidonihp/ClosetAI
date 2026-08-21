import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { AiJob } from '@prisma/client';
import {
  enumLabels,
  type Outfit,
  type OutfitRender,
  type RenderOutfitResponse,
  type RenderQuote,
  type StyleProfile,
} from '@closetai/shared-types';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageDriver } from '../../../storage/storage.driver';
import { AiJobsService } from '../../ai/ai-jobs.service';
import { AiUsageService } from '../../ai/ai-usage.service';
import { imageCostUsdFromUsage } from '../../ai/openai-pricing';
import { AiProviderError } from '../../ai/openai.client';
import { ProfileService } from '../../profile/profile.service';
import { OutfitsService, outfitInclude, type OutfitRowWithRelations } from '../outfits.service';
import { toRenderDto } from './render-dto';
import { selectRenderPhotos } from './render-photos';
import { RenderService } from './render.service';
import type {
  IRenderGarmentPhoto,
  IRenderPersistContext,
  IRenderPromptGarment,
  IRenderPromptInput,
  IRenderReadResult,
  IRenderResult,
} from './render.types';

const unavailableMessage =
  'El render con IA no está disponible: falta configurar OPENAI_API_KEY en el servidor. La ficha del look sigue funcionando.';
const noPhotosMessage =
  'Este look no tiene ninguna foto de prenda con la que renderizar. Sube fotos a sus prendas y vuelve a intentarlo.';
const missingBinaryMessage =
  'No se pudieron leer las fotos de las prendas del look. Vuelve a subirlas e inténtalo otra vez.';
const noAttemptsLeftMessage =
  'Se agotaron los intentos de este render. Inténtalo más tarde o cambia algo del look.';
const alreadyRunningMessage = 'Ya hay un render en curso para este look. Espera a que termine.';
const unexpectedErrorMessage = 'No se pudo generar el render. Puedes reintentarlo.';
const outfitNotFoundMessage = 'Look no encontrado';
const renderNotFoundMessage = 'Render no encontrado';

/** Prefijo de la clave de idempotencia. Fija el tipo de job. */
const idempotencyPrefix = 'render';
/** Caracteres de la huella del conjunto de fotos que entran en la clave. */
const fingerprintLength = 16;
/** Extensión de las fotos que viajan al modelo: todas se normalizan a WebP al subirlas. */
const renderPhotoExtension = '.webp';
/** Nombre con el que se guarda el render; el driver le pone su propio uuid. */
const renderFilename = 'render.webp';

/**
 * Ciclo de vida del render visual de un look.
 * @class
 */
@Injectable()
export class OutfitRendersService {
  private readonly _logger = new Logger(OutfitRendersService.name);

  /**
   * Inicializa el servicio de renders.
   * @constructor
   * @param {PrismaService} _prisma - Cliente de base de datos.
   * @param {StorageDriver} _storage - Driver de almacenamiento de imágenes.
   * @param {OutfitsService} _outfits - Looks del usuario, para la ficha resultante.
   * @param {ProfileService} _profile - Perfil de estilo del usuario.
   * @param {RenderService} _render - Adaptador del modelo de imagen.
   * @param {AiJobsService} _jobs - Presupuesto, idempotencia y reintentos.
   * @param {AiUsageService} _usage - Registro de auditoría del consumo.
   */
  constructor(
    private readonly _prisma: PrismaService,
    private readonly _storage: StorageDriver,
    private readonly _outfits: OutfitsService,
    private readonly _profile: ProfileService,
    private readonly _render: RenderService,
    private readonly _jobs: AiJobsService,
    private readonly _usage: AiUsageService,
  ) {}

  /**
   * Qué costaría renderizar este look, sin llamar a nadie.
   *
   * La confirmación de costo de la Fase 6 no puede depender de una llamada que ya
   * se pagó, así que el cliente pregunta aquí, enseña el número y sólo después
   * pulsa.
   * @param {string} userId - Usuario autenticado.
   * @param {string} outfitId - Look a renderizar.
   * @returns {Promise<RenderQuote>}
   */
  async quote(userId: string, outfitId: string): Promise<RenderQuote> {
    const outfit = await this._requireOwned(userId, outfitId);
    const { selected } = selectRenderPhotos(OutfitRendersService._coverPhotos(outfit));

    return {
      model: this._render.model,
      promptVersion: this._render.promptVersion,
      quality: this._render.quality,
      size: this._render.size,
      imageCount: selected.length,
      estimatedCostUsd: this._render.estimateCostUsd(selected.length),
      renderCount: outfit.renders.length,
      available: this._render.isAvailable && selected.length > 0,
      unavailableReason: this._unavailableReason(selected.length),
    };
  }

  /**
   * Genera el render del look y lo guarda junto a él.
   * @param {string} userId - Usuario autenticado.
   * @param {string} outfitId - Look a renderizar.
   * @returns {Promise<RenderOutfitResponse>}
   */
  async render(userId: string, outfitId: string): Promise<RenderOutfitResponse> {
    if (!this._render.isAvailable) {
      throw new ServiceUnavailableException(unavailableMessage);
    }

    const outfit = await this._requireOwned(userId, outfitId);
    const selection = selectRenderPhotos(OutfitRendersService._coverPhotos(outfit));
    if (selection.selected.length === 0) {
      throw new BadRequestException(noPhotosMessage);
    }
    if (selection.droppedNames.length > 0) {
      this._logger.log(
        `OutfitRendersService > render - el look ${outfitId} manda ${selection.selected.length} fotos; fuera: ${selection.droppedNames.join(', ')}`,
      );
    }

    const job = await this._reserveJob(userId, outfit, selection.selected);
    const result = await this._callModel(userId, job, outfit, selection.selected);
    const costUsd = await this._settle(userId, job, result);
    const render = await this._save({ userId, outfitId, job, result });

    return { render, costUsd, outfit: await this._outfits.findOne(userId, outfitId) };
  }

  /**
   * Borra un render y su imagen. El look no se toca: lo que se descarta es una
   * imagen que no gustó, no el conjunto ni su historial.
   * @param {string} userId - Usuario autenticado.
   * @param {string} outfitId - Look al que pertenece.
   * @param {string} renderId - Render a borrar.
   * @returns {Promise<Outfit>}
   */
  async remove(userId: string, outfitId: string, renderId: string): Promise<Outfit> {
    const render = await this._prisma.outfitRender.findFirst({
      where: { id: renderId, outfitId, outfit: { userId } },
    });
    if (!render) {
      throw new NotFoundException(renderNotFoundMessage);
    }
    await this._prisma.outfitRender.delete({ where: { id: render.id } });
    await this._storage.delete(render.imageKey);
    return this._outfits.findOne(userId, outfitId);
  }

  /**
   * Motivo por el que el render no está disponible, o null si sí lo está.
   * @private
   * @param {number} photoCount - Fotos de prenda que se podrían mandar.
   * @returns {string | null}
   */
  private _unavailableReason(photoCount: number): string | null {
    if (!this._render.isAvailable) {
      return unavailableMessage;
    }
    return photoCount === 0 ? noPhotosMessage : null;
  }

  /**
   * Fotos de portada de las prendas del look, en el orden de la ficha. Una prenda
   * sin foto no aparece: el render se hace con lo que existe.
   * @private
   * @param {OutfitRowWithRelations} outfit - Look con sus prendas y sus imágenes.
   * @returns {IRenderGarmentPhoto[]}
   */
  private static _coverPhotos(outfit: OutfitRowWithRelations): IRenderGarmentPhoto[] {
    const photos: IRenderGarmentPhoto[] = [];
    for (const item of outfit.items) {
      const originals = item.garment.images
        .filter(image => image.kind === 'ORIGINAL')
        .sort((first, second) => first.sortOrder - second.sortOrder);
      const cover = originals.find(image => image.isPrimary) ?? originals[0];
      if (cover) {
        photos.push({
          garmentId: item.garmentId,
          name: item.garment.name,
          role: item.role,
          storageKey: cover.storageKey,
          mimeType: cover.mimeType,
        });
      }
    }
    return photos;
  }

  /**
   * Reserva presupuesto para este render.
   * @private
   * @param {string} userId - Usuario autenticado.
   * @param {OutfitRowWithRelations} outfit - Look a renderizar.
   * @param {readonly IRenderGarmentPhoto[]} photos - Fotos que se van a mandar.
   * @returns {Promise<AiJob>}
   */
  private async _reserveJob(
    userId: string,
    outfit: OutfitRowWithRelations,
    photos: readonly IRenderGarmentPhoto[],
  ): Promise<AiJob> {
    const baseKey = this._baseKey(outfit.id, photos);
    const previous = await this._prisma.aiJob.findMany({
      where: { userId, kind: 'RENDER', idempotencyKey: { startsWith: baseKey } },
      orderBy: { createdAt: 'desc' },
    });
    const [latest] = previous;
    const isRetry = latest?.status === 'FAILED' && this._jobs.canRetry(latest);

    const job = await this._jobs.reserve({
      userId,
      kind: 'RENDER',
      idempotencyKey: isRetry
        ? latest.idempotencyKey
        : OutfitRendersService._suffixed(baseKey, previous.length),
      estimatedCostUsd: this._render.estimateCostUsd(photos.length),
      model: this._render.model,
    });

    if (job.status === 'FAILED') {
      throw new HttpException(noAttemptsLeftMessage, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (job.status !== 'QUEUED') {
      throw new HttpException(alreadyRunningMessage, HttpStatus.CONFLICT);
    }
    return job;
  }

  /**
   * Clave base de un render: versión del prompt, ajustes de imagen, look y huella
   * de las fotos que se mandan.
   * @private
   * @param {string} outfitId - Look a renderizar.
   * @param {readonly IRenderGarmentPhoto[]} photos - Fotos en el orden en que se mandan.
   * @returns {string}
   */
  private _baseKey(outfitId: string, photos: readonly IRenderGarmentPhoto[]): string {
    const digest = createHash('sha256')
      .update(photos.map(photo => photo.storageKey).join(','))
      .digest('hex')
      .slice(0, fingerprintLength);
    const settings = `${this._render.quality}:${this._render.size}`;
    return `${idempotencyPrefix}:${this._render.promptVersion}:${settings}:${outfitId}:${digest}`;
  }

  /**
   * Añade el número de renders previos a la clave base.
   * @private
   * @param {string} baseKey - Clave base del render.
   * @param {number} previousRuns - Renders previos de esa misma clave.
   * @returns {string}
   */
  private static _suffixed(baseKey: string, previousRuns: number): string {
    return previousRuns === 0 ? baseKey : `${baseKey}#${previousRuns}`;
  }

  /**
   * Llama al modelo dentro del job, cerrándolo como fallido si algo va mal.
   * @private
   * @param {string} userId - Usuario autenticado.
   * @param {AiJob} job - Job ya reservado.
   * @param {OutfitRowWithRelations} outfit - Look a renderizar.
   * @param {readonly IRenderGarmentPhoto[]} photos - Fotos que se mandan, en orden.
   * @returns {Promise<IRenderResult>}
   */
  private async _callModel(
    userId: string,
    job: AiJob,
    outfit: OutfitRowWithRelations,
    photos: readonly IRenderGarmentPhoto[],
  ): Promise<IRenderResult> {
    const read = await this._readImages(photos);
    if (read.images.length === 0) {
      await this._jobs.markFailed(userId, job.id, { errorMessage: missingBinaryMessage });
      throw new BadRequestException(missingBinaryMessage);
    }

    const profile = await this._profile.get(userId);
    const promptInput = OutfitRendersService._toPromptInput(outfit, profile, read.photos);

    await this._jobs.markRunning(userId, job.id);
    try {
      return await this._render.renderLook(promptInput, read.images);
    } catch (error) {
      return this._fail(userId, job, outfit.id, error);
    }
  }

  /**
   * Lee los binarios de las fotos y descarta los que ya no estén en disco. Una
   * foto perdida no debe tumbar el render si las demás siguen ahí, pero sí tiene
   * que salir también del prompt: por eso vuelven las dos listas juntas.
   * @private
   * @param {readonly IRenderGarmentPhoto[]} photos - Fotos a leer.
   * @returns {Promise<IRenderReadResult>}
   */
  private async _readImages(photos: readonly IRenderGarmentPhoto[]): Promise<IRenderReadResult> {
    const read = await Promise.all(photos.map(photo => this._storage.read(photo.storageKey)));
    const result: IRenderReadResult = { images: [], photos: [] };

    photos.forEach((photo, position) => {
      const file = read[position];
      if (!file) {
        return;
      }
      result.photos.push(photo);
      result.images.push({
        buffer: file.buffer,
        mimeType: file.mimeType,
        filename: `prenda-${result.images.length + 1}${renderPhotoExtension}`,
      });
    });

    const missing = photos.length - result.images.length;
    if (missing > 0) {
      this._logger.warn(
        `OutfitRendersService > _readImages - ${missing} de ${photos.length} fotos no están en almacenamiento`,
      );
    }
    return result;
  }

  /**
   * Traduce el look guardado a lo que ve el modelo de imagen. Cada prenda lleva la
   * posición de su foto, que es lo que ata la descripción a la imagen.
   * @private
   * @param {OutfitRowWithRelations} outfit - Look con sus prendas.
   * @param {StyleProfile} profile - Perfil del usuario.
   * @param {readonly IRenderGarmentPhoto[]} photos - Fotos que se van a mandar, en orden.
   * @returns {IRenderPromptInput}
   */
  private static _toPromptInput(
    outfit: OutfitRowWithRelations,
    profile: StyleProfile,
    photos: readonly IRenderGarmentPhoto[],
  ): IRenderPromptInput {
    const garments: IRenderPromptGarment[] = [];
    photos.forEach((photo, position) => {
      const item = outfit.items.find(candidate => candidate.garmentId === photo.garmentId);
      if (item) {
        garments.push({
          imageIndex: position + 1,
          name: item.garment.name,
          slot: item.slot,
          role: item.role,
          garmentTypeName: item.garment.garmentType.name,
          colorName: item.garment.primaryColorName,
          colorHex: item.garment.primaryColorHex,
          pattern: enumLabels.garmentPattern[item.garment.pattern].toLowerCase(),
          material: enumLabels.garmentMaterial[item.garment.material].toLowerCase(),
          fit: enumLabels.fitPreference[item.garment.fit].toLowerCase(),
        });
      }
    });

    return {
      profile,
      garments,
      styleTag: outfit.styleTag,
      title: outfit.title,
      oneLiner: outfit.oneLiner,
      occasions: outfit.occasions,
      weatherMinC: outfit.weatherMinC,
      weatherMaxC: outfit.weatherMaxC,
    };
  }

  /**
   * Cierra el job con su costo real y lo deja registrado en la auditoría.
   * @private
   * @param {string} userId - Usuario autenticado.
   * @param {AiJob} job - Job en curso.
   * @param {IRenderResult} result - Resultado de la llamada al modelo.
   * @returns {Promise<number>}
   */
  private async _settle(userId: string, job: AiJob, result: IRenderResult): Promise<number> {
    const costUsd = imageCostUsdFromUsage(result.model, result.usage);
    await this._jobs.markSucceeded(userId, job.id, {
      actualCostUsd: costUsd,
      model: result.model,
      ...(result.providerRequestId ? { providerRequestId: result.providerRequestId } : {}),
    });
    await this._usage.log({
      userId,
      costUsd,
      jobId: job.id,
      kind: 'RENDER',
      status: 'SUCCEEDED',
      model: result.model,
      latencyMs: result.latencyMs,
      inputTokens: result.usage.inputTextTokens + result.usage.inputImageTokens,
      outputTokens: result.usage.outputImageTokens,
      imageCount: result.imageCount,
      ...(result.providerRequestId ? { providerRequestId: result.providerRequestId } : {}),
    });
    return costUsd;
  }

  /**
   * Cierra el job como fallido y traduce el error al mensaje que verá el usuario.
   * El look no se toca: su ficha determinista sigue siendo válida sin render.
   * @private
   * @param {string} userId - Usuario autenticado.
   * @param {AiJob} job - Job en curso.
   * @param {string} outfitId - Look que se estaba renderizando.
   * @param {unknown} error - Error capturado.
   * @returns {Promise<never>}
   */
  private async _fail(
    userId: string,
    job: AiJob,
    outfitId: string,
    error: unknown,
  ): Promise<never> {
    const providerError =
      error instanceof AiProviderError
        ? error
        : new AiProviderError('provider', unexpectedErrorMessage, true);

    this._logger.error(
      `OutfitRendersService > _fail - render fallido del look ${outfitId} (${providerError.code})`,
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
      kind: 'RENDER',
      model: this._render.model,
      status: 'FAILED',
      costUsd: 0,
      latencyMs: 0,
      errorCode: providerError.code,
      errorMessage: providerError.message,
    });

    throw new HttpException(
      providerError.message,
      providerError.retryable ? HttpStatus.BAD_GATEWAY : HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  /**
   * Guarda la imagen en storage y su fila junto al look. Si la fila no se puede
   * escribir, el binario se descarta: un archivo huérfano no lo referencia nadie.
   * @private
   * @param {IRenderPersistContext} context - Usuario, look, job y resultado del modelo.
   * @returns {Promise<OutfitRender>}
   */
  private async _save(context: IRenderPersistContext): Promise<OutfitRender> {
    const buffer = Buffer.from(context.result.base64, 'base64');
    const measured = await OutfitRendersService._measure(buffer, context.result.size);
    const stored = await this._storage.save({
      buffer,
      userId: context.userId,
      entityId: context.outfitId,
      filename: renderFilename,
      mimeType: context.result.mimeType,
    });

    try {
      const created = await this._prisma.outfitRender.create({
        data: {
          outfitId: context.outfitId,
          kind: 'AI_MODEL',
          imageKey: stored.key,
          mimeType: stored.mimeType,
          byteSize: stored.byteSize,
          width: measured.width,
          height: measured.height,
          modelUsed: context.result.model,
          quality: context.result.quality,
          size: context.result.size,
          promptVersion: context.result.promptVersion,
          promptUsed: context.result.promptUsed,
          jobId: context.job.id,
        },
      });
      return toRenderDto(created, key => this._storage.urlFor(key));
    } catch (error) {
      await this._storage.delete(stored.key);
      this._logger.error(
        'OutfitRendersService > _save - no se pudo registrar el render; binario descartado',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * Mide la imagen generada. Si el binario no se puede leer se usa el tamaño que
   * se pidió, que es el que el proveedor devuelve para estos modelos.
   * @private
   * @param {Buffer} buffer - Imagen generada.
   * @param {string} requestedSize - Tamaño pedido, con forma `anchoxalto`.
   * @returns {Promise<{ width: number; height: number }>}
   */
  private static async _measure(
    buffer: Buffer,
    requestedSize: string,
  ): Promise<{ width: number; height: number }> {
    const [requestedWidth, requestedHeight] = requestedSize.split('x').map(Number);
    try {
      const metadata = await sharp(buffer).metadata();
      return {
        width: metadata.width ?? requestedWidth ?? 0,
        height: metadata.height ?? requestedHeight ?? 0,
      };
    } catch {
      return { width: requestedWidth ?? 0, height: requestedHeight ?? 0 };
    }
  }

  /**
   * Devuelve el look con sus prendas comprobando que sea del usuario.
   * @private
   * @param {string} userId - Propietario esperado.
   * @param {string} outfitId - Look buscado.
   * @returns {Promise<OutfitRowWithRelations>}
   */
  private async _requireOwned(userId: string, outfitId: string): Promise<OutfitRowWithRelations> {
    const outfit = await this._prisma.outfit.findFirst({
      where: { id: outfitId, userId },
      include: outfitInclude,
    });
    if (!outfit) {
      throw new NotFoundException(outfitNotFoundMessage);
    }
    return outfit;
  }
}
