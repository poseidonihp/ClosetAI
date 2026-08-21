import type { Outfit, OutfitFeedbackRequest, RenderQuote } from '@closetai/shared-types';

/**
 * Lo que la lista de fichas necesita de un store de looks.
 */
export interface IOutfitActionsStore {
  addFeedback(outfitId: string, feedback: OutfitFeedbackRequest): Promise<Outfit>;
  remove(outfitId: string): Promise<void>;
  renderQuote(outfitId: string): Promise<RenderQuote>;
  /** Devuelve lo que costó el render en USD. */
  render(outfitId: string): Promise<number>;
  removeRender(outfitId: string, renderId: string): Promise<void>;
}
