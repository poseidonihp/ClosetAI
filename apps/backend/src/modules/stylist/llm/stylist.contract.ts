import { z } from 'zod';
import { LookOccasionEnum } from '@closetai/shared-types';

/**
 * Contrato que se le impone al estilista.
 */

/** Nombre del esquema tal como lo ve el proveedor. Aparece en sus logs. */
export const stylistSchemaName = 'stylist_looks';

/** Prefijo de los ids cortos con los que viajan las prendas. */
export const garmentShortIdPrefix = 'g';

/**
 * Prendas que como máximo entran en el enum del esquema.
 */
export const maxGarmentsInEnum = 40;

const maxTitleLength = 70;
const maxOneLinerLength = 140;
const maxDescriptionLength = 700;
const maxNoteLength = 220;
const maxBrandLength = 40;
const maxWhyLength = 200;
const maxItemsPerLook = 8;
const maxStyleNotesPerLook = 5;
const maxFitNotesPerLook = 4;
const maxOccasionsPerLook = 3;
const maxBrandsPerTier = 3;
const maxLooksPerResponse = 5;

/** Propiedad de JSON Schema, con la forma acotada que admite `strict: true`. */
type JsonSchemaProperty = Record<string, unknown>;

export interface IStylistContract {
  jsonSchema: Record<string, unknown>;
  garmentShortIds: readonly string[];
}

/**
 * Una prenda elegida por el modelo: sólo el id corto y por qué está.
 */
export const StylistLookItemSchema = z.object({
  garmentId: z.string().min(1),
  why: z.string().min(1).max(maxWhyLength),
});
export type StylistLookItem = z.infer<typeof StylistLookItemSchema>;

export const StylistReferenceBrandsSchema = z.object({
  luxury: z.array(z.string().min(1).max(maxBrandLength)).max(maxBrandsPerTier),
  affordable: z.array(z.string().min(1).max(maxBrandLength)).max(maxBrandsPerTier),
});

/**
 * Un look tal como lo redacta el modelo. Todavía sin validar contra el clóset: eso
 * es trabajo de `assembleOutfits`.
 */
export const StylistLookDraftSchema = z.object({
  items: z.array(StylistLookItemSchema).min(1).max(maxItemsPerLook),
  title: z.string().min(1).max(maxTitleLength),
  oneLiner: z.string().min(1).max(maxOneLinerLength),
  description: z.string().min(1).max(maxDescriptionLength),
  occasions: z.array(LookOccasionEnum).min(1).max(maxOccasionsPerLook),
  styleNotes: z.array(z.string().min(1).max(maxNoteLength)).max(maxStyleNotesPerLook),
  fitNotes: z.array(z.string().min(1).max(maxNoteLength)).max(maxFitNotesPerLook),
  referenceBrands: StylistReferenceBrandsSchema,
  qualityNote: z.string().max(maxNoteLength).nullable(),
});
export type StylistLookDraft = z.infer<typeof StylistLookDraftSchema>;

export const StylistDraftSchema = z.object({
  looks: z.array(StylistLookDraftSchema).max(maxLooksPerResponse),
  /** Lo que el modelo quiere decirle al usuario sobre lo que no pudo dar. */
  note: z.string().max(maxNoteLength).nullable(),
});
export type StylistDraft = z.infer<typeof StylistDraftSchema>;

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
 * Declara una cadena que puede venir vacía como `null`. `strict: true` exige que
 * todas las propiedades sean obligatorias, así que "opcional" se expresa como
 * unión con null y no omitiendo el campo.
 * @param {number} maxLength - Longitud máxima permitida.
 * @param {string} description - Qué se espera en el campo, en español.
 * @returns {JsonSchemaProperty}
 */
function nullableString(maxLength: number, description: string): JsonSchemaProperty {
  return { type: ['string', 'null'], maxLength, description };
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
 * Marcas de referencia por rango de precio. Van con listas cortas y pueden venir
 * vacías: una recomendación inventada por rellenar es peor que ninguna.
 * @returns {JsonSchemaProperty}
 */
function referenceBrandsProperty(): JsonSchemaProperty {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['luxury', 'affordable'],
    description:
      'Marcas que sirven de referencia de estilo para este look. No son las marcas del usuario ni una afirmación de precio o disponibilidad.',
    properties: {
      luxury: stringArray(maxBrandsPerTier, maxBrandLength, 'Marcas de gama alta.'),
      affordable: stringArray(maxBrandsPerTier, maxBrandLength, 'Marcas asequibles.'),
    },
  };
}

/**
 * Las prendas del look, cada una citada por su id corto.
 * @param {readonly string[]} garmentShortIds - Ids cortos válidos en esta petición.
 * @returns {JsonSchemaProperty}
 */
function itemsProperty(garmentShortIds: readonly string[]): JsonSchemaProperty {
  return {
    type: 'array',
    minItems: 1,
    maxItems: maxItemsPerLook,
    description:
      'Prendas del look. Sólo ids de la lista CANDIDATOS y sin repetir ninguna dentro del mismo look.',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['garmentId', 'why'],
      properties: {
        garmentId: {
          type: 'string',
          enum: [...garmentShortIds],
          description: 'Id corto de la prenda. No existe ninguna prenda fuera de esta lista.',
        },
        why: stringProperty(maxWhyLength, 'Qué aporta esta prenda al look, en español.'),
      },
    },
  };
}

/**
 * Un look completo dentro de la respuesta.
 * @param {readonly string[]} garmentShortIds - Ids cortos válidos en esta petición.
 * @returns {JsonSchemaProperty}
 */
function lookProperty(garmentShortIds: readonly string[]): JsonSchemaProperty {
  const properties: Record<string, JsonSchemaProperty> = {
    items: itemsProperty(garmentShortIds),
    title: stringProperty(maxTitleLength, 'Título corto del look, en español.'),
    oneLiner: stringProperty(maxOneLinerLength, 'Una frase que resuma el look.'),
    description: stringProperty(
      maxDescriptionLength,
      'Uno o dos párrafos cortos explicando el look con las prendas que lleva.',
    ),
    occasions: {
      type: 'array',
      minItems: 1,
      maxItems: maxOccasionsPerLook,
      items: { type: 'string', enum: [...LookOccasionEnum.options] },
      description: 'Cuándo tiene sentido este look.',
    },
    styleNotes: stringArray(
      maxStyleNotesPerLook,
      maxNoteLength,
      'Notas de estilo ancladas a las prendas reales del look.',
    ),
    fitNotes: stringArray(
      maxFitNotesPerLook,
      maxNoteLength,
      'Notas de ajuste a partir de las que te doy resueltas. Nunca inventes medidas ni describas el cuerpo.',
    ),
    referenceBrands: referenceBrandsProperty(),
    qualityNote: nullableString(
      maxNoteLength,
      'Un compromiso real del look, o null si no tiene peros. Nunca un porcentaje.',
    ),
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

/**
 * Construye el contrato del estilista para los ids cortos de esta petición.
 * @param {readonly string[]} garmentShortIds - Ids cortos válidos en esta petición.
 * @returns {IStylistContract}
 */
export function buildStylistContract(garmentShortIds: readonly string[]): IStylistContract {
  const properties: Record<string, JsonSchemaProperty> = {
    looks: {
      type: 'array',
      maxItems: maxLooksPerResponse,
      items: lookProperty(garmentShortIds),
      description:
        'Los looks elegidos. Puede traer menos de los pedidos si los candidatos no dan para más variedad, o ninguno si ninguno sirve.',
    },
    note: nullableString(
      maxNoteLength,
      'Qué le faltó al usuario para lo que pedía, o null si no le faltó nada.',
    ),
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
 * @returns {StylistDraft}
 */
export function parseStylistDraft(raw: unknown): StylistDraft {
  return StylistDraftSchema.parse(raw);
}

/**
 * Id corto de la prenda que ocupa una posición. Los ids son posicionales y sólo
 * significan algo durante esta petición: no se guardan ni se exponen.
 * @param {number} index - Posición de la prenda, empezando en 0.
 * @returns {string}
 */
export function toGarmentShortId(index: number): string {
  return `${garmentShortIdPrefix}${index + 1}`;
}
