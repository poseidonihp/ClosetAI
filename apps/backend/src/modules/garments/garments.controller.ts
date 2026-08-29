import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import {
  CreateGarmentDraftSchema,
  CreateGarmentSchema,
  GarmentQuerySchema,
  TagGarmentRequestSchema,
  UpdateGarmentSchema,
  maxUploadFileMb,
  type AuthenticatedUser,
  type CreateGarment,
  type CreateGarmentDraft,
  type Garment,
  type GarmentQuery,
  type TagGarmentRequest,
  type TagGarmentResponse,
  type UpdateGarment,
} from '@closetai/shared-types';
import { aiRateLimit } from '../../common/rate-limit.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GarmentPhotosService } from './garment-photos.service';
import { GarmentTaggingService } from './garment-tagging.service';
import { GarmentsService } from './garments.service';
import { InvalidImageError } from './image-processing';

const missingFileMessage = 'No se recibió ninguna imagen';
const fileTooLargeMessage = `Cada imagen debe pesar menos de ${maxUploadFileMb} MB`;
const garmentIdText = ':garmentId';

/**
 * El etiquetado lleva su propio límite, más estrecho que los 100 req/min
 * globales: cada llamada cuesta dinero y un cliente en bucle vaciaría el
 * presupuesto del mes antes de que nadie se diera cuenta. El techo mensual de
 * `AiJobsService` sigue siendo la barrera dura; esto sólo evita llegar a ella
 * por accidente.
 */
const taggingWindowSeconds = 60;
const taggingRequestsPerWindow = 12;

/** Petición con las utilidades que añade `@fastify/multipart`. */
type MultipartRequest = FastifyRequest & {
  file: () => Promise<MultipartFile | undefined>;
};

@Controller('garments')
export class GarmentsController {
  /**
   * Inicializa el controlador de prendas.
   * @constructor
   * @param {GarmentsService} _garments - Servicio de prendas.
   * @param {GarmentPhotosService} _photos - Servicio de fotos de prenda.
   * @param {GarmentTaggingService} _tagging - Etiquetado por visión.
   */
  constructor(
    private readonly _garments: GarmentsService,
    private readonly _photos: GarmentPhotosService,
    private readonly _tagging: GarmentTaggingService,
  ) {}

  /**
   * Lista el clóset del usuario.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {GarmentQuery} query - Filtros opcionales por estado y slot.
   * @returns {Promise<Garment[]>}
   */
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(GarmentQuerySchema)) query: GarmentQuery,
  ): Promise<Garment[]> {
    return this._garments.list(user.id, query);
  }

  /**
   * Devuelve una prenda del usuario.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {string} garmentId - Identificador de la prenda.
   * @returns {Promise<Garment>}
   */
  @Get(garmentIdText)
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('garmentId', ParseUUIDPipe) garmentId: string,
  ): Promise<Garment> {
    return this._garments.findOne(user.id, garmentId);
  }

  /**
   * Crea una prenda a mano.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {CreateGarment} dto - Atributos de la prenda.
   * @returns {Promise<Garment>}
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateGarmentSchema)) dto: CreateGarment,
  ): Promise<Garment> {
    return this._garments.create(user.id, dto);
  }

  /**
   * Crea el hueco al que colgar la foto que va a etiquetar la IA. Nace en
   * `PENDING`: no es una prenda todavía, es dónde va a caer el borrador.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {CreateGarmentDraft} dto - Nombre provisional si el usuario ya escribió uno.
   * @returns {Promise<Garment>}
   */
  @Post('draft')
  @HttpCode(HttpStatus.CREATED)
  createDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateGarmentDraftSchema)) dto: CreateGarmentDraft,
  ): Promise<Garment> {
    return this._garments.createDraft(user.id, dto);
  }

  /**
   * Actualiza parcialmente una prenda propia.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {string} garmentId - Identificador de la prenda.
   * @param {UpdateGarment} dto - Campos a modificar.
   * @returns {Promise<Garment>}
   */
  @Patch(garmentIdText)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('garmentId', ParseUUIDPipe) garmentId: string,
    @Body(new ZodValidationPipe(UpdateGarmentSchema)) dto: UpdateGarment,
  ): Promise<Garment> {
    return this._garments.update(user.id, garmentId, dto);
  }

  /**
   * Borra una prenda propia y sus fotos.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {string} garmentId - Identificador de la prenda.
   * @returns {Promise<void>}
   */
  @Delete(garmentIdText)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('garmentId', ParseUUIDPipe) garmentId: string,
  ): Promise<void> {
    return this._garments.remove(user.id, garmentId);
  }

  /**
   * Sube **una** foto de la prenda.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {string} garmentId - Identificador de la prenda.
   * @param {MultipartRequest} request - Petición multipart.
   * @returns {Promise<Garment>}
   */
  @Post(':garmentId/photos')
  @HttpCode(HttpStatus.CREATED)
  async addPhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('garmentId', ParseUUIDPipe) garmentId: string,
    @Req() request: MultipartRequest,
  ): Promise<Garment> {
    const file = await request.file();
    if (!file) {
      throw new BadRequestException(missingFileMessage);
    }
    const buffer = await GarmentsController._readFile(file);
    try {
      return await this._photos.add(user.id, garmentId, { buffer, filename: file.filename });
    } catch (error) {
      if (error instanceof InvalidImageError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /**
   * Borra una foto de la prenda.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {string} garmentId - Identificador de la prenda.
   * @param {string} photoId - Identificador de la foto.
   * @returns {Promise<Garment>}
   */
  @Delete(':garmentId/photos/:photoId')
  removePhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('garmentId', ParseUUIDPipe) garmentId: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ): Promise<Garment> {
    return this._photos.remove(user.id, garmentId, photoId);
  }

  /**
   * Marca una foto como principal de la prenda.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {string} garmentId - Identificador de la prenda.
   * @param {string} photoId - Identificador de la foto.
   * @returns {Promise<Garment>}
   */
  @Patch(':garmentId/photos/:photoId/primary')
  setPrimaryPhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('garmentId', ParseUUIDPipe) garmentId: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ): Promise<Garment> {
    return this._photos.setPrimary(user.id, garmentId, photoId);
  }

  /**
   * Etiqueta la prenda con visión: crea el `AiJob(TAGGING)`, llama al modelo y
   * guarda el resultado como borrador. Si ya hay un borrador de la versión
   * vigente lo reaplica sin volver a pagar; `force` es la autorización explícita
   * para pedir uno nuevo y pisar también lo corregido a mano.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {string} garmentId - Identificador de la prenda.
   * @param {TagGarmentRequest} request - Opciones del etiquetado.
   * @returns {Promise<TagGarmentResponse>}
   */
  @Post(':garmentId/tagging')
  @HttpCode(HttpStatus.OK)
  @aiRateLimit()
  @Throttle({
    default: { limit: taggingRequestsPerWindow, ttl: seconds(taggingWindowSeconds) },
  })
  tag(
    @CurrentUser() user: AuthenticatedUser,
    @Param('garmentId', ParseUUIDPipe) garmentId: string,
    @Body(new ZodValidationPipe(TagGarmentRequestSchema)) request: TagGarmentRequest,
  ): Promise<TagGarmentResponse> {
    return this._tagging.tag(user.id, garmentId, request.force);
  }

  /**
   * Guarda las correcciones del usuario sobre el borrador y marca la prenda
   * como `CONFIRMED`, que es cuando el motor empieza a usarla.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {string} garmentId - Identificador de la prenda.
   * @param {UpdateGarment} dto - Atributos finales.
   * @returns {Promise<Garment>}
   */
  @Post(':garmentId/tagging/confirm')
  @HttpCode(HttpStatus.OK)
  confirmTagging(
    @CurrentUser() user: AuthenticatedUser,
    @Param('garmentId', ParseUUIDPipe) garmentId: string,
    @Body(new ZodValidationPipe(UpdateGarmentSchema)) dto: UpdateGarment,
  ): Promise<Garment> {
    return this._tagging.confirm(user.id, garmentId, dto);
  }

  /**
   * Vuelca la parte del multipart a memoria respetando el límite de tamaño.
   * @private
   * @param {MultipartFile} file - Parte de archivo del multipart.
   * @returns {Promise<Buffer>}
   */
  private static async _readFile(file: MultipartFile): Promise<Buffer> {
    try {
      return await file.toBuffer();
    } catch (error) {
      if (file.file.truncated) {
        throw new PayloadTooLargeException(fileTooLargeMessage);
      }
      throw error;
    }
  }
}
