import { Injectable, inject, signal } from '@angular/core';
import type { StyleProfile, UpdateStyleProfile } from '@closetai/shared-types';
import { ApiClient } from '../../core/http/api.client';

/**
 * Perfil de estilo del usuario. El backend lo crea vacío la primera vez, así que
 * aquí no hay estado "todavía no existe": o está cargando, o hay perfil.
 * @class
 */
@Injectable({ providedIn: 'root' })
export class ProfileStore {
  private readonly _api = inject(ApiClient);

  private readonly _profile = signal<StyleProfile | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly profile = this._profile.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /**
   * Carga el perfil del usuario.
   * @param {boolean} [force=false] - Recarga aunque ya esté en memoria.
   * @returns {Promise<void>}
   */
  async load(force = false): Promise<void> {
    if (this._profile() && !force) {
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    try {
      this._profile.set(await this._api.get<StyleProfile>('profile'));
    } catch (error) {
      this._error.set(ApiClient.messageFromError(error));
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Guarda los cambios del perfil.
   * @param {UpdateStyleProfile} dto - Campos a modificar.
   * @returns {Promise<StyleProfile>}
   */
  async save(dto: UpdateStyleProfile): Promise<StyleProfile> {
    const saved = await this._api.patch<StyleProfile>('profile', dto);
    this._profile.set(saved);
    return saved;
  }
}
