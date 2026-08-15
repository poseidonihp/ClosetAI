import { Controller, Get, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../auth/decorators/public.decorator';

interface IHealthStatus {
  status: 'ok' | 'down';
  latencyMs: number;
}

const serviceName = 'closetai-backend';

@Public()
@Controller('health')
export class HealthController {
  private readonly _logger = new Logger(HealthController.name);

  /**
   * Inicializa el controlador de salud.
   * @constructor
   * @param {PrismaService} _prisma - Cliente de base de datos.
   */
  constructor(private readonly _prisma: PrismaService) {}

  /**
   * Comprueba que el proceso responde.
   * @returns {{ status: string; service: string; timestamp: string }}
   */
  @Get()
  check(): { status: string; service: string; timestamp: string } {
    return {
      status: 'ok',
      service: serviceName,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Comprueba que PostgreSQL responde y mide la latencia.
   * @returns {Promise<IHealthStatus>}
   */
  @Get('db')
  @HttpCode(HttpStatus.OK)
  async checkDb(): Promise<IHealthStatus> {
    const startedAt = Date.now();
    try {
      await this._prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', latencyMs: Date.now() - startedAt };
    } catch (error) {
      this._logger.error(
        'HealthController > checkDb - la base de datos no respondió',
        error instanceof Error ? error.message : String(error),
      );
      return { status: 'down', latencyMs: Date.now() - startedAt };
    }
  }
}
