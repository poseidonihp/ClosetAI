import { Injectable, inject } from '@angular/core';
import type {
  Outfit,
  OutfitFeedbackRequest,
  RenderOutfitResponse,
  RenderQuote,
} from '@closetai/shared-types';
import { AiUsageStore } from '../../core/ai/ai-usage.store';
import { ApiClient } from '../../core/http/api.client';

const outfitsPath = 'stylist/outfits';

/**
 * Acciones sobre un look ya guardado en el servidor. No tiene estado.
 * @class
 */
@Injectable({ providedIn: 'root' })
export class OutfitActionsService {
  private readonly _api = inject(ApiClient);
  private readonly _usage = inject(AiUsageStore);

  /**
   * Registra una decisión sobre un look: favorito, usado, valoración o rechazo.
   * @param {string} outfitId - Look valorado.
   * @param {OutfitFeedbackRequest} feedback - Qué hizo el usuario.
   * @returns {Promise<Outfit>}
   */
  addFeedback(outfitId: string, feedback: OutfitFeedbackRequest): Promise<Outfit> {
    return this._api.post<Outfit>(`${outfitsPath}/${outfitId}/feedback`, feedback);
  }

  /**
   * Borra un look del servidor. El clóset no se toca.
   * @param {string} outfitId - Look a borrar.
   * @returns {Promise<void>}
   */
  remove(outfitId: string): Promise<void> {
    return this._api.delete<void>(`${outfitsPath}/${outfitId}`);
  }

  /**
   * Pregunta qué costaría el render de un look. Es gratis y no llama al
   * proveedor: es lo que permite confirmar el costo antes de gastarlo.
   * @param {string} outfitId - Look a renderizar.
   * @returns {Promise<RenderQuote>}
   */
  renderQuote(outfitId: string): Promise<RenderQuote> {
    return this._api.get<RenderQuote>(`${outfitsPath}/${outfitId}/render/quote`);
  }

  /**
   * Genera el render visual de un look y refresca el gasto, que sólo puede haber
   * cambiado justo ahora.
   * @param {string} outfitId - Look a renderizar.
   * @returns {Promise<RenderOutfitResponse>}
   */
  async render(outfitId: string): Promise<RenderOutfitResponse> {
    const response = await this._api.post<RenderOutfitResponse>(
      `${outfitsPath}/${outfitId}/render`,
    );
    await this._usage.refresh();
    return response;
  }

  /**
   * Borra un render del look. El look y su historial no se tocan.
   * @param {string} outfitId - Look al que pertenece.
   * @param {string} renderId - Render a borrar.
   * @returns {Promise<Outfit>}
   */
  removeRender(outfitId: string, renderId: string): Promise<Outfit> {
    return this._api.delete<Outfit>(`${outfitsPath}/${outfitId}/render/${renderId}`);
  }
}
