import { z } from 'zod';
import {
  ClimateEnum,
  GarmentSlotEnum,
  LookOccasionEnum,
  LookScoreSignalEnum,
  OutfitItemRoleEnum,
  StyleArchetypeEnum,
} from './enums';

/**
 * Contrato del motor de compatibilidad (Fase 2).
 */

export const minLooksPerRequest = 1;
export const maxLooksPerRequest = 5;
export const defaultLooksPerRequest = 3;

/** Mismo rango que acepta una prenda: pedir un look a -40 °C no es un dato real. */
const minRequestTemperatureC = -30;
const maxRequestTemperatureC = 55;

/**
 * Petición de looks. La temperatura exacta manda sobre `climate`, y `climate`
 * sobre el clima declarado en el perfil: siempre gana el dato más concreto.
 */
export const GenerateLooksRequestSchema = z.object({
  styleTag: StyleArchetypeEnum,
  temperatureC: z
    .number()
    .int()
    .min(minRequestTemperatureC)
    .max(maxRequestTemperatureC)
    .nullable()
    .default(null),
  climate: ClimateEnum.nullable().default(null),
  /** "Dame looks con esta prenda": todo candidato tiene que contenerla. */
  mustIncludeGarmentId: z.string().uuid().nullable().default(null),
  /**
   * Las prendas todavía sin confirmar sólo entran en la generación con esta
   * acción explícita del usuario; la generación automática usa sólo CONFIRMED.
   */
  includeSuggested: z.boolean().default(false),
  limit: z
    .number()
    .int()
    .min(minLooksPerRequest)
    .max(maxLooksPerRequest)
    .default(defaultLooksPerRequest),
});
export type GenerateLooksRequest = z.infer<typeof GenerateLooksRequestSchema>;

/**
 * Una prenda dentro del look, con la foto real y el motivo por el que el motor
 * la eligió. `role` y `slot` los pone el servidor desde la prenda guardada.
 */
export const LookItemSchema = z.object({
  garmentId: z.string().uuid(),
  name: z.string(),
  slot: GarmentSlotEnum,
  role: OutfitItemRoleEnum,
  garmentTypeName: z.string(),
  brand: z.string().nullable(),
  colorHex: z.string(),
  colorName: z.string(),
  formality: z.number().int(),
  /** URL de la miniatura y de la foto completa; null si la prenda no tiene fotos. */
  thumbUrl: z.string().nullable(),
  url: z.string().nullable(),
  why: z.string(),
});
export type LookItem = z.infer<typeof LookItemSchema>;

/** Aportación de una señal al `engineScore`, con su explicación en español. */
export const LookScoreLineSchema = z.object({
  signal: LookScoreSignalEnum,
  /** 0–1: qué tan bien cumple el conjunto esta señal. */
  score: z.number(),
  /** 0–1: cuánto pesa la señal en la nota final. */
  weight: z.number(),
  reason: z.string(),
});
export type LookScoreLine = z.infer<typeof LookScoreLineSchema>;

export const LookSchema = z.object({
  /** Hash estable del conjunto: el mismo look pedido dos veces trae el mismo id. */
  id: z.string(),
  title: z.string(),
  styleTag: StyleArchetypeEnum,
  oneLiner: z.string(),
  items: z.array(LookItemSchema),
  colorPalette: z.array(z.string()),
  occasions: z.array(LookOccasionEnum),
  styleNotes: z.array(z.string()),
  /** Ancladas a las preferencias y medidas que el usuario dio; nunca al cuerpo. */
  fitNotes: z.array(z.string()),
  weatherMinC: z.number().int().nullable(),
  weatherMaxC: z.number().int().nullable(),
  /** 0–100. Es la nota del motor determinista, no una probabilidad. */
  engineScore: z.number(),
  scoreBreakdown: z.array(LookScoreLineSchema),
});
export type Look = z.infer<typeof LookSchema>;

/**
 * Qué pasó cuando el motor no pudo dar lo que se pedía. Un clóset pequeño cae
 * aquí a menudo y eso es información útil, no un error.
 */
export const LookDiagnosticsSchema = z.object({
  note: z.string().nullable(),
  /** Slots obligatorios que no tienen ninguna prenda disponible. */
  missingSlots: z.array(GarmentSlotEnum),
  hints: z.array(z.string()),
  eligibleCount: z.number().int(),
  excludedCount: z.number().int(),
  /** True si hubo que recortar la enumeración de combinaciones. */
  truncated: z.boolean(),
});
export type LookDiagnostics = z.infer<typeof LookDiagnosticsSchema>;

export const GenerateLooksResponseSchema = z.object({
  looks: z.array(LookSchema),
  diagnostics: LookDiagnosticsSchema,
  engineVersion: z.string(),
});
export type GenerateLooksResponse = z.infer<typeof GenerateLooksResponseSchema>;

/** Prenda descartada por una regla dura, con el motivo exacto. */
export const ExcludedGarmentSchema = z.object({
  garmentId: z.string().uuid(),
  name: z.string(),
  rule: z.string(),
  reason: z.string(),
});
export type ExcludedGarment = z.infer<typeof ExcludedGarmentSchema>;

/** Candidato puntuado tal como lo vio el motor, para el endpoint de depuración. */
export const CandidateDebugSchema = z.object({
  id: z.string(),
  garmentIds: z.array(z.string().uuid()),
  garmentNames: z.array(z.string()),
  engineScore: z.number(),
  scoreBreakdown: z.array(LookScoreLineSchema),
});
export type CandidateDebug = z.infer<typeof CandidateDebugSchema>;

/**
 * Salida del endpoint de depuración: qué prendas entraron, cuáles se cayeron y
 * por qué, y cómo quedó puntuado cada candidato. Va scoped por usuario como
 * cualquier otro endpoint: nunca muestra prendas de otro clóset.
 */
export const LooksDebugResponseSchema = z.object({
  engineVersion: z.string(),
  /** Temperatura que acabó usando el motor tras resolver clima y perfil. */
  resolvedTemperatureC: z.number().nullable(),
  eligible: z.array(
    z.object({
      garmentId: z.string().uuid(),
      name: z.string(),
      slot: GarmentSlotEnum,
      formality: z.number().int(),
    }),
  ),
  excluded: z.array(ExcludedGarmentSchema),
  candidates: z.array(CandidateDebugSchema),
  diagnostics: LookDiagnosticsSchema,
});
export type LooksDebugResponse = z.infer<typeof LooksDebugResponseSchema>;
