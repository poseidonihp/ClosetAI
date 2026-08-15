import { z } from 'zod';
import {
  LookOccasionEnum,
  OutfitFeedbackKindEnum,
  OutfitRejectedReasonEnum,
  OutfitSourceEnum,
} from './enums';
import {
  GenerateLooksRequestSchema,
  LookDiagnosticsSchema,
  LookSchema,
  LookScoreLineSchema,
} from './stylist';

/**
 * Contrato del estilista LLM (Fase 4).
 */

export const minOutfitRating = 1;
export const maxOutfitRating = 5;
const maxFeedbackNoteLength = 500;

/** Versión del Json de `generationSnapshot`; sube si cambia su forma. */
export const outfitSnapshotVersion = 1;

/**
 * Marcas que sirven de referencia para el estilo del look, por rango de precio.
 *
 * **No son disponibilidad ni precio**: son nombres con los que orientarse, y la
 * ficha lo dice. Es el riesgo 9 del plan y el motivo de que vayan en su propio
 * bloque en vez de mezcladas con las prendas reales del clóset.
 */
export const ReferenceBrandsSchema = z.object({
  luxury: z.array(z.string()),
  affordable: z.array(z.string()),
});
export type ReferenceBrands = z.infer<typeof ReferenceBrandsSchema>;

/**
 * Petición al estilista. Es la del motor más la ocasión, que sólo existe en esta
 * capa: la formalidad la sigue marcando el `styleTag` y la ocasión es contexto
 * para la redacción y para elegir entre candidatos igual de válidos.
 */
export const GenerateOutfitsRequestSchema = GenerateLooksRequestSchema.extend({
  occasion: LookOccasionEnum.nullable().default(null),
});
export type GenerateOutfitsRequest = z.infer<typeof GenerateOutfitsRequestSchema>;

/**
 * Lo que se le enseñó al modelo y lo que decidió el motor para este look. Se
 * guarda entero porque es la única forma de comparar dos versiones del prompt
 * sobre el mismo clóset: la redacción del LLM no es reproducible, la entrada sí.
 */
export const OutfitGenerationSnapshotSchema = z.object({
  version: z.literal(outfitSnapshotVersion),
  request: GenerateOutfitsRequestSchema,
  /** Temperatura que acabó usando el motor tras resolver clima y perfil. */
  resolvedTemperatureC: z.number().nullable(),
  /** Hash del conjunto de candidatos que viajó al modelo. */
  candidateSetHash: z.string(),
  candidateCount: z.number().int(),
  /** True si hubo que recortar la enumeración de combinaciones. */
  truncated: z.boolean(),
  /** Id corto con el que el modelo se refirió a este conjunto (`c1`, `c2`…). */
  candidateId: z.string(),
  garmentIds: z.array(z.string().uuid()),
  scoreBreakdown: z.array(LookScoreLineSchema),
});
export type OutfitGenerationSnapshot = z.infer<typeof OutfitGenerationSnapshotSchema>;

/**
 * Un look guardado. `id` es el UUID de la fila —lo que necesitan las acciones de
 * favorito, usado, valorar y rechazar—; el hash con el que lo identificó el motor
 * viaja aparte en `candidateId`, dentro del snapshot.
 */
export const OutfitSchema = LookSchema.extend({
  id: z.string().uuid(),
  /** Párrafo del estilista. Vacío nunca: si el modelo no lo da, el look se descarta. */
  description: z.string(),
  referenceBrands: ReferenceBrandsSchema,
  /**
   * Comentario del modelo sobre los compromisos del look. **No es una
   * probabilidad calibrada** y no se muestra como porcentaje.
   */
  qualityNote: z.string().nullable(),
  source: OutfitSourceEnum,
  /**
   * True si alguna de las prendas del look ya no está en el clóset. El look se
   * conserva —su valoración sigue alimentando el motor— pero deja de ser armable,
   * y decirlo es mejor que enseñar una ficha a la que le falta una prenda.
   */
  isStale: z.boolean(),
  isFavorite: z.boolean(),
  /** 1–5, o null si el usuario no lo ha valorado. */
  rating: z.number().int().nullable(),
  rejectedReason: OutfitRejectedReasonEnum.nullable(),
  wornAt: z.string().nullable(),
  createdAt: z.string(),
  engineVersion: z.string(),
  promptVersion: z.string(),
  modelUsed: z.string().nullable(),
});
export type Outfit = z.infer<typeof OutfitSchema>;

export const GenerateOutfitsResponseSchema = z.object({
  outfits: z.array(OutfitSchema),
  diagnostics: LookDiagnosticsSchema,
  engineVersion: z.string(),
  promptVersion: z.string(),
  model: z.string(),
  /** Costo real de esta llamada en USD, calculado desde el consumo que devolvió la API. */
  costUsd: z.number(),
  /**
   * Lo que el modelo propuso y el servidor no aceptó, con el motivo. Se devuelve
   * en vez de esconderse: un look descartado explica por qué salieron dos y no
   * tres, y es lo que permite detectar que un prompt empezó a fallar.
   */
  discarded: z.array(z.string()),
});
export type GenerateOutfitsResponse = z.infer<typeof GenerateOutfitsResponseSchema>;

/**
 * Un evento de feedback sobre un look. `value` sólo lo mira `FAVORITE`, que se
 * puede poner y quitar; el resto de eventos se acumulan sin deshacerse.
 */
export const OutfitFeedbackRequestSchema = z
  .object({
    kind: OutfitFeedbackKindEnum,
    rating: z.number().int().min(minOutfitRating).max(maxOutfitRating).nullable().default(null),
    reason: OutfitRejectedReasonEnum.nullable().default(null),
    note: z.string().max(maxFeedbackNoteLength).nullable().default(null),
    value: z.boolean().default(true),
  })
  .superRefine((feedback, context) => {
    if (feedback.kind === 'RATING' && feedback.rating === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rating'],
        message: 'Una valoración necesita una nota entre 1 y 5',
      });
    }
    if (feedback.kind === 'REJECTED' && feedback.reason === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'Rechazar un look necesita un motivo',
      });
    }
  });
export type OutfitFeedbackRequest = z.infer<typeof OutfitFeedbackRequestSchema>;
