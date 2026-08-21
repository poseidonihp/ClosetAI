import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import {
  GenerateOutfitsRequestSchema,
  OutfitFeedbackRequestSchema,
  OutfitQuerySchema,
  type AuthenticatedUser,
  type GenerateOutfitsRequest,
  type GenerateOutfitsResponse,
  type Outfit,
  type OutfitFeedbackRequest,
  type OutfitQuery,
} from '@closetai/shared-types';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OutfitsService } from './outfits.service';

/**
 * El estilismo lleva su propio límite, más estrecho que los 100 req/min globales:
 * cada generación cuesta dinero y un cliente en bucle vaciaría el presupuesto del
 * mes antes de que nadie se diera cuenta. El techo mensual de `AiJobsService` sigue
 * siendo la barrera dura; esto sólo evita llegar a ella por accidente.
 */
const stylingWindowSeconds = 60;
const stylingRequestsPerWindow = 8;

@Controller('stylist/outfits')
export class OutfitsController {
  /**
   * Inicializa el controlador de looks del estilista.
   * @constructor
   * @param {OutfitsService} _outfits - Servicio de looks.
   */
  constructor(private readonly _outfits: OutfitsService) {}

  /**
   * Lista los looks que el usuario ya tiene guardados, del más reciente al más
   * antiguo. Con `favorite=true` devuelve sólo los que marcó como guardados.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {OutfitQuery} query - Filtro del listado.
   * @returns {Promise<Outfit[]>}
   */
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(OutfitQuerySchema)) query: OutfitQuery,
  ): Promise<Outfit[]> {
    return this._outfits.list(user.id, query);
  }

  /**
   * Genera looks con el estilista y los guarda. Es la única ruta de la Fase 4 que
   * cuesta dinero, de ahí el límite propio.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {GenerateOutfitsRequest} request - Estilo, ocasión, clima y restricciones.
   * @returns {Promise<GenerateOutfitsResponse>}
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({
    default: { limit: stylingRequestsPerWindow, ttl: seconds(stylingWindowSeconds) },
  })
  generate(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(GenerateOutfitsRequestSchema)) request: GenerateOutfitsRequest,
  ): Promise<GenerateOutfitsResponse> {
    return this._outfits.generate(user.id, request);
  }

  /**
   * Registra una decisión del usuario sobre un look: favorito, usado, valoración o
   * rechazo con motivo. Es lo que alimenta el bucle de aprendizaje.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {string} outfitId - Look valorado.
   * @param {OutfitFeedbackRequest} feedback - Qué hizo el usuario.
   * @returns {Promise<Outfit>}
   */
  @Post(':outfitId/feedback')
  @HttpCode(HttpStatus.OK)
  addFeedback(
    @CurrentUser() user: AuthenticatedUser,
    @Param('outfitId', ParseUUIDPipe) outfitId: string,
    @Body(new ZodValidationPipe(OutfitFeedbackRequestSchema)) feedback: OutfitFeedbackRequest,
  ): Promise<Outfit> {
    return this._outfits.addFeedback(user.id, outfitId, feedback);
  }

  /**
   * Borra un look guardado. No toca el clóset.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {string} outfitId - Look a borrar.
   * @returns {Promise<void>}
   */
  @Delete(':outfitId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('outfitId', ParseUUIDPipe) outfitId: string,
  ): Promise<void> {
    return this._outfits.remove(user.id, outfitId);
  }
}
