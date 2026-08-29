import {
  Body,
  Controller,
  Delete,
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
  UpdateGarmentSchema,
  UpdatePurchaseAdviceSchema,
  type AuthenticatedUser,
  type EvaluatePurchaseResponse,
  type Garment,
  type PurchaseAdvice,
  type PurchaseCandidate,
  type PurchaseMeasurement,
  type UpdateGarment,
  type UpdatePurchaseAdvice,
} from '@closetai/shared-types';
import { aiRateLimit } from '../../common/rate-limit.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PurchaseAdviceService } from './purchase-advice.service';

/**
 * La redacción lleva su propio límite, más estrecho que los 100 req/min
 * globales: cada veredicto cuesta dinero. El techo mensual de `AiJobsService`
 * sigue siendo la barrera dura; esto sólo evita llegar a ella por accidente.
 */
const evaluationWindowSeconds = 60;
const evaluationRequestsPerWindow = 6;

const garmentIdText = ':garmentId';

/**
 * "¿Me lo compro?": todo se direcciona por la prenda candidata, que es lo que el
 * usuario tiene delante. El veredicto es único por prenda, así que su id no
 * hace falta para nada.
 */
@Controller('purchase-advice')
export class PurchaseAdviceController {
  /**
   * Inicializa el controlador de evaluación de compras.
   * @constructor
   * @param {PurchaseAdviceService} _advice - Servicio de evaluación de compras.
   */
  constructor(private readonly _advice: PurchaseAdviceService) {}

  /**
   * Lista las prendas que el usuario está pensando comprar, con su veredicto.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @returns {Promise<PurchaseCandidate[]>}
   */
  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<PurchaseCandidate[]> {
    return this._advice.list(user.id);
  }

  /**
   * Mide la candidata contra el clóset. Es determinista y gratis: no llama a
   * ningún proveedor, así que la pantalla puede enseñar los números antes de que
   * el usuario decida pagar la redacción.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {string} garmentId - Candidata a medir.
   * @returns {Promise<PurchaseMeasurement>}
   */
  @Get('measure/:garmentId')
  measure(
    @CurrentUser() user: AuthenticatedUser,
    @Param('garmentId', ParseUUIDPipe) garmentId: string,
  ): Promise<PurchaseMeasurement> {
    return this._advice.measure(user.id, garmentId);
  }

  /**
   * Mide la candidata y paga la redacción del veredicto. Es la única ruta de la
   * Fase 7 que cuesta dinero, de ahí el límite propio.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {string} garmentId - Candidata a evaluar.
   * @returns {Promise<EvaluatePurchaseResponse>}
   */
  @Post(':garmentId/evaluate')
  @HttpCode(HttpStatus.CREATED)
  @aiRateLimit()
  @Throttle({
    default: { limit: evaluationRequestsPerWindow, ttl: seconds(evaluationWindowSeconds) },
  })
  evaluate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('garmentId', ParseUUIDPipe) garmentId: string,
  ): Promise<EvaluatePurchaseResponse> {
    return this._advice.evaluate(user.id, garmentId);
  }

  /**
   * Mete la candidata en el clóset con los atributos que el usuario confirmó.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {string} garmentId - Candidata que pasa a ser suya.
   * @param {UpdateGarment} dto - Atributos finales de la prenda.
   * @returns {Promise<Garment>}
   */
  @Post(':garmentId/purchase')
  @HttpCode(HttpStatus.OK)
  purchase(
    @CurrentUser() user: AuthenticatedUser,
    @Param('garmentId', ParseUUIDPipe) garmentId: string,
    @Body(new ZodValidationPipe(UpdateGarmentSchema)) dto: UpdateGarment,
  ): Promise<Garment> {
    return this._advice.purchase(user.id, garmentId, dto);
  }

  /**
   * Registra que el usuario descarta la candidata o vuelve a dudarla.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {string} garmentId - Candidata afectada.
   * @param {UpdatePurchaseAdvice} dto - Nuevo estado.
   * @returns {Promise<PurchaseAdvice>}
   */
  @Patch(garmentIdText)
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('garmentId', ParseUUIDPipe) garmentId: string,
    @Body(new ZodValidationPipe(UpdatePurchaseAdviceSchema)) dto: UpdatePurchaseAdvice,
  ): Promise<PurchaseAdvice> {
    return this._advice.updateStatus(user.id, garmentId, dto);
  }

  /**
   * Olvida el veredicto de una prenda sin tocar la prenda. Es cómo se saca de
   * esta pantalla algo que ya compraste y que vive en el clóset.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {string} garmentId - Prenda cuyo veredicto se olvida.
   * @returns {Promise<void>}
   */
  @Delete(garmentIdText)
  @HttpCode(HttpStatus.NO_CONTENT)
  forget(
    @CurrentUser() user: AuthenticatedUser,
    @Param('garmentId', ParseUUIDPipe) garmentId: string,
  ): Promise<void> {
    return this._advice.forget(user.id, garmentId);
  }
}
