import { Injectable, computed, inject, signal } from '@angular/core';
import type { AiUsageSummary } from '@closetai/shared-types';
import { ApiClient } from '../http/api.client';

/**
 * Gasto de IA del mes en curso.
 * @class
 */
@Injectable({ providedIn: 'root' })
export class AiUsageStore {
  private readonly _api = inject(ApiClient);

  private readonly _summary = signal<AiUsageSummary | null>(null);
  private readonly _loading = signal(false);

  readonly summary = this._summary.asReadonly();
  readonly loading = this._loading.asReadonly();

  /** True cuando el mes ya consumió el techo configurado. */
  readonly isExhausted = computed(() => {
    const summary = this._summary();
    return summary !== null && summary.remainingUsd <= 0;
  });

  /**
   * Carga el resumen si todavía no está en memoria.
   * @returns {Promise<void>}
   */
  async load(): Promise<void> {
    if (this._summary() !== null) {
      return;
    }
    await this.refresh();
  }

  /**
   * Vuelve a pedir el resumen al servidor. Un fallo aquí no se propaga: no poder
   * enseñar el gasto no debe tumbar la pantalla desde la que se pidió.
   * @returns {Promise<void>}
   */
  async refresh(): Promise<void> {
    this._loading.set(true);
    try {
      this._summary.set(await this._api.get<AiUsageSummary>('ai/usage'));
    } catch {
      this._summary.set(null);
    } finally {
      this._loading.set(false);
    }
  }
}
