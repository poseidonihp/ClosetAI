import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiJob, Garment as GarmentRow, GarmentImage as GarmentImageRow } from '@prisma/client';
import {
  TaggableFieldEnum,
  VisionAttributesSchema,
  VisionConfidenceReportSchema,
  type CreateGarment,
  type CreateGarmentDraft,
  type Garment,
  type GarmentPhoto,
  type GarmentQuery,
  type GarmentTagging,
  type TaggableField,
  type TaggingStatus,
  type VisionConfidenceReport,
} from '@closetai/shared-types';
import type { Env } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageDriver } from '../../storage/storage.driver';
import { GarmentTypesService } from '../garment-types/garment-types.service';

export const garmentNotFoundMessage = 'Prenda no encontrada';
const draftGarmentName = 'Prenda por etiquetar';
/** Relleno de una prenda todavía sin etiquetar. La UI no lo enseña como dato. */
const draftColorHex = '#808080';
const draftColorName = 'Por determinar';

/** Fila de prenda con lo que hace falta para construir el DTO completo. */
export type GarmentRowWithRelations = GarmentRow & {
  garmentType: { name: string };
  images: GarmentImageRow[];
  taggingJob: AiJob | null;
};

/** Relaciones que `toDto` necesita. Se exporta para que otros servicios que
 * actualizan la prenda devuelvan el mismo DTO sin una consulta extra. */
export const garmentInclude = {
  garmentType: { select: { name: true } },
  images: true,
  taggingJob: true,
} as const;

/**
 * Grupos de atributos que evalúa la visión, mapeados al campo de la prenda que
 * la UI debe marcar para revisión. Un grupo dudoso no invalida nada: sólo pide
 * una mirada antes de confirmar.
 */
const reviewFieldByConfidenceGroup = {
  garmentType: 'garmentTypeId',
  color: 'primaryColorHex',
  pattern: 'pattern',
  material: 'material',
  fit: 'fit',
  formality: 'formality',
  brand: 'brand',
} as const satisfies Record<keyof VisionConfidenceReport, TaggableField>;

/**
 * Prendas del usuario. **Cada consulta filtra por `userId`**: se usa
 * `findFirst({ where: { id, userId } })` y nunca `findUnique({ where: { id } })`,
 * porque un id ajeno debe comportarse igual que un id inexistente.
 * @class
 */
@Injectable()
export class GarmentsService {
  /**
   * Inicializa el servicio de prendas.
   * @constructor
   * @param {PrismaService} _prisma - Cliente de base de datos.
   * @param {StorageDriver} _storage - Driver de almacenamiento de imágenes.
   * @param {GarmentTypesService} _garmentTypes - Catálogo de tipos de prenda.
   * @param {ConfigService<Env, true>} _config - Configuración tipada del entorno.
   */
  constructor(
    private readonly _prisma: PrismaService,
    private readonly _storage: StorageDriver,
    private readonly _garmentTypes: GarmentTypesService,
    private readonly _config: ConfigService<Env, true>,
  ) {}

  /**
   * Lista el clóset del usuario, de lo más reciente a lo más antiguo.
   * @param {string} userId - Usuario autenticado.
   * @param {GarmentQuery} query - Filtros opcionales por estado, slot y propiedad.
   * @returns {Promise<Garment[]>}
   */
  async list(userId: string, query: GarmentQuery): Promise<Garment[]> {
    const garments = await this._prisma.garment.findMany({
      where: {
        userId,
        ownership: query.ownership ?? 'OWNED',
        ...(query.status ? { status: query.status } : {}),
        ...(query.slot ? { slot: query.slot } : {}),
      },
      include: garmentInclude,
      orderBy: { createdAt: 'desc' },
    });
    return garments.map(garment => this.toDto(garment));
  }

  /**
   * Devuelve una prenda del usuario o falla si no existe o no es suya.
   * @param {string} userId - Usuario autenticado.
   * @param {string} garmentId - Identificador de la prenda.
   * @returns {Promise<Garment>}
   */
  async findOne(userId: string, garmentId: string): Promise<Garment> {
    return this.toDto(await this.requireOwned(userId, garmentId));
  }

  /**
   * Crea una prenda a mano. Al no haber IA de por medio, sus atributos ya son
   * los definitivos: nace `CONFIRMED` y el motor de la Fase 2 puede usarla.
   * @param {string} userId - Usuario autenticado.
   * @param {CreateGarment} dto - Atributos de la prenda.
   * @returns {Promise<Garment>}
   */
  async create(userId: string, dto: CreateGarment): Promise<Garment> {
    await this._garmentTypes.requireById(dto.garmentTypeId);
    const garment = await this._prisma.garment.create({
      data: {
        userId,
        taggingStatus: 'CONFIRMED',
        taggedAt: new Date(),
        ...dto,
      },
      include: garmentInclude,
    });
    return this.toDto(garment);
  }

  /**
   * Crea el hueco al que colgarle la foto que va a etiquetar la IA. Con
   * `ownership: 'CONSIDERED'` el hueco es el de la prenda que todavía estás
   * pensando comprar: misma ruta, misma subida y mismo etiquetado.
   * @param {string} userId - Usuario autenticado.
   * @param {CreateGarmentDraft} dto - Nombre provisional y si ya es tuya o no.
   * @returns {Promise<Garment>}
   */
  async createDraft(userId: string, dto: CreateGarmentDraft): Promise<Garment> {
    const placeholder = await this._garmentTypes.firstByOrder();
    const chosenName = dto.name?.trim();
    const garment = await this._prisma.garment.create({
      data: {
        userId,
        ownership: dto.ownership,
        name: chosenName || draftGarmentName,
        slot: placeholder.slot,
        garmentTypeId: placeholder.id,
        primaryColorHex: draftColorHex,
        primaryColorName: draftColorName,
        taggingStatus: 'PENDING',
        // Un nombre que el usuario ya escribió es suyo: la visión propondrá el
        // resto de atributos pero no se lo va a renombrar por encima.
        manualFields: chosenName ? ['name'] : [],
      },
      include: garmentInclude,
    });
    return this.toDto(garment);
  }

  /**
   * Actualiza parcialmente una prenda propia y anota qué atributos quedan
   * marcados como corregidos a mano.
   * @param {string} userId - Usuario autenticado.
   * @param {string} garmentId - Identificador de la prenda.
   * @param {Partial<CreateGarment>} dto - Campos a modificar.
   * @returns {Promise<Garment>}
   */
  async update(userId: string, garmentId: string, dto: Partial<CreateGarment>): Promise<Garment> {
    const current = await this.requireOwned(userId, garmentId);
    if (dto.garmentTypeId) {
      await this._garmentTypes.requireById(dto.garmentTypeId);
    }
    const manualFields = GarmentsService.manualFieldsAfter(current, dto);
    const garment = await this._prisma.garment.update({
      where: { id: garmentId },
      include: garmentInclude,
      data: {
        ...dto,
        manualFields,
        ...GarmentsService._reviewedCandidateStatus(current, manualFields),
      },
    });
    return this.toDto(garment);
  }

  /**
   * Saca de `PENDING` a la candidata cuyos atributos acaba de revisar el usuario.
   * @private
   * @param {GarmentRowWithRelations} current - Prenda tal como está guardada.
   * @param {readonly TaggableField[]} manualFields - Atributos tocados a mano.
   * @returns {{ taggingStatus: TaggingStatus } | Record<string, never>}
   */
  private static _reviewedCandidateStatus(
    current: GarmentRowWithRelations,
    manualFields: readonly TaggableField[],
  ): { taggingStatus: TaggingStatus } | Record<string, never> {
    const isUnreviewedCandidate =
      current.ownership === 'CONSIDERED' && current.taggingStatus === 'PENDING';
    return isUnreviewedCandidate && manualFields.length > 0 ? { taggingStatus: 'SUGGESTED' } : {};
  }

  /**
   * Borra una prenda propia y sus binarios. Las filas de `GarmentImage` caen por
   * cascada; los archivos hay que borrarlos a mano porque viven fuera de la base.
   * @param {string} userId - Usuario autenticado.
   * @param {string} garmentId - Identificador de la prenda.
   * @returns {Promise<void>}
   */
  async remove(userId: string, garmentId: string): Promise<void> {
    const garment = await this.requireOwned(userId, garmentId);
    await this._prisma.garment.delete({ where: { id: garmentId } });
    await Promise.all(garment.images.map(image => this._storage.delete(image.storageKey)));
  }

  /**
   * Devuelve la prenda con sus relaciones comprobando que sea del usuario.
   * @param {string} userId - Usuario autenticado.
   * @param {string} garmentId - Identificador de la prenda.
   * @returns {Promise<GarmentRowWithRelations>}
   */
  async requireOwned(userId: string, garmentId: string): Promise<GarmentRowWithRelations> {
    const garment = await this._prisma.garment.findFirst({
      where: { id: garmentId, userId },
      include: garmentInclude,
    });
    if (!garment) {
      throw new NotFoundException(garmentNotFoundMessage);
    }
    return garment;
  }

  /**
   * Une los atributos ya marcados como manuales con los que **cambian de valor**
   * en esta actualización.
   * @param {GarmentRowWithRelations} current - Prenda tal como está guardada.
   * @param {Partial<CreateGarment>} dto - Campos que llegan en la actualización.
   * @returns {TaggableField[]}
   */
  static manualFieldsAfter(
    current: GarmentRowWithRelations,
    dto: Partial<CreateGarment>,
  ): TaggableField[] {
    const manual = new Set(GarmentsService.toTaggableFields(current.manualFields));
    for (const field of TaggableFieldEnum.options) {
      if (field in dto && !GarmentsService._sameValue(current[field], dto[field])) {
        manual.add(field);
      }
    }
    return [...manual];
  }

  /**
   * Convierte la fila de Prisma en el DTO que consume el cliente.
   * @param {GarmentRowWithRelations} garment - Fila con tipo, imágenes y job.
   * @returns {Garment}
   */
  toDto(garment: GarmentRowWithRelations): Garment {
    return {
      id: garment.id,
      name: garment.name,
      slot: garment.slot,
      garmentTypeId: garment.garmentTypeId,
      garmentTypeName: garment.garmentType.name,
      primaryColorHex: garment.primaryColorHex,
      primaryColorName: garment.primaryColorName,
      secondaryColorHex: garment.secondaryColorHex,
      pattern: garment.pattern,
      patternScale: garment.patternScale,
      material: garment.material,
      fit: garment.fit,
      formality: garment.formality,
      seasons: garment.seasons,
      weatherMinC: garment.weatherMinC,
      weatherMaxC: garment.weatherMaxC,
      brand: garment.brand,
      brandGuess: garment.brandGuess,
      size: garment.size,
      taggingStatus: garment.taggingStatus,
      status: garment.status,
      ownership: garment.ownership,
      wearCount: garment.wearCount,
      lastWornAt: garment.lastWornAt?.toISOString() ?? null,
      createdAt: garment.createdAt.toISOString(),
      photos: this._toPhotos(garment.images),
      tagging: this._toTagging(garment),
    };
  }

  /**
   * Construye el bloque de etiquetado: estado, costo, reintento y qué revisar.
   * @private
   * @param {GarmentRowWithRelations} garment - Fila con su job de visión.
   * @returns {GarmentTagging}
   */
  private _toTagging(garment: GarmentRowWithRelations): GarmentTagging {
    const attributes = VisionAttributesSchema.safeParse(garment.aiAttributes);
    return {
      ...this._toJobSummary(garment.taggingJob),
      status: garment.taggingStatus,
      version: garment.taggingVersion,
      taggedAt: garment.taggedAt?.toISOString() ?? null,
      manualFields: GarmentsService.toTaggableFields(garment.manualFields),
      reviewFields: GarmentsService._toReviewFields(garment.attributeConfidence),
      personVisible: attributes.success && attributes.data.personVisible,
      // Sin respuesta guardada no hay negativa que contar: una prenda que nunca
      // pasó por la IA no es "no catalogable", es que no se ha intentado.
      usableForTagging: !attributes.success || attributes.data.usableForTagging,
      unusableReason: attributes.success ? attributes.data.unusableReason : null,
      notes: attributes.success ? attributes.data.notes : null,
    };
  }

  /**
   * Resume el último job de visión de la prenda.
   * @private
   * @param {AiJob | null} job - Último job de etiquetado, si lo hay.
   * @returns {Pick<GarmentTagging, 'model' | 'jobStatus' | 'attempts' | 'canRetry' | 'costUsd' | 'errorMessage'>}
   */
  private _toJobSummary(
    job: AiJob | null,
  ): Pick<
    GarmentTagging,
    'model' | 'jobStatus' | 'attempts' | 'canRetry' | 'costUsd' | 'errorMessage'
  > {
    if (!job) {
      return {
        model: null,
        jobStatus: null,
        attempts: 0,
        canRetry: true,
        costUsd: null,
        errorMessage: null,
      };
    }
    const maxAttempts = this._config.get('AI_JOB_MAX_ATTEMPTS', { infer: true });
    return {
      model: job.model,
      jobStatus: job.status,
      attempts: job.attempts,
      canRetry: job.status !== 'SUCCEEDED' && job.attempts < maxAttempts,
      costUsd: job.actualCostUsd?.toNumber() ?? null,
      errorMessage: job.errorMessage,
    };
  }

  /**
   * Traduce la autoevaluación guardada en los campos que conviene revisar.
   * Cualquier cosa que no sea `HIGH` entra: es una sugerencia de revisión, no
   * una probabilidad, y errar por exceso aquí no cuesta nada.
   * @private
   * @param {unknown} attributeConfidence - Json guardado en la prenda.
   * @returns {TaggableField[]}
   */
  private static _toReviewFields(attributeConfidence: unknown): TaggableField[] {
    const parsed = VisionConfidenceReportSchema.safeParse(attributeConfidence);
    if (!parsed.success) {
      return [];
    }
    return Object.entries(parsed.data)
      .filter(([, confidence]) => confidence !== 'HIGH')
      .map(([group]) => reviewFieldByConfidenceGroup[group as keyof VisionConfidenceReport]);
  }

  /**
   * Filtra los nombres guardados que sigan siendo atributos válidos. Una columna
   * de texto libre puede arrastrar un nombre de una versión anterior.
   * @param {string[]} fields - Nombres guardados en la prenda.
   * @returns {TaggableField[]}
   */
  static toTaggableFields(fields: readonly string[]): TaggableField[] {
    return fields.filter(
      (field): field is TaggableField => TaggableFieldEnum.safeParse(field).success,
    );
  }

  /**
   * Compara dos valores de atributo tratando los arrays por contenido.
   * @private
   * @param {unknown} current - Valor guardado.
   * @param {unknown} next - Valor entrante.
   * @returns {boolean}
   */
  private static _sameValue(current: unknown, next: unknown): boolean {
    if (Array.isArray(current) && Array.isArray(next)) {
      return current.length === next.length && current.every((item, index) => item === next[index]);
    }
    return current === next;
  }

  /**
   * Agrupa las filas `ORIGINAL` y `THUMB` que comparten `sortOrder` en una única
   * foto con sus dos URL. Si faltara la miniatura, la original hace de reemplazo
   * para no dejar el grid con huecos.
   * @private
   * @param {GarmentImageRow[]} images - Filas de imagen de la prenda.
   * @returns {GarmentPhoto[]}
   */
  private _toPhotos(images: GarmentImageRow[]): GarmentPhoto[] {
    const thumbsBySortOrder = new Map(
      images.filter(image => image.kind === 'THUMB').map(image => [image.sortOrder, image]),
    );
    return images
      .filter(image => image.kind === 'ORIGINAL')
      .sort((first, second) => first.sortOrder - second.sortOrder)
      .map(original => ({
        id: original.id,
        sortOrder: original.sortOrder,
        isPrimary: original.isPrimary,
        url: this._storage.urlFor(original.storageKey),
        thumbUrl: this._storage.urlFor(
          (thumbsBySortOrder.get(original.sortOrder) ?? original).storageKey,
        ),
        width: original.width,
        height: original.height,
      }));
  }
}
