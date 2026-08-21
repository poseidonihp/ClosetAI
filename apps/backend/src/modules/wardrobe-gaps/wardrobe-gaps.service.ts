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
  ReferenceBrandsSchema,
  coverageVersion,
  gapSnapshotVersion,
  type AnalyzeGapsResponse,
  type CoverageResponse,
  type UpdateWardrobeGap,
  type WardrobeGap,
} from '@closetai/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { AiJobsService } from '../ai/ai-jobs.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { costUsdFromUsage } from '../ai/openai-pricing';
import { AiProviderError } from '../ai/openai.client';
import { GarmentTypesService } from '../garment-types/garment-types.service';
import { GarmentsService } from '../garments/garments.service';
import { ProfileService } from '../profile/profile.service';
import { analyzeCoverage } from './coverage/coverage';
import type { ICoverageInput, ICoverageResult } from './coverage/coverage.types';
import { assembleGaps } from './llm/gap-assembly';
import { GapsLlmService } from './llm/gaps-llm.service';
import { gapsPromptVersion } from './llm/gaps.prompt.v1';
import type { IAssembledGap, IGapsResult } from './llm/gaps.types';
import type { IPersistContext, IRespondParts } from './wardrobe-gaps.types';

const unavailableMessage =
  'El análisis de vacíos con IA no está disponible: falta configurar OPENAI_API_KEY en el servidor. La cobertura del clóset sigue funcionando.';
const noAttemptsLeftMessage =
  'Se agotaron los intentos de este análisis. Cambia algo del clóset o inténtalo más tarde.';
const alreadyRunningMessage = 'Ya hay un análisis en curso. Espera a que termine.';
const unexpectedErrorMessage = 'No se pudo analizar el clóset. Puedes reintentarlo.';
const gapNotFoundMessage = 'Brecha no encontrada';
const allDiscardedNote =
  'El análisis propuso brechas que no pasaron la validación del servidor, así que no se guardó ninguna.';

/** Prefijo de la clave de idempotencia. Fija el tipo de job. */
const idempotencyPrefix = 'gaps';
/** Caracteres de la huella del análisis que entran en la clave. */
const signatureLength = 16;
/** Brechas que devuelve el listado. Una lista de la compra más larga no se usa. */
const maxListedGaps = 40;

/** Relaciones que `toDto` necesita para nombrar el tipo de prenda. */
const gapInclude = {
  garmentType: { select: { name: true } },
} as const satisfies Prisma.WardrobeGapInclude;

type GapRowWithRelations = Prisma.WardrobeGapGetPayload<{ include: typeof gapInclude }>;

/** Orden en que se listan las brechas: lo pendiente primero. */
const statusRank = { OPEN: 0, PURCHASED: 1, DISMISSED: 2 } as const;

/**
 * Ciclo de vida del análisis de vacíos del clóset.
 * @class
 */
@Injectable()
export class WardrobeGapsService {
  private readonly _logger = new Logger(WardrobeGapsService.name);

  /**
   * Inicializa el servicio de vacíos del clóset.
   * @constructor
   * @param {PrismaService} _prisma - Cliente de base de datos.
   * @param {GarmentsService} _garments - Prendas del usuario.
   * @param {ProfileService} _profile - Perfil de estilo del usuario.
   * @param {GarmentTypesService} _garmentTypes - Catálogo de tipos de prenda.
   * @param {GapsLlmService} _llm - Capa 2: quien ordena y redacta.
   * @param {AiJobsService} _jobs - Presupuesto, idempotencia y reintentos.
   * @param {AiUsageService} _usage - Registro de auditoría del consumo.
   */
  constructor(
    private readonly _prisma: PrismaService,
    private readonly _garments: GarmentsService,
    private readonly _profile: ProfileService,
    private readonly _garmentTypes: GarmentTypesService,
    private readonly _llm: GapsLlmService,
    private readonly _jobs: AiJobsService,
    private readonly _usage: AiUsageService,
  ) {}

  /**
   * Lista las brechas guardadas del usuario, con lo pendiente primero.
   * @param {string} userId - Usuario autenticado.
   * @returns {Promise<WardrobeGap[]>}
   */
  async list(userId: string): Promise<WardrobeGap[]> {
    const gaps = await this._prisma.wardrobeGap.findMany({
      where: { userId },
      include: gapInclude,
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      take: maxListedGaps,
    });
    return gaps
      .map(gap => WardrobeGapsService.toDto(gap))
      .sort((first, second) => statusRank[first.status] - statusRank[second.status]);
  }

  /**
   * Devuelve la cobertura del clóset y las prendas candidatas sin llamar a nadie.
   * @param {string} userId - Usuario autenticado.
   * @returns {Promise<CoverageResponse>}
   */
  async coverage(userId: string): Promise<CoverageResponse> {
    const { result } = await this._runCoverage(userId);
    return { coverage: result.coverage, hypotheses: result.hypotheses, note: result.note };
  }

  /**
   * Analiza el clóset y guarda las brechas priorizadas.
   * @param {string} userId - Usuario autenticado.
   * @returns {Promise<AnalyzeGapsResponse>}
   */
  async analyze(userId: string): Promise<AnalyzeGapsResponse> {
    if (!this._llm.isAvailable) {
      throw new ServiceUnavailableException(unavailableMessage);
    }

    const { result } = await this._runCoverage(userId);
    if (result.hypotheses.length === 0) {
      this._logger.log(
        `WardrobeGapsService > analyze - sin brechas para el usuario ${userId}: no se llama al modelo`,
      );
      await this._prisma.wardrobeGap.deleteMany({ where: { userId, status: 'OPEN' } });
      return this._respond({ coverage: result.coverage, gaps: [], note: result.note });
    }

    const signature = WardrobeGapsService._signature(result);
    const reused = await this._tryReuse(userId, signature);
    if (reused) {
      return this._respond({
        coverage: result.coverage,
        gaps: reused,
        note: result.note,
        reused: true,
      });
    }

    const job = await this._reserveJob(userId, signature, result.hypotheses.length);
    const llmResult = await this._callModel(userId, job, result);
    const costUsd = await this._settle(userId, job, llmResult);

    const assembly = assembleGaps(llmResult.draft, result.hypotheses);
    const gaps = await this._save(userId, assembly.accepted, {
      job,
      signature,
      llmResult,
      coverage: result.coverage,
    });

    return this._respond({
      gaps,
      costUsd,
      coverage: result.coverage,
      discarded: assembly.discarded,
      note: WardrobeGapsService._mergeNote(result.note, llmResult, assembly.accepted.length),
    });
  }

  /**
   * Registra lo que el usuario decidió sobre una brecha.
   *
   * `DISMISSED` no es sólo ocultarla: el siguiente análisis no vuelve a proponer
   * esa misma prenda, así que la decisión sobrevive al análisis que la propuso.
   * @param {string} userId - Usuario autenticado.
   * @param {string} gapId - Brecha afectada.
   * @param {UpdateWardrobeGap} dto - Nuevo estado.
   * @returns {Promise<WardrobeGap>}
   */
  async updateStatus(userId: string, gapId: string, dto: UpdateWardrobeGap): Promise<WardrobeGap> {
    await this._requireOwned(userId, gapId);
    const updated = await this._prisma.wardrobeGap.update({
      where: { id: gapId },
      include: gapInclude,
      data: { status: dto.status, resolvedAt: dto.status === 'OPEN' ? null : new Date() },
    });
    return WardrobeGapsService.toDto(updated);
  }

  /**
   * Carga los datos del usuario y ejecuta el cálculo de cobertura.
   * @private
   * @param {string} userId - Usuario autenticado.
   * @returns {Promise<{ input: ICoverageInput; result: ICoverageResult }>}
   */
  private async _runCoverage(
    userId: string,
  ): Promise<{ input: ICoverageInput; result: ICoverageResult }> {
    const [garments, profile, catalog, dismissed] = await Promise.all([
      this._garments.list(userId, {}),
      this._profile.get(userId),
      this._garmentTypes.list(),
      this._prisma.wardrobeGap.findMany({
        where: { userId, status: 'DISMISSED' },
        select: { garmentTypeId: true, colorHex: true },
      }),
    ]);

    const input: ICoverageInput = { garments, profile, catalog, dismissed, now: new Date() };
    return { input, result: analyzeCoverage(input) };
  }

  /**
   * Devuelve las brechas ya guardadas si salieron de este mismo clóset.
   * @private
   * @param {string} userId - Usuario autenticado.
   * @param {string} signature - Huella del análisis actual.
   * @returns {Promise<WardrobeGap[] | null>}
   */
  private async _tryReuse(userId: string, signature: string): Promise<WardrobeGap[] | null> {
    const open = await this._findOpen(userId);
    const matches =
      open.length > 0 &&
      open.every(gap => WardrobeGapsService._signatureOf(gap.analysisSnapshot) === signature);
    return matches ? open.map(gap => WardrobeGapsService.toDto(gap)) : null;
  }

  /**
   * Brechas todavía pendientes del usuario, en orden de prioridad.
   * @private
   * @param {string} userId - Usuario autenticado.
   * @returns {Promise<GapRowWithRelations[]>}
   */
  private async _findOpen(userId: string): Promise<GapRowWithRelations[]> {
    return this._prisma.wardrobeGap.findMany({
      where: { userId, status: 'OPEN' },
      include: gapInclude,
      orderBy: { priority: 'asc' },
    });
  }

  /**
   * Huella del análisis: qué se le va a enseñar al modelo. Incluye las versiones
   * porque el mismo clóset con otro cálculo o con otro prompt no es el mismo
   * experimento.
   * @private
   * @param {ICoverageResult} result - Cobertura e hipótesis ya calculadas.
   * @returns {string}
   */
  private static _signature(result: ICoverageResult): string {
    const parts = result.hypotheses.map(
      hypothesis =>
        `${hypothesis.garmentTypeId}:${hypothesis.colorHex}:${hypothesis.unlockedOutfitsEstimate}:${hypothesis.scoreGain}`,
    );
    return createHash('sha256')
      .update(
        [
          coverageVersion,
          gapsPromptVersion,
          String(result.coverage.eligibleCount),
          String(result.coverage.distinctOutfits),
          ...parts,
        ].join('|'),
      )
      .digest('hex')
      .slice(0, signatureLength);
  }

  /**
   * Lee la huella guardada en el snapshot de una brecha.
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
   * Reserva presupuesto para este análisis.
   * @private
   * @param {string} userId - Usuario autenticado.
   * @param {string} signature - Huella del análisis actual.
   * @param {number} hypothesisCount - Prendas candidatas que viajan al modelo.
   * @returns {Promise<AiJob>}
   */
  private async _reserveJob(
    userId: string,
    signature: string,
    hypothesisCount: number,
  ): Promise<AiJob> {
    const baseKey = `${idempotencyPrefix}:${this._llm.promptVersion}:${signature}`;
    const previous = await this._prisma.aiJob.findMany({
      where: { userId, kind: 'GAP_ANALYSIS', idempotencyKey: { startsWith: baseKey } },
      orderBy: { createdAt: 'desc' },
    });
    const [latest] = previous;
    const isRetry = latest?.status === 'FAILED' && this._jobs.canRetry(latest);

    const job = await this._jobs.reserve({
      userId,
      kind: 'GAP_ANALYSIS',
      idempotencyKey: isRetry
        ? latest.idempotencyKey
        : WardrobeGapsService._suffixed(baseKey, previous.length),
      estimatedCostUsd: this._llm.estimateCostUsd(hypothesisCount),
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
   * Añade el número de análisis previos a la clave base.
   * @private
   * @param {string} baseKey - Clave base de la huella.
   * @param {number} previousRuns - Análisis previos de esa misma huella.
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
   * @param {ICoverageResult} result - Cobertura e hipótesis que viajan al modelo.
   * @returns {Promise<IGapsResult>}
   */
  private async _callModel(
    userId: string,
    job: AiJob,
    result: ICoverageResult,
  ): Promise<IGapsResult> {
    const profile = await this._profile.get(userId);
    await this._jobs.markRunning(userId, job.id);
    try {
      return await this._llm.writeGaps({
        profile,
        coverage: result.coverage,
        hypotheses: result.hypotheses,
      });
    } catch (error) {
      return this._fail(userId, job, error);
    }
  }

  /**
   * Cierra el job con su costo real y lo deja registrado en la auditoría.
   * @private
   * @param {string} userId - Usuario autenticado.
   * @param {AiJob} job - Job en curso.
   * @param {IGapsResult} llmResult - Resultado de la llamada al modelo.
   * @returns {Promise<number>}
   */
  private async _settle(userId: string, job: AiJob, llmResult: IGapsResult): Promise<number> {
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
      kind: 'GAP_ANALYSIS',
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
      `WardrobeGapsService > _fail - análisis fallido del usuario ${userId} (${providerError.code})`,
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
      kind: 'GAP_ANALYSIS',
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
   * Guarda la lista nueva reemplazando la pendiente.
   * @private
   * @param {string} userId - Usuario autenticado.
   * @param {readonly IAssembledGap[]} accepted - Brechas que pasaron la validación.
   * @param {IPersistContext} context - Job, huella, cobertura y resultado del modelo.
   * @returns {Promise<WardrobeGap[]>}
   */
  private async _save(
    userId: string,
    accepted: readonly IAssembledGap[],
    context: IPersistContext,
  ): Promise<WardrobeGap[]> {
    if (accepted.length === 0) {
      this._logger.warn(
        `WardrobeGapsService > _save - ninguna brecha del usuario ${userId} pasó la validación`,
      );
      return (await this._findOpen(userId)).map(gap => WardrobeGapsService.toDto(gap));
    }

    const created = await this._prisma.$transaction(async transaction => {
      await transaction.wardrobeGap.deleteMany({ where: { userId, status: 'OPEN' } });
      return Promise.all(
        accepted.map(gap =>
          transaction.wardrobeGap.create({
            data: WardrobeGapsService._toCreateData(userId, gap, context),
            include: gapInclude,
          }),
        ),
      );
    });
    return created.map(gap => WardrobeGapsService.toDto(gap));
  }

  /**
   * Traduce una brecha validada a la fila que se guarda.
   * @private
   * @param {string} userId - Usuario autenticado.
   * @param {IAssembledGap} gap - Brecha ya validada.
   * @param {IPersistContext} context - Job, huella, cobertura y resultado del modelo.
   * @returns {Prisma.WardrobeGapUncheckedCreateInput}
   */
  private static _toCreateData(
    userId: string,
    gap: IAssembledGap,
    context: IPersistContext,
  ): Prisma.WardrobeGapUncheckedCreateInput {
    return {
      userId,
      coverageVersion,
      priority: gap.priority,
      slot: gap.hypothesis.slot,
      garmentTypeId: gap.hypothesis.garmentTypeId,
      colorName: gap.hypothesis.colorName,
      colorHex: gap.hypothesis.colorHex,
      formality: gap.hypothesis.formality,
      description: gap.description,
      reason: gap.reason,
      unlockedOutfitsEstimate: gap.hypothesis.unlockedOutfitsEstimate,
      referenceBrands: gap.referenceBrands,
      promptVersion: context.llmResult.promptVersion,
      modelUsed: context.llmResult.model,
      jobId: context.job.id,
      analysisSnapshot: {
        version: gapSnapshotVersion,
        signature: context.signature,
        coverage: context.coverage,
        hypothesis: gap.hypothesis,
      } as unknown as Prisma.InputJsonValue,
    };
  }

  /**
   * Une la nota del cálculo con lo que dijo el modelo.
   * @private
   * @param {string | null} note - Nota del cálculo determinista.
   * @param {IGapsResult} llmResult - Respuesta del modelo.
   * @param {number} acceptedCount - Brechas que sobrevivieron a la validación.
   * @returns {string | null}
   */
  private static _mergeNote(
    note: string | null,
    llmResult: IGapsResult,
    acceptedCount: number,
  ): string | null {
    if (acceptedCount === 0) {
      return allDiscardedNote;
    }
    return note ?? llmResult.draft.note;
  }

  /**
   * Envuelve la respuesta con los metadatos que la acompañan siempre.
   * @private
   * @param {IRespondParts} parts - Cuerpo de la respuesta.
   * @returns {AnalyzeGapsResponse}
   */
  private _respond(parts: IRespondParts): AnalyzeGapsResponse {
    return {
      coverageVersion,
      gaps: parts.gaps,
      coverage: parts.coverage,
      note: parts.note,
      discarded: parts.discarded ?? [],
      costUsd: parts.costUsd ?? 0,
      reused: parts.reused ?? false,
      promptVersion: this._llm.promptVersion,
      model: this._llm.model,
    };
  }

  /**
   * Devuelve la brecha comprobando que sea del usuario.
   * @private
   * @param {string} userId - Propietario esperado.
   * @param {string} gapId - Brecha buscada.
   * @returns {Promise<void>}
   */
  private async _requireOwned(userId: string, gapId: string): Promise<void> {
    const gap = await this._prisma.wardrobeGap.findFirst({
      where: { id: gapId, userId },
      select: { id: true },
    });
    if (!gap) {
      throw new NotFoundException(gapNotFoundMessage);
    }
  }

  /**
   * Convierte la fila de Prisma en la ficha que consume el cliente.
   * @param {GapRowWithRelations} gap - Fila con su tipo de prenda.
   * @returns {WardrobeGap}
   */
  static toDto(gap: GapRowWithRelations): WardrobeGap {
    const brands = ReferenceBrandsSchema.safeParse(gap.referenceBrands);
    return {
      id: gap.id,
      status: gap.status,
      priority: gap.priority,
      slot: gap.slot,
      garmentTypeId: gap.garmentTypeId,
      garmentTypeName: gap.garmentType.name,
      colorName: gap.colorName,
      colorHex: gap.colorHex,
      formality: gap.formality,
      description: gap.description,
      reason: gap.reason,
      unlockedOutfitsEstimate: gap.unlockedOutfitsEstimate,
      referenceBrands: brands.success ? brands.data : { luxury: [], affordable: [] },
      createdAt: gap.createdAt.toISOString(),
      resolvedAt: gap.resolvedAt?.toISOString() ?? null,
      coverageVersion: gap.coverageVersion,
      promptVersion: gap.promptVersion,
      modelUsed: gap.modelUsed,
    };
  }
}
