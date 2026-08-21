import { Injectable, computed, inject, signal } from '@angular/core';
import type {
  AnalyzeGapsResponse,
  CoverageResponse,
  WardrobeCoverage,
  WardrobeGap,
  WardrobeGapStatus,
} from '@closetai/shared-types';
import { AiUsageStore } from '../../core/ai/ai-usage.store';
import { ApiClient } from '../../core/http/api.client';

/**
 * Brechas del clóset y su cobertura.
 * @class
 */
@Injectable({ providedIn: 'root' })
export class GapsStore {
  private readonly _api = inject(ApiClient);
  private readonly _usage = inject(AiUsageStore);

  private readonly _gaps = signal<WardrobeGap[]>([]);
  private readonly _coverage = signal<WardrobeCoverage | null>(null);
  private readonly _note = signal<string | null>(null);
  private readonly _discarded = signal<string[]>([]);
  private readonly _lastCostUsd = signal<number | null>(null);
  private readonly _loading = signal(false);
  private readonly _analyzing = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly gaps = this._gaps.asReadonly();
  readonly coverage = this._coverage.asReadonly();
  /** Lo que encontró el cálculo, con la voz del modelo si llegó a hablar. */
  readonly note = this._note.asReadonly();
  /** Lo que el modelo propuso y el servidor no aceptó, con el motivo. */
  readonly discarded = this._discarded.asReadonly();
  readonly lastCostUsd = this._lastCostUsd.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly analyzing = this._analyzing.asReadonly();
  readonly error = this._error.asReadonly();

  /** Brechas todavía por decidir: son la lista de la compra propiamente dicha. */
  readonly openGaps = computed(() => this._gaps().filter(gap => gap.status === 'OPEN'));
  /** Brechas que el usuario ya compró o descartó. */
  readonly resolvedGaps = computed(() => this._gaps().filter(gap => gap.status !== 'OPEN'));

  /**
   * Carga las brechas guardadas y la cobertura actual. Las dos peticiones son
   * gratis: ninguna llama al proveedor de IA.
   * @returns {Promise<void>}
   */
  async load(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const [gaps, coverage] = await Promise.all([
        this._api.get<WardrobeGap[]>('wardrobe-gaps'),
        this._api.get<CoverageResponse>('wardrobe-gaps/coverage'),
      ]);
      this._gaps.set(gaps);
      this._coverage.set(coverage.coverage);
      this._note.set(coverage.note);
    } catch (error) {
      this._error.set(ApiClient.messageFromError(error));
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Analiza el clóset con IA. El resultado sustituye la lista pendiente; lo que
   * el usuario ya resolvió se conserva.
   * @returns {Promise<AnalyzeGapsResponse | null>}
   */
  async analyze(): Promise<AnalyzeGapsResponse | null> {
    if (this._analyzing()) {
      return null;
    }
    this._analyzing.set(true);
    this._error.set(null);
    try {
      const response = await this._api.post<AnalyzeGapsResponse>('wardrobe-gaps/analyze', {});
      this._gaps.update(list => [...response.gaps, ...list.filter(gap => gap.status !== 'OPEN')]);
      this._coverage.set(response.coverage);
      this._note.set(response.note);
      this._discarded.set(response.discarded);
      this._lastCostUsd.set(response.costUsd);
      await this._usage.refresh();
      return response;
    } catch (error) {
      this._error.set(ApiClient.messageFromError(error));
      return null;
    } finally {
      this._analyzing.set(false);
    }
  }

  /**
   * Registra lo que el usuario decidió sobre una brecha.
   * @param {string} gapId - Brecha afectada.
   * @param {WardrobeGapStatus} status - Nuevo estado.
   * @returns {Promise<WardrobeGap>}
   */
  async updateStatus(gapId: string, status: WardrobeGapStatus): Promise<WardrobeGap> {
    const updated = await this._api.patch<WardrobeGap>(`wardrobe-gaps/${gapId}`, { status });
    this._gaps.update(list => list.map(gap => (gap.id === updated.id ? updated : gap)));
    return updated;
  }
}
