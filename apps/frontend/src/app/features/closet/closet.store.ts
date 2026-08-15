import { Injectable, computed, inject, signal } from '@angular/core';
import type {
  CreateGarment,
  Garment,
  TagGarmentResponse,
  UpdateGarment,
} from '@closetai/shared-types';
import { ApiClient } from '../../core/http/api.client';

/**
 * Clóset del usuario en memoria. Se trae entero una vez —un armario personal son
 * decenas de prendas, no millones— y los filtros de la página trabajan sobre esa
 * copia, así que cambiar de filtro es instantáneo y no genera tráfico.
 * @class
 */
@Injectable({ providedIn: 'root' })
export class ClosetStore {
  private readonly _api = inject(ApiClient);

  private readonly _garments = signal<Garment[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private _loaded = false;

  readonly garments = this._garments.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly isEmpty = computed(() => this._loaded && this._garments().length === 0);

  /**
   * Carga el clóset. Repetir la llamada no vuelve a pedirlo salvo `force`.
   * @param {boolean} [force=false] - Fuerza recargar aunque ya esté cargado.
   * @returns {Promise<void>}
   */
  async load(force = false): Promise<void> {
    if (this._loaded && !force) {
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    try {
      this._garments.set(await this._api.get<Garment[]>('garments'));
      this._loaded = true;
    } catch (error) {
      this._error.set(ApiClient.messageFromError(error));
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Crea una prenda y la coloca al principio del clóset.
   * @param {CreateGarment} dto - Atributos de la prenda.
   * @returns {Promise<Garment>}
   */
  async create(dto: CreateGarment): Promise<Garment> {
    const created = await this._api.post<Garment>('garments', dto);
    this._garments.update(list => [created, ...list]);
    return created;
  }

  /**
   * Crea el hueco al que colgar la foto que va a etiquetar la IA. Nace en
   * `PENDING` y no cuenta como prenda del clóset hasta que se confirma, pero se
   * añade al estado local para que sus fotos y su etiquetado tengan dónde vivir.
   * @param {string | null} name - Nombre provisional, si el usuario escribió uno.
   * @returns {Promise<Garment>}
   */
  async createDraft(name: string | null): Promise<Garment> {
    const created = await this._api.post<Garment>('garments/draft', { name });
    this._garments.update(list => [created, ...list]);
    return created;
  }

  /**
   * Actualiza una prenda existente.
   * @param {string} garmentId - Identificador de la prenda.
   * @param {UpdateGarment} dto - Campos a modificar.
   * @returns {Promise<Garment>}
   */
  async update(garmentId: string, dto: UpdateGarment): Promise<Garment> {
    return this._replace(await this._api.patch<Garment>(`garments/${garmentId}`, dto));
  }

  /**
   * Pide el etiquetado por visión de una prenda.
   * @param {string} garmentId - Identificador de la prenda.
   * @param {boolean} [force=false] - Volver a llamar al modelo aunque ya haya
   * un borrador, pisando también lo corregido a mano.
   * @returns {Promise<TagGarmentResponse>}
   */
  async tag(garmentId: string, force = false): Promise<TagGarmentResponse> {
    const response = await this._api.post<TagGarmentResponse>(`garments/${garmentId}/tagging`, {
      force,
    });
    this._replace(response.garment);
    return response;
  }

  /**
   * Guarda las correcciones sobre el borrador y confirma la prenda.
   * @param {string} garmentId - Identificador de la prenda.
   * @param {UpdateGarment} dto - Atributos finales.
   * @returns {Promise<Garment>}
   */
  async confirmTagging(garmentId: string, dto: UpdateGarment): Promise<Garment> {
    return this._replace(
      await this._api.post<Garment>(`garments/${garmentId}/tagging/confirm`, dto),
    );
  }

  /**
   * Borra una prenda del servidor y del estado local.
   * @param {string} garmentId - Identificador de la prenda.
   * @returns {Promise<void>}
   */
  async remove(garmentId: string): Promise<void> {
    await this._api.delete<void>(`garments/${garmentId}`);
    this._garments.update(list => list.filter(garment => garment.id !== garmentId));
  }

  /**
   * Sube una foto a una prenda. El servidor devuelve la prenda completa ya
   * actualizada, así que no hace falta recargar el clóset.
   * @param {string} garmentId - Identificador de la prenda.
   * @param {Blob} file - Imagen ya comprimida en el cliente.
   * @param {string} filename - Nombre con el que viaja el archivo.
   * @returns {Promise<Garment>}
   */
  async uploadPhoto(garmentId: string, file: Blob, filename: string): Promise<Garment> {
    const form = new FormData();
    form.append('file', file, filename);
    return this._replace(await this._api.postForm<Garment>(`garments/${garmentId}/photos`, form));
  }

  /**
   * Borra una foto de una prenda.
   * @param {string} garmentId - Identificador de la prenda.
   * @param {string} photoId - Identificador de la foto.
   * @returns {Promise<Garment>}
   */
  async removePhoto(garmentId: string, photoId: string): Promise<Garment> {
    return this._replace(
      await this._api.delete<Garment>(`garments/${garmentId}/photos/${photoId}`),
    );
  }

  /**
   * Marca una foto como principal.
   * @param {string} garmentId - Identificador de la prenda.
   * @param {string} photoId - Identificador de la foto.
   * @returns {Promise<Garment>}
   */
  async setPrimaryPhoto(garmentId: string, photoId: string): Promise<Garment> {
    return this._replace(
      await this._api.patch<Garment>(`garments/${garmentId}/photos/${photoId}/primary`, {}),
    );
  }

  /**
   * Sustituye una prenda en la lista conservando su posición.
   * @private
   * @param {Garment} garment - Prenda ya actualizada por el servidor.
   * @returns {Garment}
   */
  private _replace(garment: Garment): Garment {
    this._garments.update(list =>
      list.map(current => (current.id === garment.id ? garment : current)),
    );
    return garment;
  }
}
