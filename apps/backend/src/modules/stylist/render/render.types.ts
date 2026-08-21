import type { AiJob } from '@prisma/client';
import type {
  GarmentSlot,
  LookOccasion,
  OutfitItemRole,
  RenderQuality,
  RenderSize,
  StyleArchetype,
  StyleProfile,
} from '@closetai/shared-types';
import type { IImageTokenUsage } from '../../ai/openai-pricing';
import type { IImageSource } from '../../ai/openai.client';

/**
 * Una prenda tal como se le describe al modelo de imagen. `imageIndex` es lo que
 * ata la descripción a su foto: sin él, cinco fotos y cinco párrafos serían dos
 * listas sin relación entre sí.
 */
export interface IRenderPromptGarment {
  /** Número de la foto que le corresponde, empezando en 1. */
  imageIndex: number;
  name: string;
  slot: GarmentSlot;
  role: OutfitItemRole;
  garmentTypeName: string;
  colorName: string;
  colorHex: string;
  /** Estampado, escala, material y corte ya en español. */
  pattern: string;
  material: string;
  fit: string;
}

export interface IRenderPromptInput {
  profile: StyleProfile;
  styleTag: StyleArchetype;
  title: string;
  oneLiner: string;
  occasions: readonly LookOccasion[];
  weatherMinC: number | null;
  weatherMaxC: number | null;
  garments: readonly IRenderPromptGarment[];
}

/** Una prenda del look con su foto de portada, lista para viajar al modelo. */
export interface IRenderGarmentPhoto {
  garmentId: string;
  name: string;
  role: OutfitItemRole;
  storageKey: string;
  mimeType: string;
}

export interface IRenderPhotoSelection {
  selected: IRenderGarmentPhoto[];
  /** Prendas que se quedaron fuera del render, con su nombre, para poder decirlo. */
  droppedNames: string[];
}

/**
 * Fotos que de verdad se pudieron leer de almacenamiento, con su binario. Van
 * juntas a propósito: el prompt numera las prendas por el orden de las imágenes,
 * así que una foto que falta tiene que desaparecer de las dos listas a la vez.
 */
export interface IRenderReadResult {
  images: IImageSource[];
  photos: IRenderGarmentPhoto[];
}

/** Lo que devuelve el render: la imagen, el prompt que la produjo y el consumo. */
export interface IRenderResult {
  base64: string;
  mimeType: string;
  model: string;
  promptVersion: string;
  /** Prompt exacto que se mandó. Se guarda con el render y no se recalcula. */
  promptUsed: string;
  quality: RenderQuality;
  size: RenderSize;
  usage: IImageTokenUsage;
  imageCount: number;
  latencyMs: number;
  providerRequestId: string | null;
}

/** Todo lo que hace falta para guardar un render. */
export interface IRenderPersistContext {
  userId: string;
  outfitId: string;
  job: AiJob;
  result: IRenderResult;
}
