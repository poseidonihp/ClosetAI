import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

const jsonHeaders = new HttpHeaders({
  'Content-Type': 'application/json',
  Accept: 'application/json',
});

const unknownErrorMessage = 'Error desconocido';

interface IApiErrorBody {
  message?: string | string[];
  errors?: { path?: string; message?: string }[];
}

type QueryParams = Record<string, string | number | boolean | undefined | null>;

/**
 * Envoltorio sobre HttpClient con baseUrl relativa (el proxy de Angular resuelve
 * /api). Centraliza credenciales y el formateo de errores. Ningún componente
 * inyecta HttpClient directamente.
 * @class
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly _http = inject(HttpClient);

  /**
   * GET con parámetros opcionales.
   * @param {string} path - Ruta relativa (sin `/api/`) o absoluta si empieza por `/`.
   * @param {QueryParams} [params] - Parámetros de consulta.
   * @returns {Promise<T>}
   */
  get<T>(path: string, params?: QueryParams): Promise<T> {
    return firstValueFrom(
      this._http.get<T>(this._url(path), {
        params: ApiClient._toParams(params),
        withCredentials: true,
      }),
    );
  }

  /**
   * POST con cuerpo JSON.
   * @param {string} path - Ruta relativa.
   * @param {unknown} [body] - Cuerpo de la petición.
   * @returns {Promise<T>}
   */
  post<T>(path: string, body?: unknown): Promise<T> {
    return firstValueFrom(
      this._http.post<T>(this._url(path), body ?? {}, {
        headers: jsonHeaders,
        withCredentials: true,
      }),
    );
  }

  /**
   * PATCH con cuerpo JSON.
   * @param {string} path - Ruta relativa.
   * @param {unknown} [body] - Cuerpo de la petición.
   * @returns {Promise<T>}
   */
  patch<T>(path: string, body?: unknown): Promise<T> {
    return firstValueFrom(
      this._http.patch<T>(this._url(path), body ?? {}, {
        headers: jsonHeaders,
        withCredentials: true,
      }),
    );
  }

  /**
   * DELETE.
   * @param {string} path - Ruta relativa.
   * @returns {Promise<T>}
   */
  delete<T>(path: string): Promise<T> {
    return firstValueFrom(this._http.delete<T>(this._url(path), { withCredentials: true }));
  }

  /**
   * POST multipart (subida de archivos). El navegador pone el boundary.
   * @param {string} path - Ruta relativa.
   * @param {FormData} form - Formulario con los archivos.
   * @returns {Promise<T>}
   */
  postForm<T>(path: string, form: FormData): Promise<T> {
    return firstValueFrom(this._http.post<T>(this._url(path), form, { withCredentials: true }));
  }

  /**
   * Devuelve la URL relativa al origen, útil para `src` de imágenes o descargas.
   * @param {string} path - Ruta relativa.
   * @returns {string}
   */
  absoluteUrl(path: string): string {
    return this._url(path);
  }

  /**
   * Extrae un mensaje legible de cualquier error de red o de validación.
   * @param {unknown} error - Error capturado.
   * @returns {string}
   */
  static messageFromError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      return ApiClient._messageFromHttpError(error);
    }
    return error instanceof Error ? error.message : unknownErrorMessage;
  }

  /**
   * Traduce una respuesta HTTP de error al mensaje que ve el usuario.
   * @private
   * @param {HttpErrorResponse} error - Error HTTP de Angular.
   * @returns {string}
   */
  private static _messageFromHttpError(error: HttpErrorResponse): string {
    const body = error.error as IApiErrorBody | string | null;
    if (typeof body === 'string') {
      return body;
    }
    if (!body) {
      return error.message;
    }
    const detailed = ApiClient._formatErrorDetails(body);
    if (detailed) {
      return detailed;
    }
    if (typeof body.message === 'string') {
      return body.message;
    }
    if (Array.isArray(body.message)) {
      return body.message.join('; ');
    }
    return error.message;
  }

  /**
   * Concatena los errores de validación de Zod devueltos por el backend.
   * @private
   * @param {IApiErrorBody} body - Cuerpo del error.
   * @returns {string | null}
   */
  private static _formatErrorDetails(body: IApiErrorBody): string | null {
    if (!Array.isArray(body.errors) || body.errors.length === 0) {
      return null;
    }
    const details = body.errors
      .map(item => ApiClient._formatErrorItem(item))
      .filter(text => text.length > 0)
      .join('; ');
    if (!details) {
      return null;
    }
    const head = typeof body.message === 'string' ? `${body.message} — ` : '';
    return `${head}${details}`;
  }

  /**
   * Formatea un error de validación individual como `campo: mensaje`.
   * @private
   * @param {{ path?: string; message?: string }} item - Error de validación.
   * @returns {string}
   */
  private static _formatErrorItem(item: { path?: string; message?: string }): string {
    const message = item.message ?? '';
    return item.path ? `${item.path}: ${message}`.trim() : message;
  }

  /**
   * Prefija `/api/` salvo que la ruta ya sea absoluta.
   * @private
   * @param {string} path - Ruta pedida por el llamante.
   * @returns {string}
   */
  private _url(path: string): string {
    if (path.startsWith('/')) {
      return path;
    }
    return `/api/${path}`;
  }

  /**
   * Convierte un objeto plano en HttpParams descartando vacíos.
   * @private
   * @param {QueryParams} [source] - Parámetros de consulta.
   * @returns {HttpParams | undefined}
   */
  private static _toParams(source: QueryParams | undefined): HttpParams | undefined {
    if (!source) {
      return undefined;
    }
    return Object.entries(source)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .reduce((params, [key, value]) => params.set(key, String(value)), new HttpParams());
  }
}
