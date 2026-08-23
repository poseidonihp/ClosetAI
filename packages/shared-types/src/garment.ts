import { z } from 'zod';
import { HexColorSchema } from './color';
import {
  FitPreferenceEnum,
  GarmentMaterialEnum,
  GarmentOwnershipEnum,
  GarmentPatternEnum,
  GarmentSlotEnum,
  GarmentStatusEnum,
  PatternScaleEnum,
  SeasonEnum,
  TaggingStatusEnum,
  maxFormality,
  minFormality,
} from './enums';
import { GarmentTaggingSchema } from './vision';

/** Se exporta para que el formulario del cliente valide con el mismo límite. */
export const maxGarmentNameLength = 80;
const maxColorNameLength = 40;
const maxBrandLength = 60;
const maxSizeLength = 20;
const minTemperatureC = -30;
const maxTemperatureC = 55;
const seasonCount = 4;

// -- Límites de subida, compartidos para que el cliente rechace antes de subir --

/** Fotos por prenda: original + miniatura por cada una. */
export const maxGarmentPhotos = 8;
const bytesPerMegabyte = 1024 * 1024;
export const maxUploadFileMb = 12;
export const maxUploadFileBytes = maxUploadFileMb * bytesPerMegabyte;
/**
 * Formatos que el servidor sabe normalizar a WebP. El MIME declarado por el
 * cliente sólo filtra en el navegador: el servidor decodifica el binario y
 * rechaza lo que no sea una imagen real.
 *
 * HEIC no está: los binarios de `sharp` no traen libheif. Safari en iOS convierte
 * a JPEG al subir desde un `<input type="file">`, así que la cámara del iPhone
 * funciona igual.
 */
export const acceptedUploadMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const;

/**
 * Una foto de prenda tal como la ve el cliente. En base de datos son dos filas
 * (`ORIGINAL` y `THUMB`) que comparten `sortOrder`; aquí viajan juntas porque el
 * cliente siempre quiere la miniatura para el grid y la original para el visor.
 * Las dos URL apuntan a `GET /api/media`, que exige sesión y comprueba
 * propiedad: no hay carpeta pública.
 */
export const GarmentPhotoSchema = z.object({
  id: z.string().uuid(),
  sortOrder: z.number().int(),
  isPrimary: z.boolean(),
  url: z.string(),
  thumbUrl: z.string(),
  width: z.number().int(),
  height: z.number().int(),
});
export type GarmentPhoto = z.infer<typeof GarmentPhotoSchema>;

export const GarmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slot: GarmentSlotEnum,
  garmentTypeId: z.string().uuid(),
  garmentTypeName: z.string(),
  primaryColorHex: z.string(),
  primaryColorName: z.string(),
  secondaryColorHex: z.string().nullable(),
  pattern: GarmentPatternEnum,
  patternScale: PatternScaleEnum,
  material: GarmentMaterialEnum,
  fit: FitPreferenceEnum,
  formality: z.number().int(),
  seasons: z.array(SeasonEnum),
  weatherMinC: z.number().int().nullable(),
  weatherMaxC: z.number().int().nullable(),
  brand: z.string().nullable(),
  brandGuess: z.string().nullable(),
  size: z.string().nullable(),
  taggingStatus: TaggingStatusEnum,
  status: GarmentStatusEnum,
  ownership: GarmentOwnershipEnum,
  wearCount: z.number().int(),
  lastWornAt: z.string().nullable(),
  createdAt: z.string(),
  photos: z.array(GarmentPhotoSchema),
  /**
   * Estado del etiquetado por visión. Duplica `taggingStatus` a propósito: ese
   * campo existía desde la Fase 1 y sigue siendo el que consulta el motor,
   * mientras que este bloque es lo que necesita la UI para mostrar progreso,
   * costo y qué conviene revisar.
   */
  tagging: GarmentTaggingSchema,
});
export type Garment = z.infer<typeof GarmentSchema>;

/** Respuesta del etiquetado: la prenda ya con el borrador de la IA aplicado. */
export const TagGarmentResponseSchema = z.object({
  garment: GarmentSchema,
  /** True si se reutilizó un resultado guardado en vez de volver a pagar. */
  reused: z.boolean(),
});
export type TagGarmentResponse = z.infer<typeof TagGarmentResponseSchema>;

const garmentFields = z.object({
  name: z.string().min(1, 'Ponle un nombre a la prenda').max(maxGarmentNameLength),
  garmentTypeId: z.string().uuid('Elige un tipo de prenda'),
  slot: GarmentSlotEnum,
  primaryColorHex: HexColorSchema,
  primaryColorName: z.string().min(1, 'Nombra el color').max(maxColorNameLength),
  secondaryColorHex: HexColorSchema.nullable(),
  pattern: GarmentPatternEnum,
  patternScale: PatternScaleEnum,
  material: GarmentMaterialEnum,
  fit: FitPreferenceEnum,
  formality: z.number().int().min(minFormality).max(maxFormality),
  seasons: z.array(SeasonEnum).max(seasonCount),
  weatherMinC: z.number().int().min(minTemperatureC).max(maxTemperatureC).nullable(),
  weatherMaxC: z.number().int().min(minTemperatureC).max(maxTemperatureC).nullable(),
  brand: z.string().max(maxBrandLength).nullable(),
  size: z.string().max(maxSizeLength).nullable(),
  status: GarmentStatusEnum,
});

type GarmentWeatherRange = {
  weatherMinC?: number | null;
  weatherMaxC?: number | null;
};

/**
 * Comprueba que el rango de temperatura sea coherente cuando vienen los dos
 * extremos. Uno solo es válido: "abriga por debajo de 12 °C" es información útil.
 * @param {GarmentWeatherRange} garment - Prenda con su rango de temperatura.
 * @param {z.RefinementCtx} context - Contexto de refinamiento de Zod.
 * @returns {void}
 */
function checkWeatherRange(garment: GarmentWeatherRange, context: z.RefinementCtx): void {
  const { weatherMinC, weatherMaxC } = garment;
  if (
    typeof weatherMinC === 'number' &&
    typeof weatherMaxC === 'number' &&
    weatherMinC > weatherMaxC
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['weatherMaxC'],
      message: 'La temperatura máxima no puede ser menor que la mínima',
    });
  }
}

export const CreateGarmentSchema = garmentFields.superRefine(checkWeatherRange);
export type CreateGarment = z.infer<typeof CreateGarmentSchema>;

/** Actualización parcial: un campo ausente no se toca. */
export const UpdateGarmentSchema = garmentFields.partial().strict().superRefine(checkWeatherRange);
export type UpdateGarment = z.infer<typeof UpdateGarmentSchema>;

/**
 * Filtros del listado. `ownership` se deja **opcional y sin default aquí**: el
 * default vive en `GarmentsService.list`, que es por donde pasan también las
 * llamadas internas que nunca tocan este esquema.
 */
export const GarmentQuerySchema = z.object({
  status: GarmentStatusEnum.optional(),
  slot: GarmentSlotEnum.optional(),
  ownership: GarmentOwnershipEnum.optional(),
});
export type GarmentQuery = z.infer<typeof GarmentQuerySchema>;
