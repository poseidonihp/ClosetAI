import { z } from 'zod';

/**
 * Vocabulario compartido. Los valores viajan y se almacenan en inglés; el español
 * es sólo presentación y vive en `enumLabels`, nunca hardcodeado en un componente.
 *
 * Cada enum refleja uno de Prisma: si se añade un valor allí, se añade aquí y en
 * su tabla de etiquetas — `satisfies Record<T, string>` hace que falte una
 * etiqueta rompa la compilación, no la interfaz en caliente.
 */

// =====================================================================
// IA
// =====================================================================

export const AiJobKindEnum = z.enum(['TAGGING', 'STYLING', 'GAP_ANALYSIS', 'RENDER']);
export type AiJobKind = z.infer<typeof AiJobKindEnum>;

export const AiJobStatusEnum = z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']);
export type AiJobStatus = z.infer<typeof AiJobStatusEnum>;

// =====================================================================
// Perfil
// =====================================================================

export const GenderEnum = z.enum(['MALE', 'FEMALE', 'NON_BINARY', 'UNSPECIFIED']);
export type Gender = z.infer<typeof GenderEnum>;

export const PresentationPreferenceEnum = z.enum([
  'MASCULINE',
  'FEMININE',
  'ANDROGYNOUS',
  'NEUTRAL',
]);
export type PresentationPreference = z.infer<typeof PresentationPreferenceEnum>;

export const BodyShapeEnum = z.enum([
  'RECTANGLE',
  'TRIANGLE',
  'INVERTED_TRIANGLE',
  'HOURGLASS',
  'OVAL',
]);
export type BodyShape = z.infer<typeof BodyShapeEnum>;

/** Mismo vocabulario para la preferencia del usuario y el corte de una prenda. */
export const FitPreferenceEnum = z.enum(['RELAXED', 'REGULAR', 'SLIM', 'OVERSIZED']);
export type FitPreference = z.infer<typeof FitPreferenceEnum>;

export const StyleArchetypeEnum = z.enum([
  'MINIMALIST',
  'SMART_CASUAL',
  'CLASSIC',
  'STREETWEAR',
  'BOHO',
  'ROMANTIC',
  'ANDROGYNOUS',
  'SPORTY',
]);
export type StyleArchetype = z.infer<typeof StyleArchetypeEnum>;

export const BudgetTierEnum = z.enum(['BUDGET', 'MID', 'PREMIUM', 'LUXURY']);
export type BudgetTier = z.infer<typeof BudgetTierEnum>;

export const ClimateEnum = z.enum(['HOT', 'WARM', 'TEMPERATE', 'COOL', 'COLD', 'VARIABLE']);
export type Climate = z.infer<typeof ClimateEnum>;

/**
 * Temperatura representativa de cada clima, en °C. Sirve para comparar un clima
 * con el rango de una prenda sin pedirle al usuario que teclee grados.
 * `VARIABLE` no tiene referencia: por definición no acota nada.
 */
export const climateReferenceTempC = {
  HOT: 30,
  WARM: 25,
  TEMPERATE: 19,
  COOL: 13,
  COLD: 6,
  VARIABLE: null,
} as const satisfies Record<Climate, number | null>;

// =====================================================================
// Prendas
// =====================================================================

export const GarmentSlotEnum = z.enum([
  'TOP',
  'MID_LAYER',
  'OUTERWEAR',
  'BOTTOM',
  'FULL_BODY',
  'FOOTWEAR',
  'ACCESSORY',
]);
export type GarmentSlot = z.infer<typeof GarmentSlotEnum>;

export const AppliesToEnum = z.enum(['MALE', 'FEMALE', 'BOTH']);
export type AppliesTo = z.infer<typeof AppliesToEnum>;

export const SeasonEnum = z.enum(['SPRING', 'SUMMER', 'AUTUMN', 'WINTER']);
export type Season = z.infer<typeof SeasonEnum>;

export const GarmentPatternEnum = z.enum([
  'SOLID',
  'STRIPED',
  'CHECKED',
  'FLORAL',
  'GRAPHIC',
  'ANIMAL',
  'GEOMETRIC',
  'OTHER',
]);
export type GarmentPattern = z.infer<typeof GarmentPatternEnum>;

export const PatternScaleEnum = z.enum(['NONE', 'SMALL', 'MEDIUM', 'LARGE']);
export type PatternScale = z.infer<typeof PatternScaleEnum>;

export const GarmentMaterialEnum = z.enum([
  'COTTON',
  'DENIM',
  'WOOL',
  'LINEN',
  'LEATHER',
  'SYNTHETIC',
  'SILK',
  'KNIT',
  'BLEND',
  'OTHER',
]);
export type GarmentMaterial = z.infer<typeof GarmentMaterialEnum>;

export const GarmentStatusEnum = z.enum(['ACTIVE', 'LAUNDRY', 'STORED', 'DONATED', 'ARCHIVED']);
export type GarmentStatus = z.infer<typeof GarmentStatusEnum>;

export const TaggingStatusEnum = z.enum(['PENDING', 'SUGGESTED', 'CONFIRMED', 'FAILED']);
export type TaggingStatus = z.infer<typeof TaggingStatusEnum>;

export const GarmentImageKindEnum = z.enum(['ORIGINAL', 'THUMB', 'DETAIL']);
export type GarmentImageKind = z.infer<typeof GarmentImageKindEnum>;

// =====================================================================
// Etiquetado por visión
// =====================================================================

/**
 * Autoevaluación del modelo sobre un atributo. **No es una probabilidad
 * calibrada**: es una etiqueta que el propio modelo declara, y sólo sirve para
 * marcar qué conviene revisar antes de confirmar. Nunca se muestra como
 * porcentaje ni se usa para puntuar.
 */
export const VisionConfidenceEnum = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export type VisionConfidence = z.infer<typeof VisionConfidenceEnum>;

/**
 * Atributos de una prenda que el usuario puede editar. Es el vocabulario de
 * `manualFields`: lo que el usuario tocó a mano no lo pisa un reetiquetado
 * automático. Coincide uno a uno con los campos de `CreateGarmentSchema`.
 */
export const TaggableFieldEnum = z.enum([
  'name',
  'garmentTypeId',
  'slot',
  'primaryColorHex',
  'primaryColorName',
  'secondaryColorHex',
  'pattern',
  'patternScale',
  'material',
  'fit',
  'formality',
  'seasons',
  'weatherMinC',
  'weatherMaxC',
  'brand',
  'size',
  'status',
]);
export type TaggableField = z.infer<typeof TaggableFieldEnum>;

// =====================================================================
// Looks
// =====================================================================

/**
 * Papel de una prenda dentro del look. Lo deriva el servidor a partir del slot:
 * nunca lo escribe un modelo ni viaja desde el cliente.
 */
export const OutfitItemRoleEnum = z.enum(['BASE', 'LAYER', 'FOOTWEAR', 'ACCESSORY']);
export type OutfitItemRole = z.infer<typeof OutfitItemRoleEnum>;

/**
 * Cuándo tiene sentido usar el look. Sale de la formalidad real del conjunto y
 * del estilo pedido, no de una etiqueta inventada.
 */
export const LookOccasionEnum = z.enum([
  'DAILY',
  'WORK',
  'CASUAL_OUTING',
  'DINNER',
  'EVENT',
  'TRAVEL',
  'SPORT',
]);
export type LookOccasion = z.infer<typeof LookOccasionEnum>;

/**
 * Señales que suma el `engineScore`. Cada una viaja con su puntuación, su peso y
 * la razón en español, para que la ficha pueda explicar por qué encaja el look.
 */
export const LookScoreSignalEnum = z.enum([
  'FORMALITY',
  'COLOR',
  'WEATHER',
  'FIT',
  'PATTERN',
  'FRESHNESS',
  'PREFERENCE',
]);
export type LookScoreSignal = z.infer<typeof LookScoreSignalEnum>;

/**
 * Quién armó el look. `AI` es el estilista de la Fase 4; `MANUAL` queda para un
 * conjunto que el usuario componga a mano, que todavía no existe pero que no
 * puede compartir origen con lo que escribió un modelo.
 */
export const OutfitSourceEnum = z.enum(['AI', 'MANUAL']);
export type OutfitSource = z.infer<typeof OutfitSourceEnum>;

/**
 * Qué hizo el usuario con el look. Los eventos se acumulan y no se sobreescriben:
 * cambiar de opinión añade una fila, nunca borra la anterior.
 */
export const OutfitFeedbackKindEnum = z.enum(['RATING', 'FAVORITE', 'REJECTED', 'WORN']);
export type OutfitFeedbackKind = z.infer<typeof OutfitFeedbackKindEnum>;

/**
 * Por qué el usuario rechazó el look. Los valores van en inglés como el resto de
 * los enums del proyecto —el plan los escribió en español de forma informal— y
 * su traducción vive en `enumLabels`.
 *
 * Cada motivo alimenta la señal del motor que le corresponde: `COLOR` penaliza la
 * paleta, `TOO_FORMAL`/`TOO_CASUAL` desplazan la formalidad objetivo,
 * `UNCOMFORTABLE` penaliza esos cortes. `GARMENT_UNAVAILABLE` no aprende nada:
 * lo resuelve marcar la prenda como no disponible en el clóset.
 */
export const OutfitRejectedReasonEnum = z.enum([
  'COLOR',
  'TOO_FORMAL',
  'TOO_CASUAL',
  'UNCOMFORTABLE',
  'NOT_MY_STYLE',
  'GARMENT_UNAVAILABLE',
]);
export type OutfitRejectedReason = z.infer<typeof OutfitRejectedReasonEnum>;
/**
 * Qué representa el render de un look. Hoy sólo hay una forma —una figura
 * vistiendo el conjunto— y el enum existe para poder añadir otras (flat-lay,
 * maniquí) sin migrar la columna.
 */
export const OutfitRenderKindEnum = z.enum(['AI_MODEL']);
export type OutfitRenderKind = z.infer<typeof OutfitRenderKindEnum>;

/**
 * En qué punto está una brecha del clóset. `DISMISSED` no es sólo una forma de
 * ocultarla: el siguiente análisis no vuelve a proponer lo que el usuario ya
 * descartó, así que la decisión se conserva aunque la brecha desaparezca.
 */
export const WardrobeGapStatusEnum = z.enum(['OPEN', 'PURCHASED', 'DISMISSED']);
export type WardrobeGapStatus = z.infer<typeof WardrobeGapStatusEnum>;

// =====================================================================
// Etiquetas en español
// =====================================================================

export const enumLabels = {
  aiJobKind: {
    TAGGING: 'Etiquetado',
    STYLING: 'Estilismo',
    GAP_ANALYSIS: 'Análisis de vacíos',
    RENDER: 'Render',
  } satisfies Record<AiJobKind, string>,
  aiJobStatus: {
    QUEUED: 'En cola',
    RUNNING: 'Procesando',
    SUCCEEDED: 'Completado',
    FAILED: 'Fallido',
    CANCELLED: 'Cancelado',
  } satisfies Record<AiJobStatus, string>,
  gender: {
    MALE: 'Hombre',
    FEMALE: 'Mujer',
    NON_BINARY: 'No binario',
    UNSPECIFIED: 'Prefiero no decirlo',
  } satisfies Record<Gender, string>,
  presentationPreference: {
    MASCULINE: 'Masculina',
    FEMININE: 'Femenina',
    ANDROGYNOUS: 'Andrógina',
    NEUTRAL: 'Neutra',
  } satisfies Record<PresentationPreference, string>,
  bodyShape: {
    RECTANGLE: 'Recta',
    TRIANGLE: 'Triángulo',
    INVERTED_TRIANGLE: 'Triángulo invertido',
    HOURGLASS: 'Reloj de arena',
    OVAL: 'Ovalada',
  } satisfies Record<BodyShape, string>,
  fitPreference: {
    RELAXED: 'Holgado',
    REGULAR: 'Regular',
    SLIM: 'Ajustado',
    OVERSIZED: 'Oversized',
  } satisfies Record<FitPreference, string>,
  styleArchetype: {
    MINIMALIST: 'Minimalista',
    SMART_CASUAL: 'Smart casual',
    CLASSIC: 'Clásico',
    STREETWEAR: 'Streetwear',
    BOHO: 'Boho',
    ROMANTIC: 'Romántico',
    ANDROGYNOUS: 'Andrógino',
    SPORTY: 'Deportivo',
  } satisfies Record<StyleArchetype, string>,
  budgetTier: {
    BUDGET: 'Económico',
    MID: 'Medio',
    PREMIUM: 'Premium',
    LUXURY: 'Lujo',
  } satisfies Record<BudgetTier, string>,
  climate: {
    HOT: 'Cálido (más de 28 °C)',
    WARM: 'Templado cálido (22–28 °C)',
    TEMPERATE: 'Templado (16–22 °C)',
    COOL: 'Fresco (10–16 °C)',
    COLD: 'Frío (menos de 10 °C)',
    VARIABLE: 'Variable',
  } satisfies Record<Climate, string>,
  garmentSlot: {
    TOP: 'Parte de arriba',
    MID_LAYER: 'Capa media',
    OUTERWEAR: 'Abrigo',
    BOTTOM: 'Parte de abajo',
    FULL_BODY: 'Prenda entera',
    FOOTWEAR: 'Calzado',
    ACCESSORY: 'Accesorio',
  } satisfies Record<GarmentSlot, string>,
  appliesTo: {
    MALE: 'Hombre',
    FEMALE: 'Mujer',
    BOTH: 'Todos',
  } satisfies Record<AppliesTo, string>,
  season: {
    SPRING: 'Primavera',
    SUMMER: 'Verano',
    AUTUMN: 'Otoño',
    WINTER: 'Invierno',
  } satisfies Record<Season, string>,
  garmentPattern: {
    SOLID: 'Liso',
    STRIPED: 'Rayas',
    CHECKED: 'Cuadros',
    FLORAL: 'Floral',
    GRAPHIC: 'Estampado gráfico',
    ANIMAL: 'Animal print',
    GEOMETRIC: 'Geométrico',
    OTHER: 'Otro',
  } satisfies Record<GarmentPattern, string>,
  patternScale: {
    NONE: 'Sin estampado',
    SMALL: 'Pequeño',
    MEDIUM: 'Mediano',
    LARGE: 'Grande',
  } satisfies Record<PatternScale, string>,
  garmentMaterial: {
    COTTON: 'Algodón',
    DENIM: 'Denim',
    WOOL: 'Lana',
    LINEN: 'Lino',
    LEATHER: 'Cuero',
    SYNTHETIC: 'Sintético',
    SILK: 'Seda',
    KNIT: 'Punto',
    BLEND: 'Mezcla',
    OTHER: 'Otro',
  } satisfies Record<GarmentMaterial, string>,
  garmentStatus: {
    ACTIVE: 'Disponible',
    LAUNDRY: 'En la lavandería',
    STORED: 'Guardada',
    DONATED: 'Donada',
    ARCHIVED: 'Archivada',
  } satisfies Record<GarmentStatus, string>,
  taggingStatus: {
    PENDING: 'Sin etiquetar',
    SUGGESTED: 'Sugerido por IA',
    CONFIRMED: 'Confirmado',
    FAILED: 'Etiquetado fallido',
  } satisfies Record<TaggingStatus, string>,
  visionConfidence: {
    HIGH: 'Se ve claro',
    MEDIUM: 'Conviene revisarlo',
    LOW: 'Poco seguro',
  } satisfies Record<VisionConfidence, string>,
  taggableField: {
    garmentTypeId: 'Tipo de prenda',
    slot: 'Parte del cuerpo',
    primaryColorHex: 'Color principal',
    primaryColorName: 'Nombre del color',
    secondaryColorHex: 'Color secundario',
    pattern: 'Estampado',
    patternScale: 'Escala del estampado',
    material: 'Material',
    fit: 'Corte',
    formality: 'Formalidad',
    seasons: 'Temporadas',
    weatherMinC: 'Temperatura mínima',
    weatherMaxC: 'Temperatura máxima',
    name: 'Nombre',
    brand: 'Marca',
    size: 'Talla',
    status: 'Estado',
  } satisfies Record<TaggableField, string>,
  garmentImageKind: {
    ORIGINAL: 'Original',
    THUMB: 'Miniatura',
    DETAIL: 'Detalle',
  } satisfies Record<GarmentImageKind, string>,
  outfitItemRole: {
    BASE: 'Base',
    LAYER: 'Capa',
    FOOTWEAR: 'Calzado',
    ACCESSORY: 'Accesorio',
  } satisfies Record<OutfitItemRole, string>,
  lookOccasion: {
    DAILY: 'Día a día',
    WORK: 'Oficina y reuniones',
    CASUAL_OUTING: 'Café y planes casuales',
    DINNER: 'Cenas',
    EVENT: 'Eventos',
    TRAVEL: 'Viajes',
    SPORT: 'Deporte',
  } satisfies Record<LookOccasion, string>,
  lookScoreSignal: {
    FORMALITY: 'Formalidad',
    COLOR: 'Armonía de color',
    WEATHER: 'Clima',
    FIT: 'Ajuste',
    PATTERN: 'Estampados',
    FRESHNESS: 'Variedad',
    PREFERENCE: 'Tus valoraciones',
  } satisfies Record<LookScoreSignal, string>,
  outfitSource: {
    AI: 'Estilista IA',
    MANUAL: 'Armado a mano',
  } satisfies Record<OutfitSource, string>,
  outfitFeedbackKind: {
    RATING: 'Valoración',
    FAVORITE: 'Favorito',
    REJECTED: 'Rechazado',
    WORN: 'Usado',
  } satisfies Record<OutfitFeedbackKind, string>,
  outfitRejectedReason: {
    COLOR: 'No me gusta la combinación de colores',
    TOO_FORMAL: 'Demasiado formal',
    TOO_CASUAL: 'Demasiado casual',
    UNCOMFORTABLE: 'Incómodo',
    NOT_MY_STYLE: 'No es mi estilo',
    GARMENT_UNAVAILABLE: 'Una prenda no está disponible',
  } satisfies Record<OutfitRejectedReason, string>,
  outfitRenderKind: {
    AI_MODEL: 'Figura generada por IA',
  } satisfies Record<OutfitRenderKind, string>,
  wardrobeGapStatus: {
    OPEN: 'Pendiente',
    PURCHASED: 'Ya la compré',
    DISMISSED: 'No me interesa',
  } satisfies Record<WardrobeGapStatus, string>,
} as const;

/** Formalidad 1–5 explicada en palabras, para no mostrar un número desnudo. */
const formalityLabelsByLevel = ['Muy casual', 'Casual', 'Smart casual', 'Formal', 'Muy formal'];

export const minFormality = 1;
export const maxFormality = 5;

/**
 * Traduce un nivel de formalidad a su etiqueta en español.
 * @param {number} formality - Nivel de formalidad entre 1 y 5.
 * @returns {string}
 */
export function formalityLabel(formality: number): string {
  return formalityLabelsByLevel[formality - minFormality] ?? String(formality);
}
