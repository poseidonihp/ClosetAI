import type { GarmentSlot } from '@closetai/shared-types';

/** Foto elegida en el cliente que todavía no está en el servidor. */
export interface IPendingPhoto {
  id: number;
  file: File;
  previewUrl: string;
  status: 'pending' | 'uploading' | 'error';
  error?: string;
}

/**
 * Datos con los que abrir el alta ya rellena. Los usa "ya la compré" del análisis
 * de vacíos: la brecha describe exactamente la prenda, así que volver a teclearla
 * sería pedirle al usuario que copie lo que la app acaba de decirle.
 */
export interface IGarmentPrefill {
  name: string;
  garmentTypeId: string;
  slot: GarmentSlot;
  primaryColorHex: string;
  primaryColorName: string;
  formality: number;
}
