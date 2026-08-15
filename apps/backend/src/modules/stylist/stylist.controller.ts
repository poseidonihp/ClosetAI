import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  GenerateLooksRequestSchema,
  type AuthenticatedUser,
  type GenerateLooksRequest,
  type GenerateLooksResponse,
  type LooksDebugResponse,
} from '@closetai/shared-types';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { StylistService } from './stylist.service';

@Controller('stylist')
export class StylistController {
  /**
   * Inicializa el controlador del estilista.
   * @constructor
   * @param {StylistService} _stylist - Servicio de generación de looks.
   */
  constructor(private readonly _stylist: StylistService) {}

  /**
   * Genera looks deterministas con las prendas del usuario. Es POST y no GET
   * porque la petición es un objeto con estilo, clima y prenda obligatoria, no
   * un identificador; nada se crea en base de datos.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {GenerateLooksRequest} request - Petición de looks.
   * @returns {Promise<GenerateLooksResponse>}
   */
  @Post('looks')
  @HttpCode(HttpStatus.OK)
  generate(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(GenerateLooksRequestSchema)) request: GenerateLooksRequest,
  ): Promise<GenerateLooksResponse> {
    return this._stylist.generate(user.id, request);
  }

  /**
   * Devuelve lo que vio el motor para esa misma petición: prendas elegibles,
   * descartes con su motivo y candidatos puntuados.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {GenerateLooksRequest} request - Petición de looks.
   * @returns {Promise<LooksDebugResponse>}
   */
  @Post('looks/debug')
  @HttpCode(HttpStatus.OK)
  debug(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(GenerateLooksRequestSchema)) request: GenerateLooksRequest,
  ): Promise<LooksDebugResponse> {
    return this._stylist.debug(user.id, request);
  }
}
