import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type AiJob } from '@prisma/client';
import type { AiJobKind } from '@closetai/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import type { Env } from '../../config/env.validation';
import { resolveMonthWindow } from './ai-budget.util';

const budgetExceededMessage =
  'Se agotó el presupuesto mensual de IA. Vuelve a intentarlo el mes que viene o súbelo en la configuración.';
const jobNotFoundMessage = 'Job de IA no encontrado';

/** Estados en los que un job todavía tiene reservado su costo estimado. */
const inFlightStatuses = ['QUEUED', 'RUNNING'] as const;

export interface IReserveAiJobInput {
  userId: string;
  kind: AiJobKind;
  /** Clave estable derivada de la entrada: la misma petición no se cobra dos veces. */
  idempotencyKey: string;
  estimatedCostUsd: number;
  model?: string;
}

export interface IAiJobSuccess {
  actualCostUsd: number;
  model?: string;
  providerRequestId?: string;
}

export interface IAiJobFailure {
  errorMessage: string;
  actualCostUsd?: number;
  providerRequestId?: string;
  retryable?: boolean;
}

/**
 * Ciclo de vida de las llamadas a IA: reserva de presupuesto, idempotencia,
 * reintentos acotados y cierre con el costo real.
 * @class
 */
@Injectable()
export class AiJobsService {
  private readonly _logger = new Logger(AiJobsService.name);

  /**
   * Inicializa el servicio de jobs de IA.
   * @constructor
   * @param {PrismaService} _prisma - Cliente de base de datos.
   * @param {ConfigService<Env, true>} _config - Configuración tipada del entorno.
   */
  constructor(
    private readonly _prisma: PrismaService,
    private readonly _config: ConfigService<Env, true>,
  ) {}

  /** Timeout que debe aplicar en cliente de IA al llamar al proveedor. */
  get requestTimeoutMs(): number {
    return this._config.get('AI_REQUEST_TIMEOUT_MS', { infer: true });
  }

  /** Número máximo de intentos por job antes de darlo por fallido. */
  get maxAttempts(): number {
    return this._config.get('AI_JOB_MAX_ATTEMPTS', { infer: true });
  }

  /**
   * Reserva presupuesto y devuelve el job listo para ejecutarse.
   * @param {IReserveAiJobInput} input - Datos de la llamada que se va a ejecutar.
   * @returns {Promise<AiJob>}
   */
  async reserve(input: IReserveAiJobInput): Promise<AiJob> {
    const estimatedCostUsd = new Prisma.Decimal(input.estimatedCostUsd);
    const monthlyBudgetUsd = new Prisma.Decimal(
      this._config.get('AI_MONTHLY_BUDGET_USD', { infer: true }),
    );

    return this._prisma.$transaction(
      async transaction => {
        const existing = await transaction.aiJob.findUnique({
          where: {
            userId_idempotencyKey: {
              userId: input.userId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (existing) {
          return this._resumeExisting(transaction, existing);
        }

        const committedUsd = await AiJobsService._committedUsd(transaction, input.userId);
        if (committedUsd.plus(estimatedCostUsd).greaterThan(monthlyBudgetUsd)) {
          this._logger.warn(
            `AiJobsService > reserve - presupuesto agotado para el usuario ${input.userId} (comprometido ${committedUsd.toFixed(4)} USD de ${monthlyBudgetUsd.toFixed(2)} USD)`,
          );
          throw new HttpException(budgetExceededMessage, HttpStatus.PAYMENT_REQUIRED);
        }

        return transaction.aiJob.create({
          data: {
            userId: input.userId,
            kind: input.kind,
            idempotencyKey: input.idempotencyKey,
            estimatedCostUsd,
            ...(input.model ? { model: input.model } : {}),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * Marca el job como en ejecución y consume un intento.
   * @param {string} userId - Propietario del job.
   * @param {string} jobId - Identificador del job.
   * @returns {Promise<AiJob>}
   */
  async markRunning(userId: string, jobId: string): Promise<AiJob> {
    await this._assertOwnership(userId, jobId);
    return this._prisma.aiJob.update({
      where: { id: jobId },
      data: {
        status: 'RUNNING',
        attempts: { increment: 1 },
        startedAt: new Date(),
        errorMessage: null,
      },
    });
  }

  /**
   * Cierra el job con éxito y registra el costo real.
   * @param {string} userId - Propietario del job.
   * @param {string} jobId - Identificador del job.
   * @param {IAiJobSuccess} result - Costo real y datos del proveedor.
   * @returns {Promise<AiJob>}
   */
  async markSucceeded(userId: string, jobId: string, result: IAiJobSuccess): Promise<AiJob> {
    await this._assertOwnership(userId, jobId);
    return this._prisma.aiJob.update({
      where: { id: jobId },
      data: {
        status: 'SUCCEEDED',
        finishedAt: new Date(),
        actualCostUsd: new Prisma.Decimal(result.actualCostUsd),
        ...(result.model ? { model: result.model } : {}),
        ...(result.providerRequestId ? { providerRequestId: result.providerRequestId } : {}),
      },
    });
  }

  /**
   * Cierra el job como fallido conservando el costo ya incurrido, si lo hubo. Un
   * fallo marcado como no reintentable deja el job sin intentos disponibles.
   * @param {string} userId - Propietario del job.
   * @param {string} jobId - Identificador del job.
   * @param {IAiJobFailure} failure - Motivo del fallo y costo incurrido.
   * @returns {Promise<AiJob>}
   */
  async markFailed(userId: string, jobId: string, failure: IAiJobFailure): Promise<AiJob> {
    await this._assertOwnership(userId, jobId);
    return this._prisma.aiJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        errorMessage: failure.errorMessage,
        ...(failure.retryable === false ? { attempts: this.maxAttempts } : {}),
        ...(failure.actualCostUsd === undefined
          ? {}
          : { actualCostUsd: new Prisma.Decimal(failure.actualCostUsd) }),
        ...(failure.providerRequestId ? { providerRequestId: failure.providerRequestId } : {}),
      },
    });
  }

  /**
   * Indica si un job fallido todavía puede reintentarse.
   * @param {AiJob} job - Job a evaluar.
   * @returns {boolean}
   */
  canRetry(job: AiJob): boolean {
    return job.attempts < this.maxAttempts;
  }

  /**
   * Gasto comprometido este mes por el usuario: estimado de lo que está en vuelo
   * más real de lo que ya terminó.
   * @param {string} userId - Usuario del que se calcula el gasto.
   * @returns {Promise<number>}
   */
  async committedUsdThisMonth(userId: string): Promise<number> {
    const committed = await AiJobsService._committedUsd(this._prisma, userId);
    return committed.toNumber();
  }

  /**
   * Reencola un job existente si falló y quedan intentos; si no, lo devuelve tal cual.
   * @private
   * @param {Prisma.TransactionClient} transaction - Cliente dentro de la transacción.
   * @param {AiJob} existing - Job ya registrado con esa clave de idempotencia.
   * @returns {Promise<AiJob>}
   */
  private async _resumeExisting(
    transaction: Prisma.TransactionClient,
    existing: AiJob,
  ): Promise<AiJob> {
    const isRetryable = existing.status === 'FAILED' && this.canRetry(existing);
    if (!isRetryable) {
      return existing;
    }
    return transaction.aiJob.update({
      where: { id: existing.id },
      data: { status: 'QUEUED', errorMessage: null, finishedAt: null },
    });
  }

  /**
   * Comprueba que el job existe y pertenece al usuario.
   * @private
   * @param {string} userId - Propietario esperado.
   * @param {string} jobId - Identificador del job.
   * @returns {Promise<void>}
   */
  private async _assertOwnership(userId: string, jobId: string): Promise<void> {
    const job = await this._prisma.aiJob.findFirst({
      where: { id: jobId, userId },
      select: { id: true },
    });
    if (!job) {
      throw new NotFoundException(jobNotFoundMessage);
    }
  }

  /**
   * Suma el costo comprometido del mes en curso dentro del cliente dado.
   * @private
   * @param {PrismaService | Prisma.TransactionClient} client - Cliente Prisma o transacción.
   * @param {string} userId - Usuario del que se calcula el gasto.
   * @returns {Promise<Prisma.Decimal>}
   */
  private static async _committedUsd(
    client: PrismaService | Prisma.TransactionClient,
    userId: string,
  ): Promise<Prisma.Decimal> {
    const monthWindow = resolveMonthWindow(new Date());
    const createdInMonth = {
      userId,
      createdAt: { gte: monthWindow.startsAt, lt: monthWindow.endsAt },
    };

    const [inFlight, settled] = await Promise.all([
      client.aiJob.aggregate({
        where: { ...createdInMonth, status: { in: [...inFlightStatuses] } },
        _sum: { estimatedCostUsd: true },
      }),
      client.aiJob.aggregate({
        where: { ...createdInMonth, status: { notIn: [...inFlightStatuses] } },
        _sum: { actualCostUsd: true },
      }),
    ]);

    const reserved = inFlight._sum.estimatedCostUsd ?? new Prisma.Decimal(0);
    const spent = settled._sum.actualCostUsd ?? new Prisma.Decimal(0);
    return reserved.plus(spent);
  }
}
