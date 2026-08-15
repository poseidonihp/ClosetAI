import { Injectable } from '@nestjs/common';
import { Prisma, type StyleProfile as StyleProfileRow } from '@prisma/client';
import {
  MeasurementsSchema,
  type Measurements,
  type StyleProfile,
  type UpdateStyleProfile,
} from '@closetai/shared-types';
import { PrismaService } from '../../prisma/prisma.service';

/** Fila del perfil con los tipos evitados ya resueltos a sus ids. */
type ProfileRowWithAvoided = StyleProfileRow & { avoidedGarmentTypes: { id: string }[] };

const avoidedGarmentTypesSelect = { avoidedGarmentTypes: { select: { id: true } } } as const;

/**
 * Perfil de estilo del usuario. Cada consulta va filtrada por `userId`; el
 * aislamiento es manual y no hay middleware que lo haga por nosotros.
 * @class
 */
@Injectable()
export class ProfileService {
  /**
   * Inicializa el servicio de perfil.
   * @constructor
   * @param {PrismaService} _prisma - Cliente de base de datos.
   */
  constructor(private readonly _prisma: PrismaService) {}

  /**
   * Devuelve el perfil del usuario, creándolo vacío la primera vez.
   * @param {string} userId - Usuario autenticado.
   * @returns {Promise<StyleProfile>}
   */
  async get(userId: string): Promise<StyleProfile> {
    const profile = await this._prisma.styleProfile.upsert({
      where: { userId },
      create: { userId },
      update: {},
      include: avoidedGarmentTypesSelect,
    });
    return ProfileService._toDto(profile);
  }

  /**
   * Aplica una actualización parcial. Un campo ausente no se toca; un `null`
   * explícito lo borra.
   * @param {string} userId - Usuario autenticado.
   * @param {UpdateStyleProfile} dto - Campos a modificar.
   * @returns {Promise<StyleProfile>}
   */
  async update(userId: string, dto: UpdateStyleProfile): Promise<StyleProfile> {
    const { avoidedGarmentTypeIds, measurements, ...scalars } = dto;
    const data: Prisma.StyleProfileUpdateInput = { ...scalars };

    if (measurements !== undefined) {
      data.measurements =
        measurements === null ? Prisma.DbNull : (measurements as Prisma.InputJsonValue);
    }
    if (avoidedGarmentTypeIds !== undefined) {
      data.avoidedGarmentTypes = { set: avoidedGarmentTypeIds.map(id => ({ id })) };
    }

    await this._prisma.styleProfile.upsert({ where: { userId }, create: { userId }, update: {} });
    const profile = await this._prisma.styleProfile.update({
      where: { userId },
      include: avoidedGarmentTypesSelect,
      data,
    });
    return ProfileService._toDto(profile);
  }

  /**
   * Convierte la fila de Prisma en el DTO que consume el cliente.
   * @private
   * @param {ProfileRowWithAvoided} profile - Fila de la base de datos.
   * @returns {StyleProfile}
   */
  private static _toDto(profile: ProfileRowWithAvoided): StyleProfile {
    return {
      gender: profile.gender,
      heightCm: profile.heightCm,
      weightKg: profile.weightKg,
      bodyShape: profile.bodyShape,
      shoeSize: profile.shoeSize,
      skinTone: profile.skinTone,
      hairColor: profile.hairColor,
      measurements: ProfileService._parseMeasurements(profile.measurements),
      presentationPreferences: profile.presentationPreferences,
      styleArchetypes: profile.styleArchetypes,
      preferredFits: profile.preferredFits,
      avoidedColors: profile.avoidedColors,
      avoidedGarmentTypeIds: profile.avoidedGarmentTypes.map(type => type.id),
      budgetTier: profile.budgetTier,
      country: profile.country,
      currency: profile.currency,
      city: profile.city,
      climate: profile.climate,
      notes: profile.notes,
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  /**
   * Valida el Json de medidas contra el esquema actual.
   * @private
   * @param {Prisma.JsonValue} value - Contenido de la columna `measurements`.
   * @returns {Measurements | null}
   */
  private static _parseMeasurements(value: Prisma.JsonValue): Measurements | null {
    if (value === null || value === undefined) {
      return null;
    }
    const parsed = MeasurementsSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }
}
