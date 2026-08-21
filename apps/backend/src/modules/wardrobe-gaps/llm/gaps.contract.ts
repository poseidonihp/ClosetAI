import { z } from 'zod';

/**
 * Contrato que se le impone al análisis de vacíos.
 */

/** Nombre del esquema tal como lo ve el proveedor. Aparece en sus logs. */
export const gapsSchemaName = 'wardrobe_gaps';

const maxDescriptionLength = 160;
const maxReasonLength = 300;
const maxNoteLength = 220;
const maxBrandLength = 40;
const maxBrandsPerTier = 3;

/** Propiedad de JSON Schema, con la forma acotada que admite `strict: true`. */
type JsonSchemaProperty = Record<string, unknown>;

export interface IGapsContract {
  jsonSchema: Record<string, unknown>;
  hypothesisShortIds: readonly string[];
}

export const GapReferenceBrandsSchema = z.object({
  luxury: z.array(z.string().min(1).max(maxBrandLength)).max(maxBrandsPerTier),
  affordable: z.array(z.string().min(1).max(maxBrandLength)).max(maxBrandsPerTier),
});

/**
 * Una brecha tal como la redacta el modelo. Todavía sin resolver contra las
 * hipótesis: de eso se encarga `assembleGaps`.
 */
export const GapDraftSchema = z.object({
  hypothesisId: z.string().min(1),
  description: z.string().min(1).max(maxDescriptionLength),
  reason: z.string().min(1).max(maxReasonLength),
  referenceBrands: GapReferenceBrandsSchema,
});
export type GapDraft = z.infer<typeof GapDraftSchema>;

export const GapsDraftSchema = z.object({
  /** En orden de prioridad: la primera es lo que más conviene comprar. */
  gaps: z.array(GapDraftSchema),
  note: z.string().max(maxNoteLength).nullable(),
});
export type GapsDraft = z.infer<typeof GapsDraftSchema>;

/**
 * Declara una cadena acotada.
 * @param {number} maxLength - Longitud máxima permitida.
 * @param {string} description - Qué se espera en el campo, en español.
 * @returns {JsonSchemaProperty}
 */
function stringProperty(maxLength: number, description: string): JsonSchemaProperty {
  return { type: 'string', maxLength, description };
}

/**
 * Declara un array de cadenas acotado.
 * @param {number} maxItems - Cuántos elementos como máximo.
 * @param {number} maxLength - Longitud máxima de cada elemento.
 * @param {string} description - Qué se espera en el campo, en español.
 * @returns {JsonSchemaProperty}
 */
function stringArray(maxItems: number, maxLength: number, description: string): JsonSchemaProperty {
  return { type: 'array', items: { type: 'string', maxLength }, description, maxItems };
}

/**
 * Marcas de referencia por rango de precio. Pueden venir vacías: una marca
 * inventada por rellenar es peor que ninguna.
 * @returns {JsonSchemaProperty}
 */
function referenceBrandsProperty(): JsonSchemaProperty {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['luxury', 'affordable'],
    description:
      'Marcas que sirven de referencia del estilo de esta prenda en el país del usuario. No son disponibilidad ni precio.',
    properties: {
      luxury: stringArray(maxBrandsPerTier, maxBrandLength, 'Marcas de gama alta.'),
      affordable: stringArray(maxBrandsPerTier, maxBrandLength, 'Marcas asequibles.'),
    },
  };
}

/**
 * Una brecha dentro de la respuesta.
 * @param {readonly string[]} hypothesisShortIds - Ids válidos en esta petición.
 * @returns {JsonSchemaProperty}
 */
function gapProperty(hypothesisShortIds: readonly string[]): JsonSchemaProperty {
  const properties: Record<string, JsonSchemaProperty> = {
    hypothesisId: {
      type: 'string',
      enum: [...hypothesisShortIds],
      description: 'Id corto de la prenda candidata. No existe ninguna fuera de esta lista.',
    },
    description: stringProperty(
      maxDescriptionLength,
      'La prenda concreta, en una línea y en español: tipo, color y corte. Ejemplo: "chaqueta de cuero negra, corte regular".',
    ),
    reason: stringProperty(
      maxReasonLength,
      'Por qué conviene comprarla ahora, citando lo que desbloquea según los datos que te doy. Sin inventar números.',
    ),
    referenceBrands: referenceBrandsProperty(),
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

/**
 * Construye el contrato del análisis para los ids de esta petición.
 * @param {readonly string[]} hypothesisShortIds - Ids válidos en esta petición.
 * @returns {IGapsContract}
 */
export function buildGapsContract(hypothesisShortIds: readonly string[]): IGapsContract {
  const properties: Record<string, JsonSchemaProperty> = {
    gaps: {
      type: 'array',
      maxItems: hypothesisShortIds.length,
      items: gapProperty(hypothesisShortIds),
      description:
        'Las prendas candidatas que de verdad merecen la compra, de la más urgente a la menos. Puedes devolver menos de las que te doy, o ninguna si ninguna lo merece.',
    },
    note: {
      type: ['string', 'null'],
      maxLength: maxNoteLength,
      description:
        'Un supuesto o un matiz que el usuario deba saber sobre esta lista, o null si no hay ninguno.',
    },
  };

  return {
    hypothesisShortIds,
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
 * @returns {GapsDraft}
 */
export function parseGapsDraft(raw: unknown): GapsDraft {
  return GapsDraftSchema.parse(raw);
}
