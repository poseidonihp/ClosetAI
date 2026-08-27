import { z } from 'zod';
import { maxPairedGarments, maxStylingNotes } from '@closetai/shared-types';

/**
 * Contrato que se le impone al redactor del veredicto.
 */

/** Nombre del esquema tal como lo ve el proveedor. Aparece en sus logs. */
export const adviceSchemaName = 'purchase_advice';

const maxHeadlineLength = 120;
const maxReasonLength = 400;
const maxStylingNoteLength = 200;
const maxAlternativeNoteLength = 200;

/** Propiedad de JSON Schema, con la forma acotada que admite `strict: true`. */
type JsonSchemaProperty = Record<string, unknown>;

export interface IAdviceContract {
  jsonSchema: Record<string, unknown>;
  garmentShortIds: readonly string[];
  gapShortIds: readonly string[];
}

/**
 * El veredicto tal como lo redacta el modelo. Todavía sin resolver contra el
 * clóset ni contra las brechas: de eso se encarga `assembleAdvice`.
 */
export const AdviceDraftSchema = z.object({
  headline: z.string().min(1).max(maxHeadlineLength),
  reason: z.string().min(1).max(maxReasonLength),
  stylingNotes: z.array(z.string().min(1).max(maxStylingNoteLength)).max(maxStylingNotes),
  pairedGarmentIds: z.array(z.string().min(1)).max(maxPairedGarments),
  alternativeGapId: z.string().nullable(),
  alternativeNote: z.string().max(maxAlternativeNoteLength).nullable(),
});
export type AdviceDraft = z.infer<typeof AdviceDraftSchema>;

/**
 * Declara la lista de prendas con las que el modelo puede emparejar la candidata.
 * Con el enum vacío no habría JSON Schema válido, así que un clóset sin prendas
 * que ofrecer se expresa como una lista que no admite elementos.
 * @param {readonly string[]} garmentShortIds - Ids válidos en esta petición.
 * @returns {JsonSchemaProperty}
 */
function pairedGarmentsProperty(garmentShortIds: readonly string[]): JsonSchemaProperty {
  const description =
    'Ids cortos de las prendas del usuario con las que combinarla. No existe ninguna fuera de esta lista.';
  if (garmentShortIds.length === 0) {
    return { type: 'array', items: { type: 'string' }, maxItems: 0, description };
  }
  return {
    type: 'array',
    maxItems: Math.min(garmentShortIds.length, maxPairedGarments),
    items: { type: 'string', enum: [...garmentShortIds] },
    description,
  };
}

/**
 * Declara la brecha que el modelo puede proponer como alternativa. Sin brechas
 * abiertas no hay enum posible, así que la propiedad se declara como `null` a
 * secas: el modelo no tiene dónde inventarse una compra.
 * @param {readonly string[]} gapShortIds - Ids de brecha válidos en esta petición.
 * @returns {JsonSchemaProperty}
 */
function alternativeGapProperty(gapShortIds: readonly string[]): JsonSchemaProperty {
  const description =
    'Id corto de la brecha que le conviene comprar en lugar de esta prenda. No existe ninguna fuera de esta lista. Null si el veredicto es positivo o si ninguna encaja.';
  if (gapShortIds.length === 0) {
    return { type: 'null', description };
  }
  return { type: ['string', 'null'], enum: [...gapShortIds, null], description };
}

/**
 * Construye el contrato del veredicto para los ids de esta petición.
 * @param {readonly string[]} garmentShortIds - Ids válidos en esta petición.
 * @param {readonly string[]} gapShortIds - Ids de brecha válidos en esta petición.
 * @returns {IAdviceContract}
 */
export function buildAdviceContract(
  garmentShortIds: readonly string[],
  gapShortIds: readonly string[],
): IAdviceContract {
  const properties: Record<string, JsonSchemaProperty> = {
    headline: {
      type: 'string',
      maxLength: maxHeadlineLength,
      description:
        'Qué hace ahora con esta prenda, en una frase corta y en segunda persona. No repitas el veredicto: ya lo tiene en pantalla.',
    },
    reason: {
      type: 'string',
      maxLength: maxReasonLength,
      description:
        'El detalle de esa recomendación, citando los números que te doy. No vuelvas a enunciar el veredicto ni inventes cifras.',
    },
    stylingNotes: {
      type: 'array',
      maxItems: maxStylingNotes,
      items: { type: 'string', maxLength: maxStylingNoteLength },
      description:
        'Hasta tres notas de cómo combinarla con prendas concretas del usuario. Vacío si el veredicto es negativo.',
    },
    pairedGarmentIds: pairedGarmentsProperty(garmentShortIds),
    alternativeGapId: alternativeGapProperty(gapShortIds),
    alternativeNote: {
      type: ['string', 'null'],
      maxLength: maxAlternativeNoteLength,
      description:
        'Por qué esa brecha le conviene más que la prenda que está mirando, con los números que te doy. Null si no propones ninguna.',
    },
  };

  return {
    gapShortIds,
    garmentShortIds,
    jsonSchema: {
      type: 'object',
      additionalProperties: false,
      required: Object.keys(properties),
      properties,
    },
  };
}

/**
 * Valida la forma de la salida del modelo. Lanza `ZodError` si no cumple.
 * @param {unknown} raw - JSON ya parseado tal como vino del proveedor.
 * @returns {AdviceDraft}
 */
export function parseAdviceDraft(raw: unknown): AdviceDraft {
  return AdviceDraftSchema.parse(raw);
}
