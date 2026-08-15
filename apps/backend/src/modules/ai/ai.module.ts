import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiJobsService } from './ai-jobs.service';
import { AiUsageService } from './ai-usage.service';
import { OpenAiClient } from './openai.client';

/**
 * Infraestructura común de IA. Visión, estilismo y render pasan por aquí para
 * heredar idempotencia, reintentos acotados, presupuesto y auditoría, y hablan
 * con el proveedor a través de `OpenAiClient` y de nadie más.
 */
@Module({
  controllers: [AiController],
  providers: [AiJobsService, AiUsageService, OpenAiClient],
  exports: [AiJobsService, AiUsageService, OpenAiClient],
})
export class AiModule {}
