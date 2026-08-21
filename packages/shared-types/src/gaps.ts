import { z } from 'zod';
import { ColorFamilyEnum } from './color';
import { GarmentSlotEnum, StyleArchetypeEnum, WardrobeGapStatusEnum } from './enums';
import { ReferenceBrandsSchema } from './outfit';

/**
 * Contrato del análisis de vacíos (Fase 5).
 */

/** Versión del cálculo de cobertura. Sube si cambian escenarios, hipótesis o pesos. */
export const coverageVersion = 'coverage-v1';

/** Versión del Json de `analysisSnapshot`; sube si cambia su forma. */
export const gapSnapshotVersion = 1;

const maxGapDescriptionLength = 160;
const maxGapReasonLength = 300;

/**
 * Un escenario de la matriz: un estilo a una temperatura concreta. Es la unidad
 * de "cobertura" — el clóset cubre un escenario si el motor puede armar al menos
 * un conjunto válido para él.
 */
export const CoverageScenarioSchema = z.object({
  /** Id corto y posicional (`s1`, `s2`…); sólo significa algo dentro del análisis. */
  id: z.string(),
  styleTag: StyleArchetypeEnum,
  temperatureC: z.number().int(),
  label: z.string(),
  /** Conjuntos válidos que el motor encontró para este escenario. */
  outfitCount: z.number().int(),
  /** Nota del mejor conjunto, 0–100. Cero cuando no hay ninguno. */
  bestEngineScore: z.number().int(),
  /** Slots obligatorios sin ninguna prenda disponible en este escenario. */
  missingSlots: z.array(GarmentSlotEnum),
  /** True si a esa temperatura el look debería llevar capa. */
  needsLayer: z.boolean(),
  /** True si hay alguna capa disponible para cubrir esa necesidad. */
  hasLayer: z.boolean(),
});
export type CoverageScenario = z.infer<typeof CoverageScenarioSchema>;

/** Qué tiene el clóset en un slot y en qué franja de formalidad se mueve. */
export const CoverageSlotSchema = z.object({
  slot: GarmentSlotEnum,
  availableCount: z.number().int(),
  totalCount: z.number().int(),
  minFormality: z.number().int().nullable(),
  maxFormality: z.number().int().nullable(),
});
export type CoverageSlot = z.infer<typeof CoverageSlotSchema>;

/** Cuántas prendas disponibles hay de cada familia de color. */
export const CoverageColorSchema = z.object({
  family: ColorFamilyEnum,
  label: z.string(),
  hex: z.string(),
  count: z.number().int(),
});
export type CoverageColor = z.infer<typeof CoverageColorSchema>;

/**
 * La matriz completa: slot × formalidad × clima × color, más el conteo de looks
 * posibles. Es determinista y auditable, y es lo que ve el modelo.
 */
export const WardrobeCoverageSchema = z.object({
  version: z.string(),
  closetSize: z.number().int(),
  eligibleCount: z.number().int(),
  slots: z.array(CoverageSlotSchema),
  colors: z.array(CoverageColorSchema),
  scenarios: z.array(CoverageScenarioSchema),
  distinctOutfits: z.number().int(),
  uncoveredScenarioIds: z.array(z.string()),
});
export type WardrobeCoverage = z.infer<typeof WardrobeCoverageSchema>;

/**
 * Una prenda que el clóset no tiene y que el cálculo probó a añadir. Todo lo que
 * lleva son datos del motor: el modelo no inventa ninguno de estos números.
 */
export const GapHypothesisSchema = z.object({
  id: z.string(),
  garmentTypeId: z.string().uuid(),
  garmentTypeSlug: z.string(),
  garmentTypeName: z.string(),
  slot: GarmentSlotEnum,
  colorName: z.string(),
  colorHex: z.string(),
  formality: z.number().int(),
  unlockedOutfitsEstimate: z.number().int(),
  newlyCoveredScenarioIds: z.array(z.string()),
  scoreGain: z.number().int(),
  priorityScore: z.number(),
  rationale: z.string(),
});
export type GapHypothesis = z.infer<typeof GapHypothesisSchema>;

/**
 * Una brecha guardada. Los datos exactos —slot, tipo, color, cuántos conjuntos
 * desbloquea— salen del motor; `description`, `reason` y las marcas los escribe
 * el modelo.
 */
export const WardrobeGapSchema = z.object({
  id: z.string().uuid(),
  status: WardrobeGapStatusEnum,
  priority: z.number().int(),
  slot: GarmentSlotEnum,
  garmentTypeId: z.string().uuid(),
  garmentTypeName: z.string(),
  colorName: z.string(),
  colorHex: z.string(),
  formality: z.number().int(),
  description: z.string().max(maxGapDescriptionLength),
  reason: z.string().max(maxGapReasonLength),
  unlockedOutfitsEstimate: z.number().int(),
  referenceBrands: ReferenceBrandsSchema,
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  coverageVersion: z.string(),
  promptVersion: z.string(),
  modelUsed: z.string().nullable(),
});
export type WardrobeGap = z.infer<typeof WardrobeGapSchema>;

/**
 * Lo que vio el análisis cuando propuso esta brecha. Se guarda por el mismo
 * motivo que el snapshot de un look: la redacción del modelo no es reproducible,
 * la entrada sí, y sin ella no se puede comparar una versión del prompt con otra.
 */
export const WardrobeGapSnapshotSchema = z.object({
  version: z.literal(gapSnapshotVersion),
  signature: z.string(),
  coverage: WardrobeCoverageSchema,
  hypothesis: GapHypothesisSchema,
});
export type WardrobeGapSnapshot = z.infer<typeof WardrobeGapSnapshotSchema>;

/**
 * Lo que devuelve el cálculo determinista por sí solo. Es gratis y no llama a
 * nadie: sirve para ver la cobertura antes de decidir si se paga la redacción.
 */
export const CoverageResponseSchema = z.object({
  coverage: WardrobeCoverageSchema,
  hypotheses: z.array(GapHypothesisSchema),
  note: z.string().nullable(),
});
export type CoverageResponse = z.infer<typeof CoverageResponseSchema>;

export const AnalyzeGapsResponseSchema = z.object({
  gaps: z.array(WardrobeGapSchema),
  coverage: WardrobeCoverageSchema,
  note: z.string().nullable(),
  coverageVersion: z.string(),
  promptVersion: z.string(),
  model: z.string(),
  costUsd: z.number(),
  reused: z.boolean(),
  discarded: z.array(z.string()),
});
export type AnalyzeGapsResponse = z.infer<typeof AnalyzeGapsResponseSchema>;

/** Lo que el usuario decide sobre una brecha: la compró, no le interesa o sigue pendiente. */
export const UpdateWardrobeGapSchema = z.object({
  status: WardrobeGapStatusEnum,
});
export type UpdateWardrobeGap = z.infer<typeof UpdateWardrobeGapSchema>;
