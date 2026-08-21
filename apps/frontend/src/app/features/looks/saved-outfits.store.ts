import { Injectable, inject, signal } from '@angular/core';
import type { Outfit, OutfitFeedbackRequest, RenderQuote } from '@closetai/shared-types';
import { ApiClient } from '../../core/http/api.client';
import { OutfitActionsService } from './outfit-actions.service';

/**
 * Los looks que el usuario marcó como guardados.
 * @class
 */
@Injectable({ providedIn: 'root' })
export class SavedOutfitsStore {
  private readonly _api = inject(ApiClient);
  private readonly _actions = inject(OutfitActionsService);

  private readonly _outfits = signal<Outfit[]>([]);
  private readonly _loading = signal(false);
  private readonly _loaded = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly outfits = this._outfits.asReadonly();
  readonly loading = this._loading.asReadonly();
  /** True tras la primera carga: distingue "no has guardado nada" de "aún no cargó". */
  readonly loaded = this._loaded.asReadonly();
  readonly error = this._error.asReadonly();

  /**
   * Carga los looks guardados del servidor. Es gratis: no llama al proveedor de IA.
   * @returns {Promise<void>}
   */
  async load(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      this._outfits.set(await this._api.get<Outfit[]>('stylist/outfits', { favorite: true }));
      this._loaded.set(true);
    } catch (error) {
      this._error.set(ApiClient.messageFromError(error));
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Registra una decisión sobre un look guardado.
   * @param {string} outfitId - Look valorado.
   * @param {OutfitFeedbackRequest} feedback - Qué hizo el usuario.
   * @returns {Promise<Outfit>}
   */
  async addFeedback(outfitId: string, feedback: OutfitFeedbackRequest): Promise<Outfit> {
    const updated = await this._actions.addFeedback(outfitId, feedback);
    this._sync(updated);
    return updated;
  }

  /**
   * Borra un look guardado del servidor y de la lista.
   * @param {string} outfitId - Look a borrar.
   * @returns {Promise<void>}
   */
  async remove(outfitId: string): Promise<void> {
    await this._actions.remove(outfitId);
    this._outfits.update(list => list.filter(outfit => outfit.id !== outfitId));
  }

  /**
   * Pregunta qué costaría el render de un look guardado.
   * @param {string} outfitId - Look a renderizar.
   * @returns {Promise<RenderQuote>}
   */
  renderQuote(outfitId: string): Promise<RenderQuote> {
    return this._actions.renderQuote(outfitId);
  }

  /**
   * Genera el visual de un look guardado y devuelve lo que costó.
   * @param {string} outfitId - Look a renderizar.
   * @returns {Promise<number>}
   */
  async render(outfitId: string): Promise<number> {
    const response = await this._actions.render(outfitId);
    this._sync(response.outfit);
    return response.costUsd;
  }

  /**
   * Borra un visual del look. El look y su historial no se tocan.
   * @param {string} outfitId - Look al que pertenece.
   * @param {string} renderId - Visual a borrar.
   * @returns {Promise<void>}
   */
  async removeRender(outfitId: string, renderId: string): Promise<void> {
    this._sync(await this._actions.removeRender(outfitId, renderId));
  }

  /**
   * Refleja el look actualizado. Un look que deja de estar guardado sale de la
   * lista: es la única invariante que esta lista tiene que sostener.
   * @private
   * @param {Outfit} updated - Look tal como lo devolvió el servidor.
   * @returns {void}
   */
  private _sync(updated: Outfit): void {
    if (!updated.isFavorite) {
      this._outfits.update(list => list.filter(outfit => outfit.id !== updated.id));
      return;
    }
    this._outfits.update(list => list.map(outfit => (outfit.id === updated.id ? updated : outfit)));
  }
}
