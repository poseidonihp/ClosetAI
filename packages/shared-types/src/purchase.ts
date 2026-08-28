import { z } from 'zod';
import {
  GarmentSlotEnum,
  PurchaseAdviceStatusEnum,
  PurchaseVerdictEnum,
  PurchaseVerdictReasonEnum,
} from './enums';
import { GarmentSchema } from './garment';
import { maxGapDescriptionLength } from './gaps';

/**
 * Contrato de "¿me lo compro?" (Fase 7): evaluar una prenda concreta antes de
 * comprarla. La Fase 5 dice qué falta en abstracto; ésta responde por la prenda
 * real que tienes en la mano.
 */

/**
 * Versión de la medición. Sube si cambia lo que se mide o cómo se mide.
 *
 * - `measure-v1`: Fase 7, conteos sobre la salida libre del motor.
 * - `measure-v2`: la candidata se le pide al motor explícitamente y se añade la
 *   nota del mejor conjunto que la incluye. Sin pedirla, una prenda que empata
 *   con otra que ya tienes no aparecía nunca y se medía como si no combinara con
 *   nada.
 */
export const measureVersion = 'measure-v2';

/** Versión del Json de `analysisSnapshot`; sube si cambia su forma. */
export const purchaseSnapshotVersion = 1;

const maxHeadlineLength = 120;
const maxAdviceReasonLength = 400;
const maxStylingNoteLength = 200;

const maxAlternativeNoteLength = 200;

/** Notas de cómo combinarla que redacta el modelo. */
export const maxStylingNotes = 3;
/** Brechas abiertas entre las que el modelo puede elegir la alternativa. */
export const maxAlternativeGaps = 8;
/** Prendas propias con las que el modelo puede emparejarla. */
export const maxPairedGarments = 6;

/**
 * Lo que el motor midió al meter la candidata en el clóset. **Ningún número de
 * aquí lo escribe el modelo**: todos salen de volver a pasar el motor.
 */
export const PurchaseImpactSchema = z.object({
  unlockedOutfitsEstimate: z.number().int(),
  outfitsUsingItEstimate: z.number().int(),
  scoreGainPoints: z.number().int(),
  /**
   * Nota del mejor conjunto que la incluye, en la escala 0–100 del motor.
   * Responde a "¿queda bien con lo que tengo?", que **no** es la misma pregunta
   * que "¿me abre conjuntos nuevos?": una prenda puede quedar estupenda y no
   * desbloquear nada porque ya tienes otra que hace su papel.
   */
  bestOutfitScore: z.number().int(),
  /** Mejor nota que da hoy ese mismo escenario sin ella, para poder comparar. */
  baselineBestScore: z.number().int(),
  /** Escenario donde mejor queda. Null si no entra en ninguno. */
  bestOutfitScenarioLabel: z.string().nullable(),
  newlyCoveredScenarioLabels: z.array(z.string()),
  pairedGarmentIds: z.array(z.string().uuid()),
  duplicateGarmentIds: z.array(z.string().uuid()),
  matchedGapId: z.string().uuid().nullable(),
});
export type PurchaseImpact = z.infer<typeof PurchaseImpactSchema>;

/** Una prenda del clóset nombrada dentro de la respuesta, sin repetir su ficha. */
export const PurchaseGarmentRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slot: GarmentSlotEnum,
  colorName: z.string(),
  colorHex: z.string(),
});
export type PurchaseGarmentRef = z.infer<typeof PurchaseGarmentRefSchema>;

/**
 * La medición determinista: veredicto, motivo y números. Es gratis y no llama a
 * nadie, así que la pantalla puede enseñarla antes de que decidas pagar la
 * redacción.
 */
export const PurchaseMeasurementSchema = z.object({
  garmentId: z.string().uuid(),
  verdict: PurchaseVerdictEnum,
  verdictReason: PurchaseVerdictReasonEnum,
  impact: PurchaseImpactSchema.nullable(),
  pairedGarments: z.array(PurchaseGarmentRefSchema),
  duplicateGarments: z.array(PurchaseGarmentRefSchema),
  note: z.string().nullable(),
  canWriteAdvice: z.boolean(),
  measureVersion: z.string(),
  engineVersion: z.string(),
});
export type PurchaseMeasurement = z.infer<typeof PurchaseMeasurementSchema>;

/**
 * Qué comprar en lugar de la prenda que estás mirando. Sale de tus brechas
 * abiertas, nunca de la imaginación del modelo: éste sólo elige una de la lista y
 * dice por qué.
 */
export const PurchaseAlternativeSchema = z.object({
  gapId: z.string().uuid().nullable(),
  label: z.string().max(maxGapDescriptionLength),
  note: z.string().max(maxAlternativeNoteLength),
});
export type PurchaseAlternative = z.infer<typeof PurchaseAlternativeSchema>;

/**
 * Un veredicto guardado. El veredicto, los números y las prendas emparejadas los
 * decide el servidor; el titular, la explicación, las notas de combinación y la
 * alternativa las redacta el modelo sobre un veredicto que ya está tomado.
 */
export const PurchaseAdviceSchema = z.object({
  id: z.string().uuid(),
  garmentId: z.string().uuid(),
  status: PurchaseAdviceStatusEnum,
  verdict: PurchaseVerdictEnum,
  verdictReason: PurchaseVerdictReasonEnum,
  headline: z.string().max(maxHeadlineLength),
  reason: z.string().max(maxAdviceReasonLength),
  stylingNotes: z.array(z.string().max(maxStylingNoteLength)),
  alternative: PurchaseAlternativeSchema.nullable(),
  impact: PurchaseImpactSchema,
  pairedGarments: z.array(PurchaseGarmentRefSchema),
  duplicateGarments: z.array(PurchaseGarmentRefSchema),
  measureVersion: z.string(),
  promptVersion: z.string(),
  modelUsed: z.string().nullable(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});
export type PurchaseAdvice = z.infer<typeof PurchaseAdviceSchema>;

/**
 * Una prenda que estás pensando comprar, con su veredicto si ya lo pediste. La
 * candidata existe desde que subes la foto: el veredicto llega después y puede
 * no llegar nunca.
 */
export const PurchaseCandidateSchema = z.object({
  garment: GarmentSchema,
  advice: PurchaseAdviceSchema.nullable(),
});
export type PurchaseCandidate = z.infer<typeof PurchaseCandidateSchema>;

/**
 * Lo que vio el análisis al redactar este veredicto. Si cambia cualquiera de sus
 * partes —los atributos corregidos, las fotos, el clóset, el perfil o las
 * brechas— la respuesta guardada deja de valer y hay que volver a pedirla.
 */
export const PurchaseAdviceSnapshotSchema = z.object({
  version: z.literal(purchaseSnapshotVersion),
  signature: z.string(),
  measurement: PurchaseMeasurementSchema,
});
export type PurchaseAdviceSnapshot = z.infer<typeof PurchaseAdviceSnapshotSchema>;

export const EvaluatePurchaseResponseSchema = z.object({
  advice: PurchaseAdviceSchema.nullable(),
  measurement: PurchaseMeasurementSchema,
  reused: z.boolean(),
  costUsd: z.number(),
  promptVersion: z.string(),
  model: z.string(),
});
export type EvaluatePurchaseResponse = z.infer<typeof EvaluatePurchaseResponseSchema>;

/**
 * Lo que el usuario decide sin comprarla: descartarla o volver a dudarla.
 * `PURCHASED` no está aquí a propósito: comprarla es una transición atómica que
 * también mete la prenda en el clóset, y tiene su propia ruta.
 */
export const UpdatePurchaseAdviceSchema = z.object({
  status: PurchaseAdviceStatusEnum.exclude(['PURCHASED']),
});
export type UpdatePurchaseAdvice = z.infer<typeof UpdatePurchaseAdviceSchema>;
