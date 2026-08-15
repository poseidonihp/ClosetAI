import { z } from 'zod';
import {
  BodyShapeEnum,
  BudgetTierEnum,
  ClimateEnum,
  FitPreferenceEnum,
  GenderEnum,
  PresentationPreferenceEnum,
  StyleArchetypeEnum,
} from './enums';

/**
 * Perfil de estilo. **Todo es opcional**: ningún flujo del producto se bloquea
 * por no declarar género, peso o complexión. Las preferencias de ajuste y
 * comodidad son la fuente principal; el resto son señales que el motor usa si
 * existen y ignora si no.
 */

const maxShoeSizeLength = 10;
const maxToneLength = 40;
const maxCountryLength = 60;
const maxCityLength = 80;
const currencyCodeLength = 3;
const maxNotesLength = 1000;
const maxAvoidedColors = 20;
const maxAvoidedGarmentTypes = 50;
const maxColorNameLength = 40;

const minHeightCm = 80;
const maxHeightCm = 260;
const minWeightKg = 25;
const maxWeightKg = 300;
const minMeasurementCm = 20;
const maxMeasurementCm = 250;

/** Versión del formato de `measurements`; sube si cambia la forma del Json. */
export const measurementsVersion = 1;

/**
 * Medidas corporales opcionales. El Json guarda la versión del formato y la
 * unidad de forma explícita para poder migrarlo sin adivinar qué contiene.
 */
export const MeasurementsSchema = z.object({
  version: z.literal(measurementsVersion).default(measurementsVersion),
  unit: z.literal('cm').default('cm'),
  chest: z.number().int().min(minMeasurementCm).max(maxMeasurementCm).nullable().optional(),
  waist: z.number().int().min(minMeasurementCm).max(maxMeasurementCm).nullable().optional(),
  hips: z.number().int().min(minMeasurementCm).max(maxMeasurementCm).nullable().optional(),
  shoulder: z.number().int().min(minMeasurementCm).max(maxMeasurementCm).nullable().optional(),
  inseam: z.number().int().min(minMeasurementCm).max(maxMeasurementCm).nullable().optional(),
  sleeve: z.number().int().min(minMeasurementCm).max(maxMeasurementCm).nullable().optional(),
});
export type Measurements = z.infer<typeof MeasurementsSchema>;

/** Etiquetas en español de cada medida, para el formulario. */
export const measurementLabels = {
  chest: 'Pecho',
  waist: 'Cintura',
  hips: 'Cadera',
  shoulder: 'Hombros',
  inseam: 'Entrepierna',
  sleeve: 'Manga',
} as const;

export type MeasurementKey = keyof typeof measurementLabels;

/** Claves de medida en el orden en que se muestran en el formulario. */
export const measurementKeys = Object.keys(measurementLabels) as MeasurementKey[];

export const StyleProfileSchema = z.object({
  gender: GenderEnum.nullable(),
  heightCm: z.number().int().nullable(),
  weightKg: z.number().int().nullable(),
  bodyShape: BodyShapeEnum.nullable(),
  shoeSize: z.string().nullable(),
  skinTone: z.string().nullable(),
  hairColor: z.string().nullable(),
  measurements: MeasurementsSchema.nullable(),
  presentationPreferences: z.array(PresentationPreferenceEnum),
  styleArchetypes: z.array(StyleArchetypeEnum),
  preferredFits: z.array(FitPreferenceEnum),
  avoidedColors: z.array(z.string()),
  avoidedGarmentTypeIds: z.array(z.string().uuid()),
  budgetTier: BudgetTierEnum.nullable(),
  country: z.string().nullable(),
  currency: z.string().nullable(),
  city: z.string().nullable(),
  climate: ClimateEnum.nullable(),
  notes: z.string().nullable(),
  updatedAt: z.string(),
});
export type StyleProfile = z.infer<typeof StyleProfileSchema>;

/**
 * Actualización parcial del perfil. Un campo ausente no se toca; un `null`
 * explícito lo borra. Es `strict()` a propósito: un nombre de campo mal escrito
 * debe fallar en validación, no perderse en silencio.
 */
export const UpdateStyleProfileSchema = z
  .object({
    gender: GenderEnum.nullable(),
    heightCm: z.number().int().min(minHeightCm).max(maxHeightCm).nullable(),
    weightKg: z.number().int().min(minWeightKg).max(maxWeightKg).nullable(),
    bodyShape: BodyShapeEnum.nullable(),
    shoeSize: z.string().max(maxShoeSizeLength).nullable(),
    skinTone: z.string().max(maxToneLength).nullable(),
    hairColor: z.string().max(maxToneLength).nullable(),
    measurements: MeasurementsSchema.nullable(),
    presentationPreferences: z.array(PresentationPreferenceEnum),
    styleArchetypes: z.array(StyleArchetypeEnum),
    preferredFits: z.array(FitPreferenceEnum),
    avoidedColors: z.array(z.string().min(1).max(maxColorNameLength)).max(maxAvoidedColors),
    avoidedGarmentTypeIds: z.array(z.string().uuid()).max(maxAvoidedGarmentTypes),
    budgetTier: BudgetTierEnum.nullable(),
    country: z.string().max(maxCountryLength).nullable(),
    currency: z.string().length(currencyCodeLength).nullable(),
    city: z.string().max(maxCityLength).nullable(),
    climate: ClimateEnum.nullable(),
    notes: z.string().max(maxNotesLength).nullable(),
  })
  .partial()
  .strict();
export type UpdateStyleProfile = z.infer<typeof UpdateStyleProfileSchema>;
