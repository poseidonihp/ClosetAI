import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type AiUsageLog } from '@prisma/client';
import type { AiJobKind, AiJobStatus, AiUsageEntry } from '@closetai/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveMonthWindow } from './ai-budget.util';

/** Líneas de consumo que se devuelven en el resumen. Es una vista, no un export. */
const usageEntriesLimit = 20;

export interface ILogAiUsageInput {
  userId: string;
  jobId?: string;
  kind: AiJobKind;
  model: string;
  status: AiJobStatus;
  costUsd: number;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  imageCount?: number;
  providerRequestId?: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Registro de auditoría de cada llamada al proveedor de IA: modelo, tokens,
 * latencia y costo tal como los devolvió la API. No alimenta el presupuesto —
 * de eso se encarga `AiJobsService` sobre `AiJob` — sino la trazabilidad.
 * @class
 */
@Injectable()
export class AiUsageService {
  private readonly _logger = new Logger(AiUsageService.name);

  /**
   * Inicializa el servicio de consumo de IA.
   * @constructor
   * @param {PrismaService} _prisma - Cliente de base de datos.
   */
  constructor(private readonly _prisma: PrismaService) {}

  /**
   * Guarda una línea de consumo. Nunca lanza: perder el registro no debe tumbar
   * la operación de negocio que ya se ejecutó y se pagó.
   * @param {ILogAiUsageInput} input - Datos de consumo devueltos por el proveedor.
   * @returns {Promise<void>}
   */
  async log(input: ILogAiUsageInput): Promise<void> {
    try {
      await this._prisma.aiUsageLog.create({
        data: {
          userId: input.userId,
          kind: input.kind,
          model: input.model,
          status: input.status,
          costUsd: new Prisma.Decimal(input.costUsd),
          latencyMs: input.latencyMs,
          inputTokens: input.inputTokens ?? 0,
          outputTokens: input.outputTokens ?? 0,
          imageCount: input.imageCount ?? 0,
          ...(input.jobId ? { jobId: input.jobId } : {}),
          ...(input.cachedInputTokens === undefined
            ? {}
            : { cachedInputTokens: input.cachedInputTokens }),
          ...(input.providerRequestId ? { providerRequestId: input.providerRequestId } : {}),
          ...(input.errorCode ? { errorCode: input.errorCode } : {}),
          ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
        },
      });
    } catch (error) {
      this._logger.error(
        'AiUsageService > log - no se pudo registrar el consumo de IA',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Últimas llamadas del mes en curso del usuario, de la más reciente a la más
   * antigua. Es el detalle que la UI enseña junto al gasto.
   * @param {string} userId - Usuario autenticado.
   * @returns {Promise<AiUsageEntry[]>}
   */
  async entriesThisMonth(userId: string): Promise<AiUsageEntry[]> {
    const monthWindow = resolveMonthWindow(new Date());
    const entries = await this._prisma.aiUsageLog.findMany({
      where: { userId, createdAt: { gte: monthWindow.startsAt, lt: monthWindow.endsAt } },
      orderBy: { createdAt: 'desc' },
      take: usageEntriesLimit,
    });
    return entries.map(AiUsageService._toDto);
  }

  /**
   * Convierte la fila de auditoría en el DTO que consume el cliente.
   * @private
   * @param {AiUsageLog} entry - Fila de consumo.
   * @returns {AiUsageEntry}
   */
  private static _toDto(entry: AiUsageLog): AiUsageEntry {
    return {
      id: entry.id,
      kind: entry.kind,
      model: entry.model,
      status: entry.status,
      costUsd: entry.costUsd.toNumber(),
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      imageCount: entry.imageCount,
      latencyMs: entry.latencyMs,
      errorMessage: entry.errorMessage,
      createdAt: entry.createdAt.toISOString(),
    };
  }
}
