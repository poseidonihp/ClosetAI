import {
  FitPreferenceEnum,
  GarmentMaterialEnum,
  GarmentPatternEnum,
  GarmentSlotEnum,
  PatternScaleEnum,
  SeasonEnum,
  VisionAttributesSchema,
  VisionConfidenceEnum,
  maxFormality,
  minFormality,
  type VisionAttributes,
} from '@closetai/shared-types';

/**
 * Contrato que se le impone al modelo de visión.
 */

/** Nombre del esquema tal como lo ve el proveedor. Aparece en sus logs. */
export const visionSchemaName = 'garment_attributes';

const hexColorJsonPattern = '^#[0-9a-fA-F]{6}$';
const maxNameLength = 80;
const maxColorNameLength = 40;
const maxBrandGuessLength = 60;
const maxNotesLength = 300;
const minTemperatureC = -30;
const maxTemperatureC = 55;
const seasonCount = 4;

/** Propiedad de JSON Schema, con la forma acotada que admite `strict: true`. */
type JsonSchemaProperty = Record<string, unknown>;

export interface IVisionContract {
  /** JSON Schema estricto para el proveedor. */
  jsonSchema: Record<string, unknown>;
  /** Slugs válidos, en el mismo orden en el que se declararon al modelo. */
  garmentTypeSlugs: readonly string[];
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
 * Entero opcional acotado al rango de temperaturas que acepta una prenda.
 * @param {string} description - Qué se espera en el campo, en español.
 * @returns {JsonSchemaProperty}
 */
function nullableTemperature(description: string): JsonSchemaProperty {
  return {
    type: ['integer', 'null'],
    minimum: minTemperatureC,
    maximum: maxTemperatureC,
    description,
  };
}

/**
 * Declara un enum de cadenas.
 * @param {readonly string[]} values - Valores admitidos.
 * @param {string} description - Qué se espera en el campo, en español.
 * @returns {JsonSchemaProperty}
 */
function enumProperty(values: readonly string[], description: string): JsonSchemaProperty {
  return { type: 'string', enum: [...values], description };
}

/**
 * Autoevaluación por grupo de atributos. Se pide explícitamente que sea una
 * etiqueta y no un número: un porcentaje inventado por el modelo se leería como
 * una probabilidad calibrada, y no lo es.
 * @returns {JsonSchemaProperty}
 */
function confidenceProperty(): JsonSchemaProperty {
  const groups = ['garmentType', 'color', 'pattern', 'material', 'fit', 'formality', 'brand'];
  return {
    type: 'object',
    additionalProperties: false,
    required: groups,
    description: 'Qué tan claro se ve cada grupo de atributos en la foto.',
    properties: Object.fromEntries(
      groups.map(group => [
        group,
        enumProperty(VisionConfidenceEnum.options, `Claridad de ${group} en la foto.`),
      ]),
    ),
  };
}

/**
 * Construye el contrato del etiquetado para un catálogo concreto.
 * @param {readonly string[]} garmentTypeSlugs - Slugs del catálogo de tipos.
 * @returns {IVisionContract}
 */
export function buildVisionContract(garmentTypeSlugs: readonly string[]): IVisionContract {
  const properties: Record<string, JsonSchemaProperty> = {
    garmentTypeSlug: enumProperty(
      garmentTypeSlugs,
      'Tipo de prenda del catálogo. Elige el más cercano; nunca inventes uno.',
    ),
    slot: enumProperty(
      GarmentSlotEnum.options,
      'Parte del cuerpo que ocupa. Debe ser coherente con el tipo elegido.',
    ),
    suggestedName: {
      type: 'string',
      maxLength: maxNameLength,
      description: 'Nombre corto en español, como "Camiseta blanca de algodón".',
    },
    primaryColorHex: {
      type: 'string',
      pattern: hexColorJsonPattern,
      description: 'Color dominante de la prenda en formato #rrggbb.',
    },
    primaryColorName: {
      type: 'string',
      maxLength: maxColorNameLength,
      description: 'Nombre del color dominante en español.',
    },
    secondaryColorHex: {
      type: ['string', 'null'],
      pattern: hexColorJsonPattern,
      description: 'Segundo color relevante, o null si la prenda es de un solo color.',
    },
    pattern: enumProperty(GarmentPatternEnum.options, 'Estampado de la prenda.'),
    patternScale: enumProperty(
      PatternScaleEnum.options,
      'Tamaño del estampado. NONE si la prenda es lisa.',
    ),
    material: enumProperty(
      GarmentMaterialEnum.options,
      'Material aparente. Usa OTHER si no se distingue.',
    ),
    fit: enumProperty(FitPreferenceEnum.options, 'Corte de la prenda.'),
    formality: {
      type: 'integer',
      minimum: minFormality,
      maximum: maxFormality,
      description: '1 muy casual, 3 smart casual, 5 muy formal.',
    },
    seasons: {
      type: 'array',
      minItems: 1,
      maxItems: seasonCount,
      items: enumProperty(SeasonEnum.options, 'Temporada.'),
      description:
        'Temporadas en las que la prenda tiene sentido. Si sirve en cualquier época, lista las cuatro. Nunca la dejes vacía.',
    },
    weatherMinC: nullableTemperature('Temperatura mínima cómoda en °C, o null.'),
    weatherMaxC: nullableTemperature('Temperatura máxima cómoda en °C, o null.'),
    brandGuess: nullableString(
      maxBrandGuessLength,
      'Marca sólo si su logo o etiqueta se lee en la foto. Si no, null.',
    ),
    confidence: confidenceProperty(),
    personVisible: {
      type: 'boolean',
      description: 'True si en la foto aparece una persona. No la describas.',
    },
    usableForTagging: {
      type: 'boolean',
      description:
        'False si de estas fotos no se puede catalogar una prenda concreta. True si hay una prenda identificable, aunque alguien la lleve puesta.',
    },
    unusableReason: nullableString(
      maxNotesLength,
      'Si usableForTagging es false, explica en español qué falta en las fotos. Si es true, null.',
    ),
    notes: nullableString(
      maxNotesLength,
      'Detalle útil sobre la prenda en español, o null. Nunca sobre quien la lleva.',
    ),
  };

  return {
    garmentTypeSlugs,
    jsonSchema: {
      type: 'object',
      additionalProperties: false,
      required: Object.keys(properties),
      properties,
    },
  };
}

/**
 * Valida la salida del modelo y comprueba que el tipo de prenda exista de verdad
 * en el catálogo. Lanza `ZodError` si no cumple.
 * @param {unknown} raw - JSON ya parseado tal como vino del proveedor.
 * @param {readonly string[]} garmentTypeSlugs - Slugs válidos del catálogo.
 * @returns {VisionAttributes}
 */
export function parseVisionAttributes(
  raw: unknown,
  garmentTypeSlugs: readonly string[],
): VisionAttributes {
  const allowed = new Set(garmentTypeSlugs);
  return VisionAttributesSchema.refine(
    attributes => allowed.has(attributes.garmentTypeSlug),
    'El modelo devolvió un tipo de prenda que no está en el catálogo',
  ).parse(raw);
}
