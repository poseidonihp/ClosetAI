import { Controller, ForbiddenException, Get, NotFoundException, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { MediaQuerySchema, type AuthenticatedUser, type MediaQuery } from '@closetai/shared-types';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { StorageDriver } from '../../storage/storage.driver';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

// Las imágenes son privadas y personales: se cachean sólo en el navegador del
// dueño y nunca en un intermediario compartido.
const cacheControlHeader = 'private, max-age=3600, no-transform';

@Controller('media')
export class MediaController {
  /**
   * Inicializa el controlador de medios.
   * @constructor
   * @param {StorageDriver} _storage - Driver de almacenamiento configurado.
   */
  constructor(private readonly _storage: StorageDriver) {}

  /**
   * Sirve un archivo privado. La key empieza siempre por el id del propietario,
   * así que la comprobación de propiedad no depende de otra consulta.
   * @param {AuthenticatedUser} user - Usuario autenticado.
   * @param {MediaQuery} query - Key del archivo solicitado.
   * @param {FastifyReply} reply - Respuesta HTTP donde se escribe el binario.
   * @returns {Promise<void>}
   */
  @Get()
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(MediaQuerySchema)) query: MediaQuery,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    if (!query.key.startsWith(`${user.id}/`)) {
      throw new ForbiddenException('El archivo no pertenece a tu usuario');
    }

    const file = await this._storage.read(query.key);
    if (!file) {
      throw new NotFoundException('Archivo no encontrado');
    }

    reply
      .header('Content-Type', file.mimeType)
      .header('Content-Length', file.byteSize)
      .header('Cache-Control', cacheControlHeader)
      .header('Content-Disposition', 'inline')
      .send(file.buffer);
  }
}
