import { Injectable, NotFoundException } from '@nestjs/common';
import type { GarmentType as GarmentTypeRow } from '@prisma/client';
import type { GarmentType } from '@closetai/shared-types';
import { PrismaService } from '../../prisma/prisma.service';

const typeNotFoundMessage = 'Tipo de prenda no encontrado';
const emptyCatalogMessage =
  'El catálogo de tipos de prenda está vacío. Ejecuta: pnpm --filter @closetai/backend db:seed';

/**
 * Catálogo de tipos de prenda. Es **global**, no por usuario: no hay nada que
 * filtrar por `userId` porque no contiene datos personales, sólo vocabulario.
 * @class
 */
@Injectable()
export class GarmentTypesService {
  /**
   * Inicializa el servicio del catálogo.
   * @constructor
   * @param {PrismaService} _prisma - Cliente de base de datos.
   */
  constructor(private readonly _prisma: PrismaService) {}

  /**
   * Devuelve el catálogo completo en el orden en que se sembró.
   * @returns {Promise<GarmentType[]>}
   */
  async list(): Promise<GarmentType[]> {
    const types = await this._prisma.garmentType.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return types.map(GarmentTypesService.toDto);
  }

  /**
   * Devuelve un tipo por id o falla si no existe.
   * @param {string} garmentTypeId - Identificador del tipo.
   * @returns {Promise<GarmentTypeRow>}
   */
  async requireById(garmentTypeId: string): Promise<GarmentTypeRow> {
    const type = await this._prisma.garmentType.findUnique({ where: { id: garmentTypeId } });
    if (!type) {
      throw new NotFoundException(typeNotFoundMessage);
    }
    return type;
  }

  /**
   * Devuelve un tipo por su slug o falla si no existe. Es como llega el tipo
   * desde el modelo de visión: el slug es estable y el UUID no viaja nunca.
   * @param {string} slug - Slug del catálogo.
   * @returns {Promise<GarmentTypeRow>}
   */
  async requireBySlug(slug: string): Promise<GarmentTypeRow> {
    const type = await this._prisma.garmentType.findUnique({ where: { slug } });
    if (!type) {
      throw new NotFoundException(typeNotFoundMessage);
    }
    return type;
  }

  /**
   * Primer tipo del catálogo en el orden sembrado. Sirve de relleno para una
   * prenda que todavía no está etiquetada y necesita cumplir la relación
   * obligatoria; no representa ningún dato real hasta que la visión conteste.
   * @returns {Promise<GarmentTypeRow>}
   */
  async firstByOrder(): Promise<GarmentTypeRow> {
    const type = await this._prisma.garmentType.findFirst({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    if (!type) {
      throw new NotFoundException(emptyCatalogMessage);
    }
    return type;
  }

  /**
   * Convierte la fila de Prisma en el DTO público, sin fechas internas.
   * @param {GarmentTypeRow} type - Fila del catálogo.
   * @returns {GarmentType}
   */
  static toDto(type: GarmentTypeRow): GarmentType {
    return {
      id: type.id,
      slug: type.slug,
      name: type.name,
      slot: type.slot,
      appliesTo: type.appliesTo,
      defaultFormality: type.defaultFormality,
      typicalSeasons: type.typicalSeasons,
      defaultWeatherMinC: type.defaultWeatherMinC,
      defaultWeatherMaxC: type.defaultWeatherMaxC,
      sortOrder: type.sortOrder,
    };
  }
}
