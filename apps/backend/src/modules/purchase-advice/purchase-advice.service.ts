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
import { Prisma, type AiJob, type PurchaseAdvice as PurchaseAdviceRow } from '@prisma/client';
import {
  PurchaseAdviceSnapshotSchema,
  enumLabels,
  maxAlternativeGaps,
  measureVersion,
  purchaseSnapshotVersion,
  type EvaluatePurchaseResponse,
  type Garment,
  type PurchaseAdvice,
  type PurchaseAlternative,
  type PurchaseCandidate,
  type PurchaseGarmentRef,
  type PurchaseImpact,
  type PurchaseMeasurement,
  type StyleProfile,
  type UpdateGarment,
  type UpdatePurchaseAdvice,
} from '@closetai/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageDriver } from '../../storage/storage.driver';
import { AiJobsService } from '../ai/ai-jobs.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { costUsdFromUsage } from '../ai/openai-pricing';
import { AiProviderError } from '../ai/openai.client';
import { GarmentTypesService } from '../garment-types/garment-types.service';
import { GarmentTaggingService } from '../garments/garment-tagging.service';
import {
  GarmentsService,
  garmentInclude,
  type GarmentRowWithRelations,
} from '../garments/garments.service';
import { ProfileService } from '../profile/profile.service';
import { engineVersion } from '../stylist/engine/engine.constants';
import { evaluatePurchase } from './evaluation';
import { AdviceLlmService } from './llm/advice-llm.service';
import { assembleAdvice } from './llm/advice-assembly';
import type { IAdviceImage, IAdviceResult } from './llm/advice.types';
import {
  maxListedCandidates,
  maxPairedGarmentsInEnum,
  purchaseGapShortIdPrefix,
  purchaseGarmentShortIdPrefix,
  purchaseSignatureLength,
} from './purchase-advice.constants';
import type {
  IAdviceCallParts,
  IAdvicePersistContext,
  IMeasurementContext,
  IOpenGapRef,
  IPromptGaps,
  IPromptGarments,
  IPurchaseEvaluation,
  IPurchaseEvaluationInput,
  IRespondParts,
} from './purchase-advice.types';

const unavailableMessage =
  'La redacción del veredicto con IA no está disponible: falta configurar OPENAI_API_KEY en el servidor. La medición sobre tu clóset sigue funcionando.';
const noAttemptsLeftMessage =
  'Se agotaron los intentos de este veredicto. Cambia algo de la prenda o inténtalo más tarde.';
const alreadyRunningMessage =
  'Ya hay un veredicto en curso para esta prenda. Espera a que termine.';
const unexpectedErrorMessage = 'No se pudo redactar el veredicto. Puedes reintentarlo.';
const adviceNotFoundMessage = 'Veredicto no encontrado';
const notACandidateMessage =
  'Esta prenda ya está en tu clóset: "¿me lo compro?" sólo evalúa las que todavía estás pensando.';

/** Prefijo de la clave de idempotencia. Fija el tipo de job. */
const idempotencyPrefix = 'advice';

/** Orden en que se listan las candidatas: lo que falta por decidir primero. */
const statusRank = { OPEN: 0, PURCHASED: 1, DISMISSED: 2 } as const;

/**
 * Ciclo de vida de "¿me lo compro?": medir la candidata contra el clóset y, si
 * el usuario lo pide, pagar la redacción del veredicto.
 * @class
 */
@Injectable()
export class PurchaseAdviceService {
  private readonly _logger = new Logger(PurchaseAdviceService.name);

  /**
   * Inicializa el servicio de evaluación de compras.
   * @constructor
   * @param {PrismaService} _prisma - Cliente de base de datos.
   * @param {GarmentsService} _garments - Prendas del usuario.
   * @param {ProfileService} _profile - Perfil de estilo del usuario.
   * @param {GarmentTypesService} _garmentTypes - Catálogo de tipos de prenda.
   * @param {AdviceLlmService} _llm - Capa 2: quien redacta el veredicto.
   * @param {AiJobsService} _jobs - Presupuesto, idempotencia y reintentos.
   * @param {AiUsageService} _usage - Registro de auditoría del consumo.
   * @param {StorageDriver} _storage - Driver de almacenamiento de imágenes.
   */
  constructor(
    private readonly _prisma: PrismaService,
    private readonly _garments: GarmentsService,
    private readonly _profile: ProfileService,
    private readonly _garmentTypes: GarmentTypesService,
    private readonly _llm: AdviceLlmService,
    private readonly _jobs: AiJobsService,
    private readonly _usage: AiUsageService,
    private readonly _storage: StorageDriver,
  ) {}

  /**
   * Lista las prendas que el usuario valoró antes de comprarlas, con su veredicto.
   * @param {string} userId - Usuario autenticado.
   * @returns {Promise<PurchaseCandidate[]>}
   */
  async list(userId: string): Promise<PurchaseCandidate[]> {
    const [considered, closet, advices] = await Promise.all([
      this._garments.list(userId, { ownership: 'CONSIDERED' }),
      this._garments.list(userId, {}),
      this._prisma.purchaseAdvice.findMany({ where: { userId } }),
    ]);

    const closetById = PurchaseAdviceService._byId(closet);
    const garmentById = new Map([...closetById, ...PurchaseAdviceService._byId(considered)]);
    const byGarmentId = new Map(advices.map(advice => [advice.garmentId, advice]));
    const garmentIds = [
      ...new Set([...considered.map(garment => garment.id), ...byGarmentId.keys()]),
    ];

    return garmentIds
      .map(garmentId => ({
        garment: garmentById.get(garmentId),
        advice: PurchaseAdviceService._toAdviceDto(byGarmentId.get(garmentId), closetById),
      }))
      .filter((entry): entry is PurchaseCandidate => entry.garment !== undefined)
      .sort((first, second) => statusRank[rankOf(first)] - statusRank[rankOf(second)])
      .slice(0, maxListedCandidates);
  }

  /**
   * Mide la candidata contra el clóset. Es determinista y gratis: no llama a
   * ningún proveedor.
   * @param {string} userId - Usuario autenticado.
   * @param {string} garmentId - Candidata a medir.
   * @returns {Promise<PurchaseMeasurement>}
   */
  async measure(userId: string, garmentId: string): Promise<PurchaseMeasurement> {
    const { measurement } = await this._runMeasurement(userId, garmentId);
    return measurement;
  }

  /**
   * Mide la candidata y paga la redacción del veredicto.
   * @param {string} userId - Usuario autenticado.
   * @param {string} garmentId - Candidata a evaluar.
   * @returns {Promise<EvaluatePurchaseResponse>}
   */
  async evaluate(userId: string, garmentId: string): Promise<EvaluatePurchaseResponse> {
    if (!this._llm.isAvailable) {
      throw new ServiceUnavailableException(unavailableMessage);
    }
    const context = await this._runMeasurement(userId, garmentId);
    const { measurement } = context;

    if (!measurement.canWriteAdvice) {
      this._logger.log(
        `PurchaseAdviceService > evaluate - sin datos para medir la prenda ${garmentId} (${measurement.verdictReason}): no se llama al modelo`,
      );
      return this._respond({ measurement, advice: null });
    }

    const reused = await this._tryReuse(userId, garmentId, context.signature, context.closetById);
    if (reused) {
      return this._respond({ measurement, advice: reused, reused: true });
    }

    const prompt = PurchaseAdviceService._toPromptInput(context.evaluation, context.closetById);
    const gaps = PurchaseAdviceService._toPromptGaps(
      context.openGaps,
      context.evaluation.matchedGapId,
    );
    const images = await this._readCover(context.candidateRow);
    const job = await this._reserveJob(
      userId,
      context.signature,
      prompt.garments.length,
      images.length,
    );
    const llmResult = await this._callModel(userId, job, context, {
      images,
      openGaps: gaps.gaps,
      pairedGarments: prompt.garments,
    });
    const costUsd = await this._settle(userId, job, llmResult);

    const assembly = assembleAdvice(llmResult.draft, prompt.byShortId, gaps.byShortId);
    if (assembly.discarded.length > 0) {
      this._logger.warn(
        `PurchaseAdviceService > evaluate - ${assembly.discarded.length} propuesta(s) descartadas del veredicto de ${garmentId}`,
      );
    }
    const advice = await this._save(userId, garmentId, assembly, {
      job,
      llmResult,
      measurement,
      signature: context.signature,
      pairedGarmentIds: assembly.pairedGarmentIds,
      alternative: assembly.alternative,
    });

    return this._respond({ measurement, costUsd, advice });
  }

  /**
   * Registra que el usuario descarta la candidata o vuelve a dudarla. Comprarla
   * no pasa por aquí: es una transición atómica que también toca la prenda.
   * @param {string} userId - Usuario autenticado.
   * @param {string} garmentId - Candidata afectada.
   * @param {UpdatePurchaseAdvice} dto - Nuevo estado.
   * @returns {Promise<PurchaseAdvice>}
   */
  async updateStatus(
    userId: string,
    garmentId: string,
    dto: UpdatePurchaseAdvice,
  ): Promise<PurchaseAdvice> {
    const existing = await this._requireAdvice(userId, garmentId);
    const updated = await this._prisma.purchaseAdvice.update({
      where: { id: existing.id },
      data: { status: dto.status, resolvedAt: dto.status === 'OPEN' ? null : new Date() },
    });
    const closet = await this._garments.list(userId, {});
    return PurchaseAdviceService._requireAdviceDto(updated, PurchaseAdviceService._byId(closet));
  }

  /**
   * Borra el veredicto guardado de una prenda. **La prenda no se toca.**
   * @param {string} userId - Usuario autenticado.
   * @param {string} garmentId - Prenda cuyo veredicto se olvida.
   * @returns {Promise<void>}
   */
  async forget(userId: string, garmentId: string): Promise<void> {
    const advice = await this._requireAdvice(userId, garmentId);
    await this._prisma.purchaseAdvice.delete({ where: { id: advice.id } });
  }

  /**
   * Mete la candidata en el clóset: la compró.
   * @param {string} userId - Usuario autenticado.
   * @param {string} garmentId - Candidata que pasa a ser suya.
   * @param {UpdateGarment} dto - Atributos finales tal como los dejó el usuario.
   * @returns {Promise<Garment>}
   */
  async purchase(userId: string, garmentId: string, dto: UpdateGarment): Promise<Garment> {
    const current = await this._requireCandidate(userId, garmentId);
    if (dto.garmentTypeId) {
      await this._garmentTypes.requireById(dto.garmentTypeId);
    }
    const resolvedAt = new Date();

    const updated = await this._prisma.$transaction(async transaction => {
      await transaction.purchaseAdvice.updateMany({
        where: { userId, garmentId },
        data: { status: 'PURCHASED', resolvedAt },
      });
      return transaction.garment.update({
        where: { id: garmentId },
        include: garmentInclude,
        data: {
          ...dto,
          ownership: 'OWNED',
          status: 'ACTIVE',
          taggingStatus: 'CONFIRMED',
          manualFields: GarmentsService.manualFieldsAfter(current, dto),
        },
      });
    });

    this._logger.log(
      `PurchaseAdviceService > purchase - la candidata ${garmentId} del usuario ${userId} entra al clóset`,
    );
    return this._garments.toDto(updated);
  }

  /**
   * Carga los datos del usuario, mide la candidata y arma la firma de la entrada.
   * @private
   * @param {string} userId - Usuario autenticado.
   * @param {string} garmentId - Candidata a medir.
   * @returns {Promise<IMeasurementContext>}
   */
  private async _runMeasurement(userId: string, garmentId: string): Promise<IMeasurementContext> {
    const candidateRow = await this._requireCandidate(userId, garmentId);
    const candidate = this._garments.toDto(candidateRow);

    const [closet, profile, catalog, openGaps] = await Promise.all([
      this._garments.list(userId, {}),
      this._profile.get(userId),
      this._garmentTypes.list(),
      this._prisma.wardrobeGap.findMany({
        where: { userId, status: 'OPEN' },
        orderBy: { priority: 'asc' },
        select: {
          id: true,
          garmentTypeId: true,
          slot: true,
          colorHex: true,
          colorName: true,
          formality: true,
          description: true,
          priority: true,
          unlockedOutfitsEstimate: true,
        },
      }),
    ]);

    const input: IPurchaseEvaluationInput = {
      candidate,
      closet,
      profile,
      catalog,
      openGaps,
      now: new Date(),
    };
    const evaluation = evaluatePurchase(input);
    const closetById = PurchaseAdviceService._byId(closet);

    return {
      candidate,
      candidateRow,
      evaluation,
      closetById,
      openGaps,
      measurement: PurchaseAdviceService._toMeasurement(candidate, evaluation, closetById),
      signature: this._signature(candidate, closet, profile, openGaps),
    };
  }

  /**
   * Traduce la evaluación a la ficha que consume el cliente.
   * @private
   * @param {Garment} candidate - Candidata evaluada.
   * @param {IPurchaseEvaluation} evaluation - Resultado del cálculo determinista.
   * @param {ReadonlyMap<string, Garment>} closetById - Clóset por id.
   * @returns {PurchaseMeasurement}
   */
  private static _toMeasurement(
    candidate: Garment,
    evaluation: IPurchaseEvaluation,
    closetById: ReadonlyMap<string, Garment>,
  ): PurchaseMeasurement {
    const impact = PurchaseAdviceService._toImpact(evaluation);
    return {
      impact,
      measureVersion,
      engineVersion,
      garmentId: candidate.id,
      verdict: evaluation.verdict,
      verdictReason: evaluation.verdictReason,
      note: evaluation.note,
      canWriteAdvice: impact !== null,
      pairedGarments: PurchaseAdviceService._toRefs(impact?.pairedGarmentIds ?? [], closetById),
      duplicateGarments: PurchaseAdviceService._toRefs(evaluation.duplicateGarmentIds, closetById),
    };
  }

  /**
   * Traduce lo que midió el motor al bloque de números que viaja al cliente.
   * @private
   * @param {IPurchaseEvaluation} evaluation - Resultado del cálculo determinista.
   * @returns {PurchaseImpact | null}
   */
  private static _toImpact(evaluation: IPurchaseEvaluation): PurchaseImpact | null {
    const { impact } = evaluation;
    if (impact === null) {
      return null;
    }
    return {
      unlockedOutfitsEstimate: impact.unlockedOutfitsEstimate,
      outfitsUsingItEstimate: impact.outfitsUsingItEstimate,
      scoreGainPoints: impact.scoreGain,
      newlyCoveredScenarioLabels: evaluation.newlyCoveredScenarioLabels,
      pairedGarmentIds: impact.pairedGarmentIds.slice(0, maxPairedGarmentsInEnum),
      duplicateGarmentIds: evaluation.duplicateGarmentIds,
      matchedGapId: evaluation.matchedGapId,
    };
  }

  /**
   * Prendas del usuario que se le enseñan al modelo, con su id corto posicional.
   * @private
   * @param {IPurchaseEvaluation} evaluation - Resultado del cálculo determinista.
   * @param {ReadonlyMap<string, Garment>} closetById - Clóset por id.
   * @returns {IPromptGarments}
   */
  private static _toPromptInput(
    evaluation: IPurchaseEvaluation,
    closetById: ReadonlyMap<string, Garment>,
  ): IPromptGarments {
    const paired = (evaluation.impact?.pairedGarmentIds ?? [])
      .slice(0, maxPairedGarmentsInEnum)
      .map(id => closetById.get(id))
      .filter((garment): garment is Garment => garment !== undefined)
      .map((garment, index) => ({
        garment,
        shortId: `${purchaseGarmentShortIdPrefix}${index + 1}`,
      }));

    return {
      byShortId: new Map(paired.map(entry => [entry.shortId, entry.garment])),
      garments: paired.map(entry => ({
        shortId: entry.shortId,
        name: entry.garment.name,
        typeName: entry.garment.garmentTypeName,
        slotLabel: enumLabels.garmentSlot[entry.garment.slot].toLowerCase(),
        colorName: entry.garment.primaryColorName,
        formality: entry.garment.formality,
      })),
    };
  }

  /**
   * Brechas abiertas que se le ofrecen al modelo como alternativa, con su id
   * corto posicional. La que esta misma prenda ya cubre se queda fuera:
   * proponerla sería proponer lo que el usuario tiene delante.
   * @private
   * @param {readonly IOpenGapRef[]} openGaps - Brechas pendientes, por prioridad.
   * @param {string | null} matchedGapId - Brecha que cubre la candidata, si cubre alguna.
   * @returns {IPromptGaps}
   */
  private static _toPromptGaps(
    openGaps: readonly IOpenGapRef[],
    matchedGapId: string | null,
  ): IPromptGaps {
    const offered = openGaps
      .filter(gap => gap.id !== matchedGapId)
      .slice(0, maxAlternativeGaps)
      .map((gap, index) => ({ gap, shortId: `${purchaseGapShortIdPrefix}${index + 1}` }));

    return {
      byShortId: new Map(offered.map(entry => [entry.shortId, entry.gap])),
      gaps: offered.map(entry => ({
        shortId: entry.shortId,
        description: entry.gap.description,
        slot: entry.gap.slot,
        formality: entry.gap.formality,
        priority: entry.gap.priority,
        unlockedOutfitsEstimate: entry.gap.unlockedOutfitsEstimate,
      })),
    };
  }

  /**
   * Lee la portada de la candidata para que el modelo escriba mirándola. Una
   * prenda sin fotos o con el binario perdido no rompe nada: se llama sin imagen
   * y el prompt no la menciona.
   * @private
   * @param {GarmentRowWithRelations} candidateRow - Candidata con sus imágenes.
   * @returns {Promise<IAdviceImage[]>}
   */
  private async _readCover(candidateRow: GarmentRowWithRelations): Promise<IAdviceImage[]> {
    const hasOriginal = candidateRow.images.some(image => image.kind === 'ORIGINAL');
    const cover = hasOriginal ? GarmentTaggingService.selectPhotos(candidateRow.images)[0] : null;
    if (!cover) {
      return [];
    }
    const file = await this._storage.read(cover.storageKey);
    if (file === null) {
      this._logger.warn(
        `PurchaseAdviceService > _readCover - la portada de la prenda ${candidateRow.id} no está en almacenamiento`,
      );
      return [];
    }
    return [{ buffer: file.buffer, mimeType: file.mimeType }];
  }

  /**
   * Devuelve el veredicto guardado si salió de esta misma prenda y este clóset.
   * @private
   * @param {string} userId - Usuario autenticado.
   * @param {string} garmentId - Candidata evaluada.
   * @param {string} signature - Huella de la entrada actual.
   * @param {ReadonlyMap<string, Garment>} closetById - Clóset por id.
   * @returns {Promise<PurchaseAdvice | null>}
   */
  private async _tryReuse(
    userId: string,
    garmentId: string,
    signature: string,
    closetById: ReadonlyMap<string, Garment>,
  ): Promise<PurchaseAdvice | null> {
    const existing = await this._prisma.purchaseAdvice.findFirst({ where: { userId, garmentId } });
    if (!existing || PurchaseAdviceService._signatureOf(existing.analysisSnapshot) !== signature) {
      return null;
    }
    return PurchaseAdviceService._requireAdviceDto(existing, closetById);
  }

  /**
   * Huella de todo lo que vio la evaluación. Si cambia cualquiera de estas cosas
   * el veredicto guardado deja de valer: los atributos corregidos, las fotos, el
   * clóset, el perfil, las brechas o la versión del cálculo.
   * @private
   * @param {Garment} candidate - Candidata evaluada.
   * @param {readonly Garment[]} closet - Prendas que el usuario ya tiene.
   * @param {StyleProfile} profile - Perfil del usuario.
   * @param {readonly { id: string }[]} openGaps - Brechas pendientes.
   * @returns {string}
   */
  private _signature(
    candidate: Garment,
    closet: readonly Garment[],
    profile: StyleProfile,
    openGaps: readonly { id: string }[],
  ): string {
    const parts = [
      measureVersion,
      engineVersion,
      this._llm.promptVersion,
      PurchaseAdviceService._fingerprintOf(candidate),
      candidate.tagging.version ?? 'sin-etiquetar',
      candidate.photos
        .map(photo => photo.id)
        .sort((first, second) => first.localeCompare(second))
        .join(','),
      profile.updatedAt,
      ...[...closet]
        .map(PurchaseAdviceService._fingerprintOf)
        .sort((first, second) => first.localeCompare(second)),
      ...[...openGaps].map(gap => gap.id).sort((first, second) => first.localeCompare(second)),
    ];
    return createHash('sha256')
      .update(parts.join('|'))
      .digest('hex')
      .slice(0, purchaseSignatureLength);
  }

  /**
   * Los atributos de una prenda que cambian la medición, en una línea.
   * @private
   * @param {Garment} garment - Prenda a resumir.
   * @returns {string}
   */
  private static _fingerprintOf(garment: Garment): string {
    return [
      garment.id,
      garment.garmentTypeId,
      garment.slot,
      garment.primaryColorHex,
      garment.pattern,
      garment.patternScale,
      garment.material,
      garment.fit,
      garment.formality,
      garment.seasons.join(','),
      garment.weatherMinC ?? '',
      garment.weatherMaxC ?? '',
      garment.status,
      garment.taggingStatus,
    ].join(':');
  }

  /**
   * Lee la huella guardada en el snapshot de un veredicto.
   * @private
   * @param {Prisma.JsonValue} snapshot - Json tal como está guardado.
   * @returns {string | null}
   */
  private static _signatureOf(snapshot: Prisma.JsonValue): string | null {
    if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
      return null;
    }
    const signature = (snapshot as Record<string, unknown>)['signature'];
    return typeof signature === 'string' ? signature : null;
  }

  /**
   * Reserva presupuesto para esta redacción.
   * @private
   * @param {string} userId - Usuario autenticado.
   * @param {string} signature - Huella de la entrada actual.
   * @param {number} garmentCount - Prendas propias que viajan al modelo.
   * @param {number} imageCount - Fotos que viajan al modelo.
   * @returns {Promise<AiJob>}
   */
  private async _reserveJob(
    userId: string,
    signature: string,
    garmentCount: number,
    imageCount: number,
  ): Promise<AiJob> {
    const baseKey = `${idempotencyPrefix}:${this._llm.promptVersion}:${signature}`;
    const previous = await this._prisma.aiJob.findMany({
      where: { userId, kind: 'PURCHASE_ADVICE', idempotencyKey: { startsWith: baseKey } },
      orderBy: { createdAt: 'desc' },
    });
    const [latest] = previous;
    const isRetry = latest?.status === 'FAILED' && this._jobs.canRetry(latest);

    const job = await this._jobs.reserve({
      userId,
      kind: 'PURCHASE_ADVICE',
      idempotencyKey: isRetry
        ? latest.idempotencyKey
        : PurchaseAdviceService._suffixed(baseKey, previous.length),
      estimatedCostUsd: this._llm.estimateCostUsd(garmentCount, imageCount),
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
   * Añade el número de evaluaciones previas a la clave base.
   * @private
   * @param {string} baseKey - Clave base de la huella.
   * @param {number} previousRuns - Evaluaciones previas de esa misma huella.
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
   * @param {IMeasurementContext} context - Candidata y medición ya resueltas.
   * @param {IAdviceCallParts} parts - Prendas, brechas y fotos que se le enseñan.
   * @returns {Promise<IAdviceResult>}
   */
  private async _callModel(
    userId: string,
    job: AiJob,
    context: IMeasurementContext,
    parts: IAdviceCallParts,
  ): Promise<IAdviceResult> {
    const profile = await this._profile.get(userId);
    await this._jobs.markRunning(userId, job.id);
    try {
      return await this._llm.writeAdvice(
        {
          profile,
          openGaps: parts.openGaps,
          pairedGarments: parts.pairedGarments,
          candidate: context.candidate,
          measurement: context.measurement,
          duplicateNames: context.measurement.duplicateGarments.map(garment => garment.name),
          hasPhoto: parts.images.length > 0,
        },
        parts.images,
      );
    } catch (error) {
      return this._fail(userId, job, error);
    }
  }

  /**
   * Cierra el job con su costo real y lo deja registrado en la auditoría.
   * @private
   * @param {string} userId - Usuario autenticado.
   * @param {AiJob} job - Job en curso.
   * @param {IAdviceResult} llmResult - Resultado de la llamada al modelo.
   * @returns {Promise<number>}
   */
  private async _settle(userId: string, job: AiJob, llmResult: IAdviceResult): Promise<number> {
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
      kind: 'PURCHASE_ADVICE',
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
      `PurchaseAdviceService > _fail - veredicto fallido del usuario ${userId} (${providerError.code})`,
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
      kind: 'PURCHASE_ADVICE',
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
   * Guarda el veredicto reemplazando el anterior de esa misma prenda.
   * @private
   * @param {string} userId - Usuario autenticado.
   * @param {string} garmentId - Candidata evaluada.
   * @param {{ headline: string; reason: string; stylingNotes: string[] }} text - Lo que redactó el modelo.
   * @param {IAdvicePersistContext} context - Job, huella, medición, alternativa y resultado.
   * @returns {Promise<PurchaseAdvice>}
   */
  private async _save(
    userId: string,
    garmentId: string,
    text: { headline: string; reason: string; stylingNotes: string[] },
    context: IAdvicePersistContext,
  ): Promise<PurchaseAdvice> {
    const { measurement } = context;
    const impact = measurement.impact;
    const data = {
      headline: text.headline,
      reason: text.reason,
      stylingNotes: text.stylingNotes,
      verdict: measurement.verdict,
      verdictReason: measurement.verdictReason,
      unlockedOutfitsEstimate: impact?.unlockedOutfitsEstimate ?? 0,
      outfitsUsingItEstimate: impact?.outfitsUsingItEstimate ?? 0,
      scoreGainPoints: impact?.scoreGainPoints ?? 0,
      pairedGarmentIds: context.pairedGarmentIds,
      duplicateGarmentIds: impact?.duplicateGarmentIds ?? [],
      matchedGapId: impact?.matchedGapId ?? null,
      alternativeGapId: context.alternative?.gapId ?? null,
      alternativeLabel: context.alternative?.label ?? null,
      alternativeNote: context.alternative?.note ?? null,
      measureVersion,
      promptVersion: context.llmResult.promptVersion,
      modelUsed: context.llmResult.model,
      jobId: context.job.id,
      status: 'OPEN',
      resolvedAt: null,
      analysisSnapshot: {
        version: purchaseSnapshotVersion,
        signature: context.signature,
        measurement,
      } as unknown as Prisma.InputJsonValue,
    } satisfies Omit<Prisma.PurchaseAdviceUncheckedCreateInput, 'userId' | 'garmentId'>;

    const saved = await this._prisma.purchaseAdvice.upsert({
      where: { garmentId },
      create: { userId, garmentId, ...data },
      update: data,
    });
    const closet = await this._garments.list(userId, {});
    return PurchaseAdviceService._requireAdviceDto(saved, PurchaseAdviceService._byId(closet));
  }

  /**
   * Envuelve la respuesta con los metadatos que la acompañan siempre.
   * @private
   * @param {IRespondParts} parts - Cuerpo de la respuesta.
   * @returns {EvaluatePurchaseResponse}
   */
  private _respond(parts: IRespondParts): EvaluatePurchaseResponse {
    return {
      advice: parts.advice,
      measurement: parts.measurement,
      reused: parts.reused ?? false,
      costUsd: parts.costUsd ?? 0,
      promptVersion: this._llm.promptVersion,
      model: this._llm.model,
    };
  }

  /**
   * Devuelve la candidata comprobando que sea del usuario y que siga sin comprar.
   * @private
   * @param {string} userId - Usuario autenticado.
   * @param {string} garmentId - Prenda buscada.
   * @returns {Promise<GarmentRowWithRelations>}
   */
  private async _requireCandidate(
    userId: string,
    garmentId: string,
  ): Promise<GarmentRowWithRelations> {
    const garment = await this._garments.requireOwned(userId, garmentId);
    if (garment.ownership !== 'CONSIDERED') {
      throw new BadRequestException(notACandidateMessage);
    }
    return garment;
  }

  /**
   * Devuelve el veredicto de una candidata comprobando que sea del usuario.
   * @private
   * @param {string} userId - Usuario autenticado.
   * @param {string} garmentId - Candidata buscada.
   * @returns {Promise<PurchaseAdviceRow>}
   */
  private async _requireAdvice(userId: string, garmentId: string): Promise<PurchaseAdviceRow> {
    const advice = await this._prisma.purchaseAdvice.findFirst({ where: { userId, garmentId } });
    if (!advice) {
      throw new NotFoundException(adviceNotFoundMessage);
    }
    return advice;
  }

  /**
   * Convierte la fila de Prisma en la ficha que consume el cliente.
   * @param {PurchaseAdviceRow | undefined} advice - Fila guardada, si la hay.
   * @param {ReadonlyMap<string, Garment>} closetById - Clóset por id.
   * @returns {PurchaseAdvice | null}
   */
  private static _toAdviceDto(
    advice: PurchaseAdviceRow | undefined,
    closetById: ReadonlyMap<string, Garment>,
  ): PurchaseAdvice | null {
    if (!advice) {
      return null;
    }
    return {
      id: advice.id,
      garmentId: advice.garmentId,
      status: advice.status,
      verdict: advice.verdict,
      verdictReason: advice.verdictReason,
      headline: advice.headline,
      reason: advice.reason,
      stylingNotes: advice.stylingNotes,
      alternative: PurchaseAdviceService._toAlternative(advice),
      impact: {
        unlockedOutfitsEstimate: advice.unlockedOutfitsEstimate,
        outfitsUsingItEstimate: advice.outfitsUsingItEstimate,
        scoreGainPoints: advice.scoreGainPoints,
        newlyCoveredScenarioLabels: PurchaseAdviceService._coveredLabelsOf(advice),
        pairedGarmentIds: advice.pairedGarmentIds,
        duplicateGarmentIds: advice.duplicateGarmentIds,
        matchedGapId: advice.matchedGapId,
      },
      pairedGarments: PurchaseAdviceService._toRefs(advice.pairedGarmentIds, closetById),
      duplicateGarments: PurchaseAdviceService._toRefs(advice.duplicateGarmentIds, closetById),
      measureVersion: advice.measureVersion,
      promptVersion: advice.promptVersion,
      modelUsed: advice.modelUsed,
      createdAt: advice.createdAt.toISOString(),
      resolvedAt: advice.resolvedAt?.toISOString() ?? null,
    };
  }

  /**
   * Igual que `_toAdviceDto` pero para donde la fila existe seguro.
   * @private
   * @param {PurchaseAdviceRow} advice - Fila guardada.
   * @param {ReadonlyMap<string, Garment>} closetById - Clóset por id.
   * @returns {PurchaseAdvice}
   */
  private static _requireAdviceDto(
    advice: PurchaseAdviceRow,
    closetById: ReadonlyMap<string, Garment>,
  ): PurchaseAdvice {
    const dto = PurchaseAdviceService._toAdviceDto(advice, closetById);
    if (dto === null) {
      throw new NotFoundException(adviceNotFoundMessage);
    }
    return dto;
  }

  /**
   * La alternativa guardada, si el modelo propuso alguna. El texto se sostiene
   * sobre `alternativeLabel` y no sobre la brecha viva: un análisis nuevo de la
   * Fase 5 reemplaza las `OPEN`, así que el id puede haber dejado de existir.
   * @private
   * @param {PurchaseAdviceRow} advice - Fila guardada.
   * @returns {PurchaseAlternative | null}
   */
  private static _toAlternative(advice: PurchaseAdviceRow): PurchaseAlternative | null {
    if (advice.alternativeLabel === null) {
      return null;
    }
    return {
      gapId: advice.alternativeGapId,
      label: advice.alternativeLabel,
      note: advice.alternativeNote ?? '',
    };
  }

  /**
   * Escenarios que la prenda pasaría a cubrir, leídos del snapshot guardado. No
   * se recalculan: la fila describe lo que se midió entonces, no lo de ahora.
   * @private
   * @param {PurchaseAdviceRow} advice - Fila guardada.
   * @returns {string[]}
   */
  private static _coveredLabelsOf(advice: PurchaseAdviceRow): string[] {
    const snapshot = PurchaseAdviceSnapshotSchema.safeParse(advice.analysisSnapshot);
    return snapshot.success
      ? (snapshot.data.measurement.impact?.newlyCoveredScenarioLabels ?? [])
      : [];
  }

  /**
   * Resuelve una lista de ids contra el clóset, saltándose lo que ya no exista.
   * @private
   * @param {readonly string[]} garmentIds - Ids a resolver.
   * @param {ReadonlyMap<string, Garment>} closetById - Clóset por id.
   * @returns {PurchaseGarmentRef[]}
   */
  private static _toRefs(
    garmentIds: readonly string[],
    closetById: ReadonlyMap<string, Garment>,
  ): PurchaseGarmentRef[] {
    return garmentIds
      .map(id => closetById.get(id))
      .filter((garment): garment is Garment => garment !== undefined)
      .map(garment => ({
        id: garment.id,
        name: garment.name,
        slot: garment.slot,
        colorName: garment.primaryColorName,
        colorHex: garment.primaryColorHex,
      }));
  }

  /**
   * Indexa un clóset por id de prenda.
   * @private
   * @param {readonly Garment[]} garments - Prendas a indexar.
   * @returns {Map<string, Garment>}
   */
  private static _byId(garments: readonly Garment[]): Map<string, Garment> {
    return new Map(garments.map(garment => [garment.id, garment]));
  }
}

/**
 * Estado por el que se ordena una candidata en la lista.
 * @param {PurchaseCandidate} candidate - Candidata con su veredicto, si lo tiene.
 * @returns {keyof typeof statusRank}
 */
function rankOf(candidate: PurchaseCandidate): keyof typeof statusRank {
  return candidate.advice?.status ?? 'OPEN';
}
