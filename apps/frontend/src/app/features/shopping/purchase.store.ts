import { Injectable, computed, inject, signal } from '@angular/core';
import type {
  EvaluatePurchaseResponse,
  PurchaseCandidate,
  PurchaseMeasurement,
} from '@closetai/shared-types';
import { AiUsageStore } from '../../core/ai/ai-usage.store';
import { ApiClient } from '../../core/http/api.client';
import type { IPurchaseBusy, PurchaseAction } from './shopping.types';

/**
 * Las prendas que el usuario está pensando comprar y su veredicto.
 *
 * Es historial, no una tanda: una prenda que valoraste se consulta días después,
 * así que se recupera al entrar, igual que la lista de la compra y al revés que
 * la página de looks.
 * @class
 */
@Injectable({ providedIn: 'root' })
export class PurchaseStore {
  private readonly _api = inject(ApiClient);
  private readonly _usage = inject(AiUsageStore);

  private readonly _candidates = signal<PurchaseCandidate[]>([]);
  private readonly _measurements = signal<Record<string, PurchaseMeasurement>>({});
  private readonly _loading = signal(false);
  private readonly _busy = signal<IPurchaseBusy | null>(null);
  private readonly _error = signal<string | null>(null);
  private readonly _lastCostUsd = signal<number | null>(null);

  readonly candidates = this._candidates.asReadonly();
  /** Mediciones gratis ya pedidas, por prenda. No sobreviven a la recarga. */
  readonly measurements = this._measurements.asReadonly();
  readonly loading = this._loading.asReadonly();
  /** Qué candidata tiene algo en vuelo y qué se está haciendo con ella. */
  readonly busy = this._busy.asReadonly();
  readonly error = this._error.asReadonly();
  readonly lastCostUsd = this._lastCostUsd.asReadonly();

  /** Candidatas todavía sin decidir: son las que están sobre la mesa. */
  readonly openCandidates = computed(() =>
    this._candidates().filter(candidate => (candidate.advice?.status ?? 'OPEN') === 'OPEN'),
  );
  /** Candidatas que el usuario ya compró o descartó. */
  readonly resolvedCandidates = computed(() =>
    this._candidates().filter(candidate => (candidate.advice?.status ?? 'OPEN') !== 'OPEN'),
  );

  /**
   * Carga las candidatas guardadas con su veredicto. Es gratis: no llama al
   * proveedor de IA.
   * @returns {Promise<void>}
   */
  async load(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      this._candidates.set(await this._api.get<PurchaseCandidate[]>('purchase-advice'));
    } catch (error) {
      this._error.set(ApiClient.messageFromError(error));
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Mide una candidata contra el clóset. Es determinista y no cuesta nada.
   * @param {string} garmentId - Candidata a medir.
   * @returns {Promise<PurchaseMeasurement | null>}
   */
  async measure(garmentId: string): Promise<PurchaseMeasurement | null> {
    return this._run(garmentId, 'measure', async () => {
      const measurement = await this._api.get<PurchaseMeasurement>(
        `purchase-advice/measure/${garmentId}`,
      );
      this._rememberMeasurement(measurement);
      return measurement;
    });
  }

  /**
   * Pide el veredicto redactado. Sobre una prenda y un clóset que no cambiaron
   * reaplica el guardado sin volver a pagarlo.
   * @param {string} garmentId - Candidata a evaluar.
   * @returns {Promise<EvaluatePurchaseResponse | null>}
   */
  async evaluate(garmentId: string): Promise<EvaluatePurchaseResponse | null> {
    const response = await this._run(garmentId, 'evaluate', async () => {
      const result = await this._api.post<EvaluatePurchaseResponse>(
        `purchase-advice/${garmentId}/evaluate`,
        {},
      );
      this._rememberMeasurement(result.measurement);
      if (result.advice !== null) {
        this._replaceAdvice(garmentId, result.advice);
      }
      this._lastCostUsd.set(result.costUsd);
      return result;
    });
    if (response) {
      await this._usage.refresh();
    }
    return response;
  }

  /**
   * Registra que el usuario descarta la candidata o vuelve a dudarla.
   * @param {string} garmentId - Candidata afectada.
   * @param {'OPEN' | 'DISMISSED'} status - Nuevo estado.
   * @returns {Promise<boolean>}
   */
  async updateStatus(garmentId: string, status: 'OPEN' | 'DISMISSED'): Promise<boolean> {
    const updated = await this._run(garmentId, 'status', () =>
      this._api.patch<PurchaseCandidate['advice']>(`purchase-advice/${garmentId}`, { status }),
    );
    if (!updated) {
      return false;
    }
    this._replaceAdvice(garmentId, updated);
    return true;
  }

  /**
   * Borra la candidata y todo lo suyo. Es la prenda la que se borra: el veredicto
   * cae con ella, que es lo que quiere quien deja de plantearse una compra.
   * @param {string} garmentId - Candidata a borrar.
   * @returns {Promise<boolean>}
   */
  async remove(garmentId: string): Promise<boolean> {
    const removed = await this._run(garmentId, 'remove', async () => {
      await this._api.delete<void>(`garments/${garmentId}`);
      return true;
    });
    if (removed) {
      this._candidates.update(list => list.filter(item => item.garment.id !== garmentId));
    }
    return removed === true;
  }

  /**
   * Olvida el veredicto de una prenda que ya compró: la saca de esta pantalla y
   * **no** la borra del clóset, donde ya vive como una prenda más.
   * @param {string} garmentId - Prenda cuyo veredicto se olvida.
   * @returns {Promise<boolean>}
   */
  async forget(garmentId: string): Promise<boolean> {
    const forgotten = await this._run(garmentId, 'remove', async () => {
      await this._api.delete<void>(`purchase-advice/${garmentId}`);
      return true;
    });
    if (forgotten) {
      this._candidates.update(list => list.filter(item => item.garment.id !== garmentId));
    }
    return forgotten === true;
  }

  /**
   * Ejecuta una acción sobre una candidata anotando cuál es, para que la pantalla
   * pueda decir qué está esperando y no sólo que espera.
   * @private
   * @param {string} garmentId - Candidata afectada.
   * @param {PurchaseAction} action - Qué se está haciendo con ella.
   * @param {() => Promise<T>} run - Lo que hay que hacer.
   * @returns {Promise<T | null>}
   */
  private async _run<T>(
    garmentId: string,
    action: PurchaseAction,
    run: () => Promise<T>,
  ): Promise<T | null> {
    if (this._busy() !== null) {
      return null;
    }
    this._busy.set({ garmentId, action });
    this._error.set(null);
    try {
      return await run();
    } catch (error) {
      this._error.set(ApiClient.messageFromError(error));
      return null;
    } finally {
      this._busy.set(null);
    }
  }

  /**
   * Guarda la última medición de una candidata.
   * @private
   * @param {PurchaseMeasurement} measurement - Medición recién calculada.
   * @returns {void}
   */
  private _rememberMeasurement(measurement: PurchaseMeasurement): void {
    this._measurements.update(current => ({ ...current, [measurement.garmentId]: measurement }));
  }

  /**
   * Sustituye el veredicto de una candidata conservando su posición.
   * @private
   * @param {string} garmentId - Candidata afectada.
   * @param {PurchaseCandidate['advice']} advice - Veredicto nuevo, o null si no hay.
   * @returns {void}
   */
  private _replaceAdvice(garmentId: string, advice: PurchaseCandidate['advice']): void {
    this._candidates.update(list =>
      list.map(item => (item.garment.id === garmentId ? { ...item, advice } : item)),
    );
  }
}
