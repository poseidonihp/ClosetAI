import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, type AiJob } from '@prisma/client';
import {
  OutfitGenerationSnapshotSchema,
  ReferenceBrandsSchema,
  outfitSnapshotVersion,
  type GenerateOutfitsRequest,
  type GenerateOutfitsResponse,
  type LookDiagnostics,
  type Outfit,
  type OutfitFeedbackRequest,
  type OutfitGenerationSnapshot,
  type OutfitQuery,
} from '@closetai/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageDriver } from '../../storage/storage.driver';
import { AiJobsService } from '../ai/ai-jobs.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { costUsdFromUsage } from '../ai/openai-pricing';
import { AiProviderError } from '../ai/openai.client';
import { GarmentsService, garmentInclude } from '../garments/garments.service';
import { engineVersion } from './engine/engine.constants';
import type { IEngineInput } from './engine/engine.types';
import { buildItems, buildPalette, buildWeatherRange } from './engine/narrative';
import {
  assembleOutfits,
  type IAssembledOutfit,
  type IAssemblyResult,
} from './llm/outfit-assembly';
import { buildStylistInput, type IStylistInputResult } from './llm/stylist-input';
import { StylistLlmService, type IStylistResult } from './llm/stylist-llm.service';
import { stylistPromptVersion } from './llm/stylist.prompt.v2';
import { toRenderDto } from './render/render-dto';
import { StylistService } from './stylist.service';

const unavailableMessage =
  'El estilista con IA no está disponible: falta configurar OPENAI_API_KEY en el servidor. La ficha del motor sigue funcionando.';
const noAttemptsLeftMessage =
  'Se agotaron los intentos de esta generación. Cambia algo de la petición o inténtalo más tarde.';
const alreadyRunningMessage =
  'Ya hay una generación en curso para esta misma petición. Espera a que termine.';
const unexpectedErrorMessage = 'No se pudieron generar los looks. Puedes reintentarlo.';
const outfitNotFoundMessage = 'Look no encontrado';
const allDiscardedNote =
  'El estilista propuso looks que no pasaron la validación del servidor, así que no se guardó ninguno.';

/** Prefijo de la clave de idempotencia. Fija el tipo de job. */
const idempotencyPrefix = 'styling';
/** Caracteres del hash de la petición que entran en la clave. */
const requestHashLength = 16;
/** Looks guardados que devuelve el listado. Un historial más largo no aporta nada. */
const maxListedOutfits = 30;

/**
 * Relaciones que `toDto` necesita para reconstruir la ficha completa. Se exporta
 * para que el servicio de renders lea el mismo look sin declarar otro `include`
 * que pudiera desincronizarse del DTO.
 */
export const outfitInclude = {
  items: {
    orderBy: { sortOrder: 'asc' },
    include: { garment: { include: garmentInclude } },
  },
  renders: { orderBy: { createdAt: 'desc' } },
} as const satisfies Prisma.OutfitInclude;

export type OutfitRowWithRelations = Prisma.OutfitGetPayload<{ include: typeof outfitInclude }>;

/** Todo lo que hace falta para guardar una tanda de looks. */
interface IPersistContext {
  userId: string;
  request: GenerateOutfitsRequest;
  input: IEngineInput;
  stylistInput: IStylistInputResult;
  llmResult: IStylistResult;
  job: AiJob;
  truncated: boolean;
}

/**
 * Ciclo de vida de los looks del estilista.
 * @class
 */
@Injectable()
export class OutfitsService {
  private readonly _logger = new Logger(OutfitsService.name);

  /**
   * Inicializa el servicio de looks.
   * @constructor
   * @param {PrismaService} _prisma - Cliente de base de datos.
   * @param {StylistService} _stylist - Capa 1: motor de compatibilidad.
   * @param {StylistLlmService} _llm - Capa 2: estilista LLM.
   * @param {GarmentsService} _garments - Prendas del usuario, para la ficha.
   * @param {StorageDriver} _storage - Driver de almacenamiento, para las URL de los renders.
   * @param {AiJobsService} _jobs - Presupuesto, idempotencia y reintentos.
   * @param {AiUsageService} _usage - Registro de auditoría del consumo.
   */
  constructor(
    private readonly _prisma: PrismaService,
    private readonly _stylist: StylistService,
    private readonly _llm: StylistLlmService,
    private readonly _garments: GarmentsService,
    private readonly _storage: StorageDriver,
    private readonly _jobs: AiJobsService,
    private readonly _usage: AiUsageService,
  ) {}

  /**
   * Genera looks con el estilista y los guarda.
   * @param {string} userId - Usuario autenticado.
   * @param {GenerateOutfitsRequest} request - Estilo, ocasión, clima y restricciones.
   * @returns {Promise<GenerateOutfitsResponse>}
   */
  async generate(
    userId: string,
    request: GenerateOutfitsRequest,
  ): Promise<GenerateOutfitsResponse> {
    if (!this._llm.isAvailable) {
      throw new ServiceUnavailableException(unavailableMessage);
    }

    const { input, result } = await this._stylist.runEngine(userId, request);
    if (result.scored.length === 0) {
      this._logger.log(
        `OutfitsService > generate - sin candidatos para el usuario ${userId}: no se llama al modelo`,
      );
      return this._respond({ diagnostics: result.diagnostics, outfits: [], discarded: [] });
    }

    const stylistInput = buildStylistInput(input, result, request);
    if (!OutfitsService._canHonorMustInclude(input, stylistInput)) {
      this._logger.log(
        `OutfitsService > generate - la prenda exigida por el usuario ${userId} no es elegible: no se llama al modelo`,
      );
      return this._respond({ diagnostics: result.diagnostics, outfits: [], discarded: [] });
    }

    const job = await this._reserveJob(userId, request, input, stylistInput);
    const llmResult = await this._callModel(userId, job, stylistInput);
    const costUsd = await this._settle(userId, job, llmResult);

    const assembly = assembleOutfits(llmResult.draft, {
      input,
      garmentsByShortId: stylistInput.garmentsByShortId,
    });
    const outfits = await this._save(assembly.accepted, {
      userId,
      request,
      input,
      stylistInput,
      llmResult,
      job,
      truncated: result.diagnostics.truncated,
    });

    return this._respond({
      outfits,
      costUsd,
      discarded: assembly.discarded,
      diagnostics: OutfitsService._mergeDiagnostics(result.diagnostics, llmResult, assembly),
    });
  }

  /**
   * Lista los looks guardados del usuario, del más reciente al más antiguo.
   * @param {string} userId - Usuario autenticado.
   * @param {OutfitQuery} [query={}] - Filtro del listado.
   * @returns {Promise<Outfit[]>}
   */
  async list(userId: string, query: OutfitQuery = {}): Promise<Outfit[]> {
    const outfits = await this._prisma.outfit.findMany({
      where: {
        userId,
        ...(query.favorite === undefined ? {} : { isFavorite: query.favorite }),
      },
      include: outfitInclude,
      orderBy: { createdAt: 'desc' },
      take: maxListedOutfits,
    });
    return outfits.map(outfit => this.toDto(outfit));
  }

  /**
   * Devuelve un look guardado del usuario.
   * @param {string} userId - Usuario autenticado.
   * @param {string} outfitId - Look buscado.
   * @returns {Promise<Outfit>}
   */
  async findOne(userId: string, outfitId: string): Promise<Outfit> {
    return this.toDto(await this._requireOwned(userId, outfitId));
  }

  /**
   * Registra una decisión del usuario sobre un look y actualiza su estado.
   *
   * El evento se guarda **siempre** y no sustituye a los anteriores: el orden en que
   * alguien cambia de opinión es parte de la señal. Lo que se sobreescribe es el
   * estado actual del look, que es lo que se muestra.
   * @param {string} userId - Usuario autenticado.
   * @param {string} outfitId - Look valorado.
   * @param {OutfitFeedbackRequest} feedback - Qué hizo el usuario.
   * @returns {Promise<Outfit>}
   */
  async addFeedback(
    userId: string,
    outfitId: string,
    feedback: OutfitFeedbackRequest,
  ): Promise<Outfit> {
    const current = await this._requireOwned(userId, outfitId);
    const happenedAt = new Date();

    await this._prisma.$transaction(async transaction => {
      await transaction.outfitFeedback.create({
        data: {
          userId,
          outfitId,
          kind: feedback.kind,
          rating: feedback.rating,
          reason: feedback.reason,
          note: feedback.note,
        },
      });
      await transaction.outfit.update({
        where: { id: outfitId },
        data: OutfitsService._stateAfter(feedback, happenedAt),
      });
      if (feedback.kind === 'WORN') {
        // Marcar un look como usado es lo que alimenta la penalización por
        // repetición del motor: sin esto la señal de variedad no tendría datos.
        await transaction.garment.updateMany({
          where: { userId, id: { in: current.items.map(item => item.garmentId) } },
          data: { wearCount: { increment: 1 }, lastWornAt: happenedAt },
        });
      }
    });

    return this.toDto(await this._requireOwned(userId, outfitId));
  }

  /**
   * Borra un look guardado del usuario. Sus prendas y su historial de feedback caen
   * por cascada; el clóset no se toca.
   * @param {string} userId - Usuario autenticado.
   * @param {string} outfitId - Look a borrar.
   * @returns {Promise<void>}
   */
  async remove(userId: string, outfitId: string): Promise<void> {
    const outfit = await this._requireOwned(userId, outfitId);
    await this._prisma.outfit.delete({ where: { id: outfitId } });
    await Promise.all(outfit.renders.map(render => this._storage.delete(render.imageKey)));
  }

  /**
   * Convierte la fila de Prisma en la ficha que consume el cliente.
   * @param {OutfitRowWithRelations} outfit - Fila con sus prendas y las relaciones de éstas.
   * @returns {Outfit}
   */
  toDto(outfit: OutfitRowWithRelations): Outfit {
    const snapshot = OutfitGenerationSnapshotSchema.safeParse(outfit.generationSnapshot);
    const brands = ReferenceBrandsSchema.safeParse(outfit.referenceBrands);

    return {
      id: outfit.id,
      title: outfit.title,
      styleTag: outfit.styleTag,
      oneLiner: outfit.oneLiner,
      description: outfit.description,
      occasions: outfit.occasions,
      styleNotes: outfit.styleNotes,
      fitNotes: outfit.fitNotes,
      colorPalette: outfit.colorPalette,
      qualityNote: outfit.qualityNote,
      weatherMinC: outfit.weatherMinC,
      weatherMaxC: outfit.weatherMaxC,
      engineScore: outfit.engineScore,
      source: outfit.source,
      isFavorite: outfit.isFavorite,
      rating: outfit.rating,
      rejectedReason: outfit.rejectedReason,
      wornAt: outfit.wornAt?.toISOString() ?? null,
      createdAt: outfit.createdAt.toISOString(),
      engineVersion: outfit.engineVersion,
      promptVersion: outfit.promptVersion,
      modelUsed: outfit.modelUsed,
      items: outfit.items.map(item => this._toItemDto(item)),
      renders: outfit.renders.map(render => toRenderDto(render, key => this._storage.urlFor(key))),
      referenceBrands: brands.success ? brands.data : { luxury: [], affordable: [] },
      scoreBreakdown: snapshot.success ? snapshot.data.scoreBreakdown : [],
      isStale: snapshot.success && outfit.items.length !== snapshot.data.garmentIds.length,
    };
  }

  /**
   * Traduce una prenda del look a la entrada de la ficha.
   * @private
   * @param {OutfitRowWithRelations['items'][number]} item - Prenda del look con su relación.
   * @returns {Outfit['items'][number]}
   */
  private _toItemDto(item: OutfitRowWithRelations['items'][number]): Outfit['items'][number] {
    const garment = this._garments.toDto(item.garment);
    const cover = garment.photos.find(photo => photo.isPrimary) ?? garment.photos[0];
    return {
      garmentId: garment.id,
      name: garment.name,
      slot: item.slot,
      role: item.role,
      garmentTypeName: garment.garmentTypeName,
      brand: garment.brand,
      colorHex: garment.primaryColorHex,
      colorName: garment.primaryColorName,
      formality: garment.formality,
      thumbUrl: cover?.thumbUrl ?? null,
      url: cover?.url ?? null,
      why: item.why,
    };
  }

  /**
   * Indica si la prenda que el usuario exigió puede entrar de verdad en un look.
   * @private
   * @param {IEngineInput} input - Entrada del motor, con la petición normalizada.
   * @param {IStylistInputResult} stylistInput - Prendas que viajan al modelo.
   * @returns {boolean}
   */
  private static _canHonorMustInclude(
    input: IEngineInput,
    stylistInput: IStylistInputResult,
  ): boolean {
    const mustIncludeId = input.request.mustIncludeGarmentId;
    if (mustIncludeId === null) {
      return true;
    }
    return [...stylistInput.garmentsByShortId.values()].some(
      garment => garment.id === mustIncludeId,
    );
  }

  /**
   * Envuelve la respuesta con los metadatos que la acompañan siempre.
   * @private
   * @param {{ outfits: Outfit[]; diagnostics: LookDiagnostics; discarded: string[]; costUsd?: number }} parts - Cuerpo de la respuesta.
   * @returns {GenerateOutfitsResponse}
   */
  private _respond(parts: {
    outfits: Outfit[];
    diagnostics: LookDiagnostics;
    discarded: string[];
    costUsd?: number;
  }): GenerateOutfitsResponse {
    return {
      engineVersion,
      outfits: parts.outfits,
      diagnostics: parts.diagnostics,
      discarded: parts.discarded,
      costUsd: parts.costUsd ?? 0,
      promptVersion: this._llm.promptVersion,
      model: this._llm.model,
    };
  }

  /**
   * Une el diagnóstico del motor con lo que dijo el modelo.
   * @private
   * @param {LookDiagnostics} diagnostics - Diagnóstico del motor.
   * @param {IStylistResult} llmResult - Respuesta del modelo.
   * @param {IAssemblyResult} assembly - Resultado de la validación.
   * @returns {LookDiagnostics}
   */
  private static _mergeDiagnostics(
    diagnostics: LookDiagnostics,
    llmResult: IStylistResult,
    assembly: IAssemblyResult,
  ): LookDiagnostics {
    const nothingSurvived = assembly.accepted.length === 0 && assembly.discarded.length > 0;
    return {
      ...diagnostics,
      note: diagnostics.note ?? (nothingSurvived ? allDiscardedNote : llmResult.draft.note),
    };
  }

  /**
   * Guarda los looks validados con su snapshot de generación.
   * @private
   * @param {readonly IAssembledOutfit[]} accepted - Looks que pasaron la validación.
   * @param {IPersistContext} context - Petición, entrada del motor, job y resultado del modelo.
   * @returns {Promise<Outfit[]>}
   */
  private async _save(
    accepted: readonly IAssembledOutfit[],
    context: IPersistContext,
  ): Promise<Outfit[]> {
    if (accepted.length === 0) {
      this._logger.warn(
        `OutfitsService > _save - ningún look del usuario ${context.userId} pasó la validación`,
      );
      return [];
    }
    const created = await this._prisma.$transaction(
      accepted.map(outfit =>
        this._prisma.outfit.create({
          data: OutfitsService._toCreateData(outfit, context),
          include: outfitInclude,
        }),
      ),
    );
    return created.map(outfit => this.toDto(outfit));
  }

  /**
   * Traduce un look validado a la fila que se guarda.
   * @private
   * @param {IAssembledOutfit} outfit - Look ya validado.
   * @param {IPersistContext} context - Petición, entrada del motor, job y resultado del modelo.
   * @returns {Prisma.OutfitCreateInput}
   */
  private static _toCreateData(
    outfit: IAssembledOutfit,
    context: IPersistContext,
  ): Prisma.OutfitCreateInput {
    const { weatherMinC, weatherMaxC } = buildWeatherRange(outfit.draft);
    const items = buildItems(outfit.draft, context.input, outfit.whyByGarmentId);
    const snapshot = OutfitsService._toSnapshot(outfit, context);

    return {
      title: outfit.narrative.title,
      oneLiner: outfit.narrative.oneLiner,
      description: outfit.narrative.description,
      occasions: outfit.narrative.occasions,
      styleNotes: outfit.narrative.styleNotes,
      fitNotes: outfit.narrative.fitNotes,
      qualityNote: outfit.narrative.qualityNote,
      referenceBrands: outfit.narrative.referenceBrands,
      colorPalette: buildPalette(outfit.draft),
      styleTag: context.request.styleTag,
      engineScore: outfit.engineScore,
      source: 'AI',
      promptVersion: context.llmResult.promptVersion,
      modelUsed: context.llmResult.model,
      candidateSetHash: context.stylistInput.candidateSetHash,
      generationSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      user: { connect: { id: context.userId } },
      job: { connect: { id: context.job.id } },
      items: {
        create: items.map((item, index) => ({
          garmentId: item.garmentId,
          slot: item.slot,
          role: item.role,
          why: item.why,
          sortOrder: index,
        })),
      },
      weatherMinC,
      weatherMaxC,
      engineVersion,
    };
  }

  /**
   * Snapshot de la generación: la entrada exacta que vio el modelo más lo que
   * decidió el motor. Es lo que permite comparar dos versiones del prompt sobre el
   * mismo clóset cuando la redacción del LLM no es reproducible.
   * @private
   * @param {IAssembledOutfit} outfit - Look ya validado.
   * @param {IPersistContext} context - Petición, entrada del motor, job y resultado del modelo.
   * @returns {OutfitGenerationSnapshot}
   */
  private static _toSnapshot(
    outfit: IAssembledOutfit,
    context: IPersistContext,
  ): OutfitGenerationSnapshot {
    return {
      version: outfitSnapshotVersion,
      request: context.request,
      resolvedTemperatureC: context.input.request.temperatureC,
      candidateSetHash: context.stylistInput.candidateSetHash,
      candidateCount: context.stylistInput.candidateCount,
      truncated: context.truncated,
      candidateId: outfit.candidateId,
      garmentIds: outfit.garmentIds,
      scoreBreakdown: outfit.scoreBreakdown,
    };
  }

  /**
   * Reserva presupuesto para esta generación.
   * @private
   * @param {string} userId - Usuario autenticado.
   * @param {GenerateOutfitsRequest} request - Petición tal como llegó.
   * @param {IEngineInput} input - Entrada del motor, con la temperatura ya resuelta.
   * @param {IStylistInputResult} stylistInput - Prendas y huella que viajan al modelo.
   * @returns {Promise<AiJob>}
   */
  private async _reserveJob(
    userId: string,
    request: GenerateOutfitsRequest,
    input: IEngineInput,
    stylistInput: IStylistInputResult,
  ): Promise<AiJob> {
    const baseKey = OutfitsService._baseKey(request, input);
    const previous = await this._prisma.aiJob.findMany({
      where: { userId, kind: 'STYLING', idempotencyKey: { startsWith: baseKey } },
      orderBy: { createdAt: 'desc' },
    });
    const [latest] = previous;
    const isRetry = latest?.status === 'FAILED' && this._jobs.canRetry(latest);

    const job = await this._jobs.reserve({
      userId,
      kind: 'STYLING',
      idempotencyKey: isRetry
        ? latest.idempotencyKey
        : OutfitsService._suffixed(baseKey, previous.length),
      estimatedCostUsd: this._llm.estimateCostUsd(stylistInput.garmentsByShortId.size),
      model: this._llm.model,
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
   * Clave base de una generación: tipo de job, versión del prompt y huella de la
   * petición ya resuelta. La temperatura entra resuelta para que "22 °C" y "clima
   * templado" no cuenten como peticiones distintas cuando significan lo mismo.
   * @private
   * @param {GenerateOutfitsRequest} request - Petición tal como llegó.
   * @param {IEngineInput} input - Entrada del motor, con la temperatura ya resuelta.
   * @returns {string}
   */
  private static _baseKey(request: GenerateOutfitsRequest, input: IEngineInput): string {
    const digest = createHash('sha256')
      .update(
        [
          request.styleTag,
          request.occasion ?? '',
          String(input.request.temperatureC ?? ''),
          request.mustIncludeGarmentId ?? '',
          String(request.includeSuggested),
          String(request.limit),
        ].join('|'),
      )
      .digest('hex')
      .slice(0, requestHashLength);
    return `${idempotencyPrefix}:${stylistPromptVersion}:${digest}`;
  }

  /**
   * Añade el número de generación a la clave base.
   * @private
   * @param {string} baseKey - Clave base de la petición.
   * @param {number} previousRuns - Generaciones previas de esa misma petición.
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
   * @param {IStylistInputResult} stylistInput - Prendas y prompt que viajan al modelo.
   * @returns {Promise<IStylistResult>}
   */
  private async _callModel(
    userId: string,
    job: AiJob,
    stylistInput: IStylistInputResult,
  ): Promise<IStylistResult> {
    await this._jobs.markRunning(userId, job.id);
    try {
      return await this._llm.writeLooks(stylistInput.promptInput);
    } catch (error) {
      return this._fail(userId, job, error);
    }
  }

  /**
   * Cierra el job con su costo real y lo deja registrado en la auditoría.
   * @private
   * @param {string} userId - Usuario autenticado.
   * @param {AiJob} job - Job en curso.
   * @param {IStylistResult} llmResult - Resultado de la llamada al modelo.
   * @returns {Promise<number>}
   */
  private async _settle(userId: string, job: AiJob, llmResult: IStylistResult): Promise<number> {
    const costUsd = costUsdFromUsage(llmResult.model, llmResult.usage);
    await this._jobs.markSucceeded(userId, job.id, {
      actualCostUsd: costUsd,
      model: llmResult.model,
      ...(llmResult.providerRequestId ? { providerRequestId: llmResult.providerRequestId } : {}),
    });
    await this._usage.log({
      userId,
      costUsd,
      jobId: job.id,
      kind: 'STYLING',
      status: 'SUCCEEDED',
      model: llmResult.model,
      latencyMs: llmResult.latencyMs,
      inputTokens: llmResult.usage.inputTokens,
      outputTokens: llmResult.usage.outputTokens,
      cachedInputTokens: llmResult.usage.cachedInputTokens,
      ...(llmResult.providerRequestId ? { providerRequestId: llmResult.providerRequestId } : {}),
    });
    return costUsd;
  }

  /**
   * Cierra el job como fallido y traduce el error al mensaje que verá el usuario.
   * @private
   * @param {string} userId - Usuario autenticado.
   * @param {AiJob} job - Job en curso.
   * @param {unknown} error - Error capturado.
   * @returns {Promise<never>}
   */
  private async _fail(userId: string, job: AiJob, error: unknown): Promise<never> {
    const providerError =
      error instanceof AiProviderError
        ? error
        : new AiProviderError('provider', unexpectedErrorMessage, true);

    this._logger.error(
      `OutfitsService > _fail - estilismo fallido del usuario ${userId} (${providerError.code})`,
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
      kind: 'STYLING',
      model: this._llm.model,
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
   * Estado del look después de una decisión del usuario.
   * @private
   * @param {OutfitFeedbackRequest} feedback - Qué hizo el usuario.
   * @param {Date} happenedAt - Momento del evento.
   * @returns {Prisma.OutfitUpdateInput}
   */
  private static _stateAfter(
    feedback: OutfitFeedbackRequest,
    happenedAt: Date,
  ): Prisma.OutfitUpdateInput {
    if (feedback.kind === 'RATING') {
      return { rating: feedback.rating };
    }
    if (feedback.kind === 'FAVORITE') {
      return { isFavorite: feedback.value };
    }
    if (feedback.kind === 'WORN') {
      return { wornAt: happenedAt };
    }
    return { rejectedReason: feedback.reason, isFavorite: false };
  }

  /**
   * Devuelve el look comprobando que sea del usuario.
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
