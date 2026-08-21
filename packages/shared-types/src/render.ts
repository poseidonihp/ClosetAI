import { z } from 'zod';
import { OutfitRenderKindEnum } from './enums';

/**
 * Contrato del render visual del look (Fase 6).
 */

/**
 * Calidad del render. La API acepta además `auto`, que aquí no se ofrece a
 * propósito: el costo se confirma antes de generar y `auto` lo dejaría sin saber.
 */
export const RenderQualityEnum = z.enum(['low', 'medium', 'high']);
export type RenderQuality = z.infer<typeof RenderQualityEnum>;

/** Tamaños del render: vertical para cuerpo entero, cuadrado y horizontal. */
export const RenderSizeEnum = z.enum(['1024x1024', '1024x1536', '1536x1024']);
export type RenderSize = z.infer<typeof RenderSizeEnum>;

export const renderQualityLabels = {
  low: 'Básica',
  medium: 'Media',
  high: 'Alta',
} as const satisfies Record<RenderQuality, string>;

/**
 * Un render guardado del look. `url` pasa por `/api/media` como las fotos de las
 * prendas: la imagen es privada y no hay carpeta pública.
 *
 * La calidad y el tamaño con los que se generó se guardan en la fila para poder
 * comparar dos ajustes sobre el mismo look, pero no viajan en el DTO: lo que la
 * ficha necesita decir es que la imagen la generó una IA y con qué modelo.
 */
export const OutfitRenderSchema = z.object({
  id: z.string().uuid(),
  kind: OutfitRenderKindEnum,
  url: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  modelUsed: z.string(),
  promptVersion: z.string(),
  createdAt: z.string(),
});
export type OutfitRender = z.infer<typeof OutfitRenderSchema>;

/**
 * Lo que va a costar el render antes de pedirlo. Es determinista y gratis: la
 * confirmación de costo de la Fase 6 no puede depender de una llamada que ya se
 * pagó, así que el cliente pregunta primero y pulsa después.
 */
export const RenderQuoteSchema = z.object({
  available: z.boolean(),
  unavailableReason: z.string().nullable(),
  model: z.string(),
  promptVersion: z.string(),
  quality: RenderQualityEnum,
  size: RenderSizeEnum,
  imageCount: z.number().int(),
  estimatedCostUsd: z.number(),
  renderCount: z.number().int(),
});
export type RenderQuote = z.infer<typeof RenderQuoteSchema>;
