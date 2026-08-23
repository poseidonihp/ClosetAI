import { z } from 'zod';
import { HexColorSchema } from './color';
import {
  AiJobStatusEnum,
  FitPreferenceEnum,
  GarmentMaterialEnum,
  GarmentOwnershipEnum,
  GarmentPatternEnum,
  GarmentSlotEnum,
  PatternScaleEnum,
  SeasonEnum,
  TaggableFieldEnum,
  TaggingStatusEnum,
  VisionConfidenceEnum,
  maxFormality,
  minFormality,
} from './enums';

/**
 * Contrato del etiquetado por visión (Fase 3).
 */
export const visionTaggingVersion = 'vision-v4';

/**
 * Fotos que se le mandan al modelo por prenda, empezando por la portada.
 *
 * Es un tope y no una variable de entorno a propósito: el cliente necesita el
 * mismo número para decir cuántas fotos va a analizar antes de que pulses, y una
 * variable que sólo conoce el servidor obligaría a inventarse ese texto. Varias
 * fotos ayudan de verdad —la etiqueta de composición da el material, un plano de
 * detalle da el tejido— pero sin tope el costo de etiquetar dependería de cuántas
 * fotos te apeteciera subir.
 */
export const maxVisionImages = 4;

const maxVisionTextLength = 300;
const maxBrandGuessLength = 60;
const minVisionTemperatureC = -30;
const maxVisionTemperatureC = 55;
const seasonCount = 4;

/**
 * Cómo de seguro dice estar el modelo de cada grupo de atributos. Se guarda en
 * `Garment.attributeConfidence` y la UI sólo lo usa para señalar qué revisar.
 */
export const VisionConfidenceReportSchema = z.object({
  garmentType: VisionConfidenceEnum,
  color: VisionConfidenceEnum,
  pattern: VisionConfidenceEnum,
  material: VisionConfidenceEnum,
  fit: VisionConfidenceEnum,
  formality: VisionConfidenceEnum,
  brand: VisionConfidenceEnum,
});
export type VisionConfidenceReport = z.infer<typeof VisionConfidenceReportSchema>;

/**
 * Salida del modelo de visión, tal cual sale del proveedor y antes de mapearla
 * a la prenda. `garmentTypeSlug` viaja como slug y no como UUID: el catálogo es
 * el mismo para todos y así el esquema del proveedor puede declarar el enum sin
 * filtrar identificadores internos.
 */
export const VisionAttributesSchema = z.object({
  garmentTypeSlug: z.string().min(1),
  slot: GarmentSlotEnum,
  suggestedName: z.string().min(1).max(maxVisionTextLength),
  primaryColorHex: HexColorSchema,
  primaryColorName: z.string().min(1).max(maxVisionTextLength),
  secondaryColorHex: HexColorSchema.nullable(),
  pattern: GarmentPatternEnum,
  patternScale: PatternScaleEnum,
  material: GarmentMaterialEnum,
  fit: FitPreferenceEnum,
  formality: z.number().int().min(minFormality).max(maxFormality),
  seasons: z.array(SeasonEnum).max(seasonCount),
  weatherMinC: z.number().int().min(minVisionTemperatureC).max(maxVisionTemperatureC).nullable(),
  weatherMaxC: z.number().int().min(minVisionTemperatureC).max(maxVisionTemperatureC).nullable(),
  brandGuess: z.string().max(maxBrandGuessLength).nullable(),
  confidence: VisionConfidenceReportSchema,
  personVisible: z.boolean(),
  usableForTagging: z.boolean().default(true),
  unusableReason: z.string().max(maxVisionTextLength).nullable().default(null),
  notes: z.string().max(maxVisionTextLength).nullable(),
});
export type VisionAttributes = z.infer<typeof VisionAttributesSchema>;

/**
 * Estado del etiquetado de una prenda tal como lo ve el cliente: en qué punto
 * está, qué costó, si se puede reintentar y qué conviene revisar.
 */
export const GarmentTaggingSchema = z.object({
  status: TaggingStatusEnum,
  /** Versión del prompt/esquema con la que se etiquetó, si ya se etiquetó. */
  version: z.string().nullable(),
  taggedAt: z.string().nullable(),
  model: z.string().nullable(),
  /** Estado del último job de visión; null si la prenda nunca pasó por la IA. */
  jobStatus: AiJobStatusEnum.nullable(),
  attempts: z.number().int(),
  canRetry: z.boolean(),
  /** Costo real de ese job en USD. Null mientras no haya terminado. */
  costUsd: z.number().nullable(),
  errorMessage: z.string().nullable(),
  /** Atributos que el usuario tocó a mano: un reetiquetado no los pisa. */
  manualFields: z.array(TaggableFieldEnum),
  /** Atributos que el modelo declaró dudosos. Sugerencia de revisión, no un número. */
  reviewFields: z.array(TaggableFieldEnum),
  /** True si la foto incluye a una persona. Sólo dispara un aviso de privacidad. */
  personVisible: z.boolean(),
  /**
   * False cuando de las fotos no se puede catalogar una prenda. Entonces no hay
   * borrador que revisar: la prenda se queda sin rellenar y hace falta cambiar
   * las fotos o completarla a mano.
   */
  usableForTagging: z.boolean(),
  /** Por qué las fotos no sirven, en español. Null si sí sirven. */
  unusableReason: z.string().nullable(),
  /** Comentario corto del modelo sobre la prenda. Nunca sobre quien la lleva. */
  notes: z.string().nullable(),
});
export type GarmentTagging = z.infer<typeof GarmentTaggingSchema>;

/**
 * Alta de una prenda vacía que existe sólo para colgarle la foto y etiquetarla.
 * `ownership` distingue el borrador del clóset del de la Fase 7: la candidata que
 * todavía estás pensando comprar usa esta misma ruta y no una propia.
 */
export const CreateGarmentDraftSchema = z.object({
  name: z.string().max(maxVisionTextLength).nullable().default(null),
  ownership: GarmentOwnershipEnum.default('OWNED'),
});
export type CreateGarmentDraft = z.infer<typeof CreateGarmentDraftSchema>;

/**
 * Petición de etiquetado. `force` es la autorización explícita para volver a
 * llamar al proveedor y pisar también los atributos editados a mano; sin ella
 * un reetiquetado reutiliza el resultado guardado y respeta las correcciones.
 */
export const TagGarmentRequestSchema = z.object({
  force: z.boolean().default(false),
});
export type TagGarmentRequest = z.infer<typeof TagGarmentRequestSchema>;

/**
 * La respuesta de etiquetado (`TagGarmentResponseSchema`) vive en `garment.ts`:
 * devuelve la prenda completa, y es ese archivo el que importa de aquí y no al
 * revés.
 */

/** Una línea del registro de consumo, para la vista de costo. */
export const AiUsageEntrySchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  model: z.string(),
  status: AiJobStatusEnum,
  costUsd: z.number(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  imageCount: z.number().int(),
  latencyMs: z.number().int(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
});
export type AiUsageEntry = z.infer<typeof AiUsageEntrySchema>;

/**
 * Gasto del mes en curso frente al techo configurado. `committedUsd` sale de
 * `AiJob` —estimado en vuelo más real terminado—, que es lo que de verdad corta
 * la reserva; las `entries` son el detalle de auditoría de `AiUsageLog`.
 */
export const AiUsageSummarySchema = z.object({
  monthlyBudgetUsd: z.number(),
  committedUsd: z.number(),
  remainingUsd: z.number(),
  entries: z.array(AiUsageEntrySchema),
});
export type AiUsageSummary = z.infer<typeof AiUsageSummarySchema>;
