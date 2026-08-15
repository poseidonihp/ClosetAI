import { Injectable, inject, signal } from '@angular/core';
import type {
  GenerateLooksRequest,
  GenerateLooksResponse,
  Look,
  LookDiagnostics,
} from '@closetai/shared-types';
import { ApiClient } from '../../core/http/api.client';

/**
 * Looks generados por el motor determinista.
 *
 * No se cachea por petición: cada generación mira el estado real del clóset —lo que
 * está en la lavandería, lo que te pusiste ayer— así que repetir la misma petición
 * mañana puede y debe dar otro resultado.
 *
 * Tampoco sobrevive a salir de la página: `reset()` la deja en blanco al entrar,
 * igual que `OutfitsStore`. Recalcular es gratis e instantáneo, y conservar la tanda
 * anterior sólo servía para que al volver del clóset siguieran ahí unos looks
 * armados con un clóset que quizá acabas de cambiar.
 * @class
 */
@Injectable({ providedIn: 'root' })
export class LooksStore {
  private readonly _api = inject(ApiClient);

  private readonly _looks = signal<Look[]>([]);
  private readonly _diagnostics = signal<LookDiagnostics | null>(null);
  private readonly _lastRequest = signal<GenerateLooksRequest | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _generated = signal(false);

  readonly looks = this._looks.asReadonly();
  readonly diagnostics = this._diagnostics.asReadonly();
  readonly lastRequest = this._lastRequest.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  /** False hasta la primera generación: distingue "vacío" de "todavía no pediste". */
  readonly generated = this._generated.asReadonly();

  /**
   * Vacía la tanda anterior. Se llama al entrar en la página: el store es un
   * singleton de raíz y sin esto los looks de la visita anterior seguirían ahí.
   * @returns {void}
   */
  reset(): void {
    this._looks.set([]);
    this._diagnostics.set(null);
    this._lastRequest.set(null);
    this._error.set(null);
    this._generated.set(false);
  }

  /**
   * Pide looks al motor con la configuración indicada.
   * @param {GenerateLooksRequest} request - Estilo, clima y restricciones.
   * @returns {Promise<void>}
   */
  async generate(request: GenerateLooksRequest): Promise<void> {
    if (this._loading()) {
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    try {
      const response = await this._api.post<GenerateLooksResponse>('stylist/looks', request);
      this._looks.set(response.looks);
      this._diagnostics.set(response.diagnostics);
      this._lastRequest.set(request);
      this._generated.set(true);
    } catch (error) {
      this._error.set(ApiClient.messageFromError(error));
    } finally {
      this._loading.set(false);
    }
  }
}
