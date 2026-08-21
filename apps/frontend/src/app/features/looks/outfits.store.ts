import { Injectable, inject, signal } from '@angular/core';
import type {
  GenerateOutfitsRequest,
  GenerateOutfitsResponse,
  LookDiagnostics,
  Outfit,
  OutfitFeedbackRequest,
  RenderQuote,
} from '@closetai/shared-types';
import { AiUsageStore } from '../../core/ai/ai-usage.store';
import { ApiClient } from '../../core/http/api.client';
import { OutfitActionsService } from './outfit-actions.service';

/**
 * Looks del estilista LLM.
 *
 * **El store guarda una tanda, no un historial.** Si pides un look ves un look:
 * generar sustituye lo que hubiera, y entrar en la página empieza en blanco. Un
 * listado que fuera creciendo haría que "cuántos looks: 1" enseñara cinco.
 *
 * Que la pantalla se vacíe no significa que se pierda nada: el servidor sí guarda
 * cada look con su snapshot —la llamada se pagó— y es de ahí de donde sale el bucle
 * de aprendizaje. Rechazar un look sigue cambiando la siguiente tanda aunque el
 * look rechazado ya no esté a la vista.
 * @class
 */
@Injectable({ providedIn: 'root' })
export class OutfitsStore {
  private readonly _api = inject(ApiClient);
  private readonly _usage = inject(AiUsageStore);
  private readonly _actions = inject(OutfitActionsService);

  private readonly _outfits = signal<Outfit[]>([]);
  private readonly _diagnostics = signal<LookDiagnostics | null>(null);
  private readonly _discarded = signal<string[]>([]);
  private readonly _lastCostUsd = signal<number | null>(null);
  private readonly _generating = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly outfits = this._outfits.asReadonly();
  readonly diagnostics = this._diagnostics.asReadonly();
  /** Lo que el estilista propuso y el servidor no aceptó, con el motivo. */
  readonly discarded = this._discarded.asReadonly();
  readonly lastCostUsd = this._lastCostUsd.asReadonly();
  readonly generating = this._generating.asReadonly();
  readonly error = this._error.asReadonly();

  /**
   * Vacía la tanda anterior. Se llama al entrar en la página: el store es un
   * singleton de raíz, así que sin esto los looks de la visita anterior seguirían
   * en pantalla al volver desde el clóset.
   * @returns {void}
   */
  reset(): void {
    this._outfits.set([]);
    this._diagnostics.set(null);
    this._discarded.set([]);
    this._lastCostUsd.set(null);
    this._error.set(null);
  }

  /**
   * Pide looks al estilista. El resultado **sustituye** a la tanda anterior, que es
   * lo que hace que pedir un look devuelva un look.
   * @param {GenerateOutfitsRequest} request - Estilo, ocasión, clima y restricciones.
   * @returns {Promise<boolean>}
   */
  async generate(request: GenerateOutfitsRequest): Promise<boolean> {
    if (this._generating()) {
      return false;
    }
    this._generating.set(true);
    this._error.set(null);
    try {
      const response = await this._api.post<GenerateOutfitsResponse>('stylist/outfits', request);
      this._outfits.set(response.outfits);
      this._diagnostics.set(response.diagnostics);
      this._discarded.set(response.discarded);
      this._lastCostUsd.set(response.costUsd);
      // El gasto sólo puede haber cambiado justo ahora.
      await this._usage.refresh();
      return true;
    } catch (error) {
      this._error.set(ApiClient.messageFromError(error));
      return false;
    } finally {
      this._generating.set(false);
    }
  }

  /**
   * Registra una decisión sobre un look: favorito, usado, valoración o rechazo.
   * @param {string} outfitId - Look valorado.
   * @param {OutfitFeedbackRequest} feedback - Qué hizo el usuario.
   * @returns {Promise<Outfit>}
   */
  async addFeedback(outfitId: string, feedback: OutfitFeedbackRequest): Promise<Outfit> {
    const updated = await this._actions.addFeedback(outfitId, feedback);
    this._replace(updated);
    return updated;
  }

  /**
   * Borra un look del servidor y de la tanda.
   * @param {string} outfitId - Look a borrar.
   * @returns {Promise<void>}
   */
  async remove(outfitId: string): Promise<void> {
    await this._actions.remove(outfitId);
    this._outfits.update(list => list.filter(outfit => outfit.id !== outfitId));
  }

  /**
   * Pregunta qué costaría el render de un look. Es gratis y no llama al
   * proveedor: es lo que permite confirmar el costo antes de gastarlo.
   * @param {string} outfitId - Look a renderizar.
   * @returns {Promise<RenderQuote>}
   */
  async renderQuote(outfitId: string): Promise<RenderQuote> {
    return this._actions.renderQuote(outfitId);
  }

  /**
   * Genera el render visual de un look y refleja la ficha actualizada.
   * @param {string} outfitId - Look a renderizar.
   * @returns {Promise<number>}
   */
  async render(outfitId: string): Promise<number> {
    const response = await this._actions.render(outfitId);
    this._replace(response.outfit);
    return response.costUsd;
  }

  /**
   * Borra un render del look. El look y su historial no se tocan.
   * @param {string} outfitId - Look al que pertenece.
   * @param {string} renderId - Render a borrar.
   * @returns {Promise<void>}
   */
  async removeRender(outfitId: string, renderId: string): Promise<void> {
    this._replace(await this._actions.removeRender(outfitId, renderId));
  }

  /**
   * Sustituye un look de la tanda por su versión actualizada.
   * @private
   * @param {Outfit} updated - Look tal como lo devolvió el servidor.
   * @returns {void}
   */
  private _replace(updated: Outfit): void {
    this._outfits.update(list => list.map(outfit => (outfit.id === updated.id ? updated : outfit)));
  }
}
