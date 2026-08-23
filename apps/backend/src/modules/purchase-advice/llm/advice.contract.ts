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

/** Propiedad de JSON Schema, con la forma acotada que admite `strict: true`. */
type JsonSchemaProperty = Record<string, unknown>;

export interface IAdviceContract {
  jsonSchema: Record<string, unknown>;
  garmentShortIds: readonly string[];
}

/**
 * El veredicto tal como lo redacta el modelo. Todavía sin resolver contra el
 * clóset: de eso se encarga `assembleAdvice`.
 */
export const AdviceDraftSchema = z.object({
  headline: z.string().min(1).max(maxHeadlineLength),
  reason: z.string().min(1).max(maxReasonLength),
  stylingNotes: z.array(z.string().min(1).max(maxStylingNoteLength)).max(maxStylingNotes),
  pairedGarmentIds: z.array(z.string().min(1)).max(maxPairedGarments),
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
 * Construye el contrato del veredicto para los ids de esta petición.
 * @param {readonly string[]} garmentShortIds - Ids válidos en esta petición.
 * @returns {IAdviceContract}
 */
export function buildAdviceContract(garmentShortIds: readonly string[]): IAdviceContract {
  const properties: Record<string, JsonSchemaProperty> = {
    headline: {
      type: 'string',
      maxLength: maxHeadlineLength,
      description:
        'El veredicto en una frase corta y en segunda persona, coherente con el veredicto que te doy. No lo contradigas.',
    },
    reason: {
      type: 'string',
      maxLength: maxReasonLength,
      description:
        'Por qué, citando los números que te doy. No inventes cuántos conjuntos abre ni cuánto cuesta.',
    },
    stylingNotes: {
      type: 'array',
      maxItems: maxStylingNotes,
      items: { type: 'string', maxLength: maxStylingNoteLength },
      description:
        'Hasta tres notas de cómo combinarla con prendas concretas del usuario. Vacío si el veredicto es negativo.',
    },
    pairedGarmentIds: pairedGarmentsProperty(garmentShortIds),
  };

  return {
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
