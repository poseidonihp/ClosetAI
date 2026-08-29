import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import {
  UpdateWardrobeGapSchema,
  type AnalyzeGapsResponse,
  type AuthenticatedUser,
  type CoverageResponse,
  type UpdateWardrobeGap,
  type WardrobeGap,
} from '@closetai/shared-types';
import { aiRateLimit } from '../../common/rate-limit.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { WardrobeGapsService } from './wardrobe-gaps.service';

/**
 * El análisis lleva su propio límite, más estrecho que los 100 req/min globales:
 * cada pasada cuesta dinero. El techo mensual de `AiJobsService` sigue siendo la
 * barrera dura; esto sólo evita llegar a ella por accidente.
 */
const analysisWindowSeconds = 60;
const analysisRequestsPerWindow = 4;

@Controller('wardrobe-gaps')
export class WardrobeGapsController {
  /**
   * Inicializa el controlador de vacíos del clóset.
   * @constructor
   * @param {WardrobeGapsService} _gaps - Servicio de vacíos del clóset.
   */
  constructor(private readonly _gaps: WardrobeGapsService) {}

  /**
   * Lista las brechas guardadas del usuario.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @returns {Promise<WardrobeGap[]>}
   */
  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<WardrobeGap[]> {
    return this._gaps.list(user.id);
  }

  /**
   * Devuelve la cobertura del clóset y las prendas candidatas. Es determinista y
   * gratis: no llama a ningún proveedor.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @returns {Promise<CoverageResponse>}
   */
  @Get('coverage')
  coverage(@CurrentUser() user: AuthenticatedUser): Promise<CoverageResponse> {
    return this._gaps.coverage(user.id);
  }

  /**
   * Analiza el clóset y guarda las brechas priorizadas. Es la única ruta de la
   * Fase 5 que cuesta dinero, de ahí el límite propio.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @returns {Promise<AnalyzeGapsResponse>}
   */
  @Post('analyze')
  @HttpCode(HttpStatus.CREATED)
  @aiRateLimit()
  @Throttle({
    default: { limit: analysisRequestsPerWindow, ttl: seconds(analysisWindowSeconds) },
  })
  analyze(@CurrentUser() user: AuthenticatedUser): Promise<AnalyzeGapsResponse> {
    return this._gaps.analyze(user.id);
  }

  /**
   * Registra lo que el usuario decidió sobre una brecha: la compró, no le interesa
   * o vuelve a estar pendiente.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {string} gapId - Brecha afectada.
   * @param {UpdateWardrobeGap} dto - Nuevo estado.
   * @returns {Promise<WardrobeGap>}
   */
  @Patch(':gapId')
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('gapId', ParseUUIDPipe) gapId: string,
    @Body(new ZodValidationPipe(UpdateWardrobeGapSchema)) dto: UpdateWardrobeGap,
  ): Promise<WardrobeGap> {
    return this._gaps.updateStatus(user.id, gapId, dto);
  }
}
