import { z } from 'zod';
import { AppliesToEnum, GarmentSlotEnum, SeasonEnum } from './enums';

/**
 * Catálogo de tipos de prenda. Es global y se siembra desde el backend
 * (`prisma/seed.ts`); el cliente sólo lo lee.
 */
export const GarmentTypeSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  slot: GarmentSlotEnum,
  appliesTo: AppliesToEnum,
  defaultFormality: z.number().int(),
  typicalSeasons: z.array(SeasonEnum),
  defaultWeatherMinC: z.number().int().nullable(),
  defaultWeatherMaxC: z.number().int().nullable(),
  sortOrder: z.number().int(),
});
export type GarmentType = z.infer<typeof GarmentTypeSchema>;
