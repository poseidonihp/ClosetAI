import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import type {
  AuthenticatedUser,
  Outfit,
  RenderOutfitResponse,
  RenderQuote,
} from '@closetai/shared-types';
import { aiRateLimit } from '../../../common/rate-limit.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { OutfitRendersService } from './outfit-renders.service';

/**
 * El render lleva el límite más estrecho de la aplicación: es la llamada más cara
 * por petición de todo el proyecto y la única que devuelve una imagen. El techo
 * mensual de `AiJobsService` sigue siendo la barrera dura; esto evita llegar a
 * ella por un cliente en bucle.
 */
const renderWindowSeconds = 60;
const renderRequestsPerWindow = 4;

@Controller('stylist/outfits/:outfitId/render')
export class OutfitRendersController {
  /**
   * Inicializa el controlador de renders del look.
   * @constructor
   * @param {OutfitRendersService} _renders - Servicio de renders.
   */
  constructor(private readonly _renders: OutfitRendersService) {}

  /**
   * Qué costaría el render de este look. Es determinista y no llama a nadie: es
   * lo que permite confirmar el costo antes de gastarlo.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {string} outfitId - Look a renderizar.
   * @returns {Promise<RenderQuote>}
   */
  @Get('quote')
  quote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('outfitId', ParseUUIDPipe) outfitId: string,
  ): Promise<RenderQuote> {
    return this._renders.quote(user.id, outfitId);
  }

  /**
   * Genera el render del look y lo guarda junto a él. Cuesta dinero: sólo se
   * llega aquí tras confirmar el costo que devolvió `quote`.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {string} outfitId - Look a renderizar.
   * @returns {Promise<RenderOutfitResponse>}
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @aiRateLimit()
  @Throttle({
    default: { limit: renderRequestsPerWindow, ttl: seconds(renderWindowSeconds) },
  })
  render(
    @CurrentUser() user: AuthenticatedUser,
    @Param('outfitId', ParseUUIDPipe) outfitId: string,
  ): Promise<RenderOutfitResponse> {
    return this._renders.render(user.id, outfitId);
  }

  /**
   * Borra un render del look. No toca el look ni su historial.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {string} outfitId - Look al que pertenece.
   * @param {string} renderId - Render a borrar.
   * @returns {Promise<Outfit>}
   */
  @Delete(':renderId')
  @HttpCode(HttpStatus.OK)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('outfitId', ParseUUIDPipe) outfitId: string,
    @Param('renderId', ParseUUIDPipe) renderId: string,
  ): Promise<Outfit> {
    return this._renders.remove(user.id, outfitId, renderId);
  }
}
