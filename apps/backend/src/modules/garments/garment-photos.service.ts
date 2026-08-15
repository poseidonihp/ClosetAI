import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { GarmentImage as GarmentImageRow } from '@prisma/client';
import { maxGarmentPhotos, type Garment } from '@closetai/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageDriver } from '../../storage/storage.driver';
import { GarmentsService } from './garments.service';
import { processGarmentImage, processedMimeType } from './image-processing';

const photoNotFoundMessage = 'Foto no encontrada';
const tooManyPhotosMessage = `Una prenda admite como máximo ${maxGarmentPhotos} fotos`;
const webpExtension = '.webp';

export interface IUploadedPhoto {
  buffer: Buffer;
  filename: string;
}

/**
 * Fotos de una prenda. Cada foto subida se guarda dos veces —original acotada y
 * miniatura— compartiendo `sortOrder`, y siempre bajo la key
 * `userId/garmentId/<archivo>`, que es lo que permite a `/api/media` comprobar
 * la propiedad sin una consulta extra.
 * @class
 */
@Injectable()
export class GarmentPhotosService {
  private readonly _logger = new Logger(GarmentPhotosService.name);

  /**
   * Inicializa el servicio de fotos de prenda.
   * @constructor
   * @param {PrismaService} _prisma - Cliente de base de datos.
   * @param {StorageDriver} _storage - Driver de almacenamiento.
   * @param {GarmentsService} _garments - Servicio de prendas (propiedad y DTO).
   */
  constructor(
    private readonly _prisma: PrismaService,
    private readonly _storage: StorageDriver,
    private readonly _garments: GarmentsService,
  ) {}

  /**
   * Normaliza una foto y la añade a la prenda. La primera foto que entra queda
   * como principal.
   * @param {string} userId - Usuario autenticado.
   * @param {string} garmentId - Prenda a la que pertenece la foto.
   * @param {IUploadedPhoto} upload - Binario recibido y su nombre original.
   * @returns {Promise<Garment>}
   */
  async add(userId: string, garmentId: string, upload: IUploadedPhoto): Promise<Garment> {
    const garment = await this._garments.requireOwned(userId, garmentId);
    const originals = GarmentPhotosService._originals(garment.images);
    if (originals.length >= maxGarmentPhotos) {
      throw new BadRequestException(tooManyPhotosMessage);
    }

    const processed = await processGarmentImage(upload.buffer);
    const sortOrder =
      originals.reduce((highest, image) => Math.max(highest, image.sortOrder), -1) + 1;
    const isPrimary = originals.length === 0;

    const [storedOriginal, storedThumb] = await Promise.all([
      this._storage.save({
        userId,
        entityId: garmentId,
        filename: `original${webpExtension}`,
        mimeType: processedMimeType,
        buffer: processed.original.buffer,
      }),
      this._storage.save({
        userId,
        entityId: garmentId,
        filename: `thumb${webpExtension}`,
        mimeType: processedMimeType,
        buffer: processed.thumb.buffer,
      }),
    ]);

    try {
      await this._prisma.garmentImage.createMany({
        data: [
          {
            garmentId,
            isPrimary,
            sortOrder,
            kind: 'ORIGINAL',
            storageKey: storedOriginal.key,
            mimeType: processedMimeType,
            width: processed.original.width,
            height: processed.original.height,
            byteSize: processed.original.byteSize,
          },
          {
            garmentId,
            isPrimary,
            sortOrder,
            kind: 'THUMB',
            storageKey: storedThumb.key,
            mimeType: processedMimeType,
            width: processed.thumb.width,
            height: processed.thumb.height,
            byteSize: processed.thumb.byteSize,
          },
        ],
      });
    } catch (error) {
      await this._deleteKeys([storedOriginal.key, storedThumb.key]);
      this._logger.error(
        'GarmentPhotosService > add - no se pudo registrar la foto; binarios descartados',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }

    return this._garments.findOne(userId, garmentId);
  }

  /**
   * Borra una foto (original y miniatura). Si era la principal, promociona la
   * siguiente para que la prenda no se quede sin portada.
   * @param {string} userId - Usuario autenticado.
   * @param {string} garmentId - Prenda a la que pertenece la foto.
   * @param {string} photoId - Id de la fila `ORIGINAL` de la foto.
   * @returns {Promise<Garment>}
   */
  async remove(userId: string, garmentId: string, photoId: string): Promise<Garment> {
    const garment = await this._garments.requireOwned(userId, garmentId);
    const target = GarmentPhotosService._requireOriginal(garment.images, photoId);
    const siblings = garment.images.filter(image => image.sortOrder === target.sortOrder);

    await this._prisma.garmentImage.deleteMany({
      where: { garmentId, sortOrder: target.sortOrder },
    });
    await this._deleteKeys(siblings.map(image => image.storageKey));

    if (target.isPrimary) {
      const next = GarmentPhotosService._originals(garment.images).find(
        image => image.sortOrder !== target.sortOrder,
      );
      if (next) {
        await this._setPrimarySortOrder(garmentId, next.sortOrder);
      }
    }

    return this._garments.findOne(userId, garmentId);
  }

  /**
   * Marca una foto como principal; el resto dejan de serlo.
   * @param {string} userId - Usuario autenticado.
   * @param {string} garmentId - Prenda a la que pertenece la foto.
   * @param {string} photoId - Id de la fila `ORIGINAL` de la foto.
   * @returns {Promise<Garment>}
   */
  async setPrimary(userId: string, garmentId: string, photoId: string): Promise<Garment> {
    const garment = await this._garments.requireOwned(userId, garmentId);
    const target = GarmentPhotosService._requireOriginal(garment.images, photoId);
    await this._setPrimarySortOrder(garmentId, target.sortOrder);
    return this._garments.findOne(userId, garmentId);
  }

  /**
   * Deja como principal la foto de un `sortOrder` concreto, en una transacción
   * para que nunca haya dos principales ni ninguna.
   * @private
   * @param {string} garmentId - Prenda afectada.
   * @param {number} sortOrder - Orden de la foto que pasa a ser principal.
   * @returns {Promise<void>}
   */
  private async _setPrimarySortOrder(garmentId: string, sortOrder: number): Promise<void> {
    await this._prisma.$transaction([
      this._prisma.garmentImage.updateMany({
        where: { garmentId, isPrimary: true },
        data: { isPrimary: false },
      }),
      this._prisma.garmentImage.updateMany({
        where: { garmentId, sortOrder },
        data: { isPrimary: true },
      }),
    ]);
  }

  /**
   * Borra binarios sin dejar que un fallo de disco tumbe la petición: la fila ya
   * no existe, así que el archivo huérfano es un problema menor y registrado.
   * @private
   * @param {string[]} keys - Keys de almacenamiento a borrar.
   * @returns {Promise<void>}
   */
  private async _deleteKeys(keys: string[]): Promise<void> {
    await Promise.all(
      keys.map(async key => {
        try {
          await this._storage.delete(key);
        } catch (error) {
          this._logger.warn(
            `GarmentPhotosService > _deleteKeys - no se pudo borrar ${key}`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }),
    );
  }

  /**
   * Filas `ORIGINAL` de una prenda, ordenadas.
   * @private
   * @param {GarmentImageRow[]} images - Filas de imagen de la prenda.
   * @returns {GarmentImageRow[]}
   */
  private static _originals(images: GarmentImageRow[]): GarmentImageRow[] {
    return images
      .filter(image => image.kind === 'ORIGINAL')
      .sort((first, second) => first.sortOrder - second.sortOrder);
  }

  /**
   * Busca la fila `ORIGINAL` de una foto o falla. Como las filas vienen de una
   * prenda ya comprobada, esto también cierra el acceso a fotos de otro usuario.
   * @private
   * @param {GarmentImageRow[]} images - Filas de imagen de la prenda.
   * @param {string} photoId - Id de la fila `ORIGINAL`.
   * @returns {GarmentImageRow}
   */
  private static _requireOriginal(images: GarmentImageRow[], photoId: string): GarmentImageRow {
    const target = images.find(image => image.id === photoId && image.kind === 'ORIGINAL');
    if (!target) {
      throw new NotFoundException(photoNotFoundMessage);
    }
    return target;
  }
}
