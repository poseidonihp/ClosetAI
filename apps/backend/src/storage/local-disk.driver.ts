import { Injectable } from '@nestjs/common';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join, posix, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  StorageDriver,
  type IReadFile,
  type ISaveFileOptions,
  type IStoredFile,
} from './storage.driver';

const mediaEndpointPath = '/api/media';
const defaultMimeType = 'application/octet-stream';

const extensionByMimeType: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
};

const mimeTypeByExtension: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
};

/**
 * Driver de desarrollo: guarda los archivos en disco bajo `STORAGE_ROOT`.
 * No expone la carpeta por HTTP; leer un archivo pasa siempre por el endpoint
 * autenticado que valida propiedad antes de llamar a `read`.
 * @class
 */
@Injectable()
export class LocalDiskDriver extends StorageDriver {
  private readonly _root: string;

  /**
   * Resuelve la raíz de almacenamiento desde el entorno.
   * @constructor
   */
  constructor() {
    super();
    // `||` y no `??`: un STORAGE_ROOT vacío debe caer al default, porque
    // resolve('') devolvería el CWD y los archivos acabarían dentro de apps/backend.
    const fromEnv = process.env.STORAGE_ROOT;
    this._root = resolve(fromEnv || join(process.cwd(), '..', '..', 'storage', 'uploads'));
  }

  /** Raíz absoluta donde el driver escribe. */
  get rootPath(): string {
    return this._root;
  }

  /**
   * Guarda un archivo bajo `userId/entityId/<uuid><ext>`.
   * @param {ISaveFileOptions} options - Datos del archivo y su propietario.
   * @returns {Promise<IStoredFile>}
   */
  async save(options: ISaveFileOptions): Promise<IStoredFile> {
    const extension =
      extname(options.filename).toLowerCase() ||
      (extensionByMimeType[options.mimeType] ?? '');
    const key = posix.join(options.userId, options.entityId, `${randomUUID()}${extension}`);
    const absolutePath = join(this._root, key);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, options.buffer);
    return {
      key,
      mimeType: options.mimeType,
      byteSize: options.buffer.byteLength,
    };
  }

  /**
   * Lee un archivo por su key. Devuelve null si no existe o si la key intenta
   * salirse de la raíz del driver.
   * @param {string} key - Key relativa del archivo.
   * @returns {Promise<IReadFile | null>}
   */
  async read(key: string): Promise<IReadFile | null> {
    const absolutePath = this._resolveInsideRoot(key);
    if (!absolutePath) {
      return null;
    }
    try {
      const [buffer, stats] = await Promise.all([readFile(absolutePath), stat(absolutePath)]);
      return {
        buffer,
        mimeType: mimeTypeByExtension[extname(absolutePath).toLowerCase()] ?? defaultMimeType,
        byteSize: stats.size,
      };
    } catch (error) {
      if (LocalDiskDriver._isMissingFile(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Borra un archivo. Un archivo inexistente no es un error.
   * @param {string} key - Key relativa del archivo.
   * @returns {Promise<void>}
   */
  async delete(key: string): Promise<void> {
    const absolutePath = this._resolveInsideRoot(key);
    if (!absolutePath) {
      return;
    }
    try {
      await unlink(absolutePath);
    } catch (error) {
      if (!LocalDiskDriver._isMissingFile(error)) {
        throw error;
      }
    }
  }

  /**
   * URL autenticada desde la que el cliente puede leer el archivo.
   * @param {string} key - Key relativa del archivo.
   * @returns {string}
   */
  urlFor(key: string): string {
    return `${mediaEndpointPath}?key=${encodeURIComponent(key.replaceAll('\\', '/'))}`;
  }

  /**
   * Convierte una key en ruta absoluta y comprueba que no escape de la raíz.
   * @private
   * @param {string} key - Key relativa del archivo.
   * @returns {string | null}
   */
  private _resolveInsideRoot(key: string): string | null {
    if (!key) {
      return null;
    }
    const absolutePath = resolve(this._root, key);
    const relativePath = relative(this._root, absolutePath);
    const escapesRoot =
      relativePath.length === 0 ||
      relativePath.startsWith('..') ||
      relativePath.startsWith(`..${sep}`);
    return escapesRoot ? null : absolutePath;
  }

  /**
   * Indica si el error corresponde a un archivo inexistente.
   * @private
   * @param {unknown} error - Error capturado.
   * @returns {boolean}
   */
  private static _isMissingFile(error: unknown): boolean {
    return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
  }
}
