import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiUsageSummary, AuthenticatedUser } from '@closetai/shared-types';
import type { Env } from '../../config/env.validation';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AiJobsService } from './ai-jobs.service';
import { AiUsageService } from './ai-usage.service';

@Controller('ai')
export class AiController {
  /**
   * Inicializa el controlador de consumo de IA.
   * @constructor
   * @param {AiJobsService} _jobs - Presupuesto comprometido del mes.
   * @param {AiUsageService} _usage - Detalle de auditoría del consumo.
   * @param {ConfigService<Env, true>} _config - Configuración tipada del entorno.
   */
  constructor(
    private readonly _jobs: AiJobsService,
    private readonly _usage: AiUsageService,
    private readonly _config: ConfigService<Env, true>,
  ) {}

  /**
   * Gasto del mes frente al techo configurado, con el detalle de las últimas
   * llamadas. Va scoped por usuario: nadie ve el consumo de otro.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @returns {Promise<AiUsageSummary>}
   */
  @Get('usage')
  async usage(@CurrentUser() user: AuthenticatedUser): Promise<AiUsageSummary> {
    const monthlyBudgetUsd = this._config.get('AI_MONTHLY_BUDGET_USD', { infer: true });
    const [committedUsd, entries] = await Promise.all([
      this._jobs.committedUsdThisMonth(user.id),
      this._usage.entriesThisMonth(user.id),
    ]);
    return {
      monthlyBudgetUsd,
      committedUsd,
      entries,
      remainingUsd: Math.max(0, monthlyBudgetUsd - committedUsd),
    };
  }
}
