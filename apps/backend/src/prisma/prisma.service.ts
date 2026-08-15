import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Cliente Prisma compartido por toda la aplicación. Se conecta al arrancar el
 * módulo y se desconecta al destruirlo; nunca se instancia `PrismaClient` suelto.
 * @class
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly _logger = new Logger(PrismaService.name);

  /**
   * Abre la conexión con PostgreSQL al iniciar el módulo.
   * @returns {Promise<void>}
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this._logger.log('PrismaService > onModuleInit - conectado a PostgreSQL');
    } catch (error) {
      this._logger.error(
        'PrismaService > onModuleInit - no se pudo conectar a PostgreSQL',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * Cierra la conexión al destruir el módulo.
   * @returns {Promise<void>}
   */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
