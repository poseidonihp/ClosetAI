import { Injectable, computed, inject, signal } from '@angular/core';
import type { GarmentSlot, GarmentType } from '@closetai/shared-types';
import { ApiClient } from '../../core/http/api.client';

/**
 * Catálogo de tipos de prenda. Es global e inmutable durante la sesión, así que
 * se carga una vez y se comparte entre el clóset y el perfil.
 * @class
 */
@Injectable({ providedIn: 'root' })
export class GarmentTypesStore {
  private readonly _api = inject(ApiClient);

  private readonly _types = signal<GarmentType[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private _loadPromise: Promise<void> | null = null;

  readonly types = this._types.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /** Tipos indexados por id, para resolver el nombre de una prenda. */
  readonly byId = computed(() => new Map(this._types().map(type => [type.id, type])));

  /** Tipos agrupados por slot, en el orden del catálogo. */
  readonly bySlot = computed(() => {
    const groups = new Map<GarmentSlot, GarmentType[]>();
    for (const type of this._types()) {
      const group = groups.get(type.slot);
      if (group) {
        group.push(type);
      } else {
        groups.set(type.slot, [type]);
      }
    }
    return groups;
  });

  /**
   * Carga el catálogo una sola vez; las llamadas concurrentes comparten petición.
   * @returns {Promise<void>}
   */
  load(): Promise<void> {
    this._loadPromise ??= this._fetch();
    return this._loadPromise;
  }

  /**
   * Pide el catálogo al backend y deja el error a mano si falla.
   * @private
   * @returns {Promise<void>}
   */
  private async _fetch(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      this._types.set(await this._api.get<GarmentType[]>('garment-types'));
    } catch (error) {
      this._loadPromise = null;
      this._error.set(ApiClient.messageFromError(error));
    } finally {
      this._loading.set(false);
    }
  }
}
