/**
 * Contrato de almacenamiento de archivos.
 *
 * Las imágenes son privadas: no existe una carpeta pública servida por el
 * backend. El cliente pide siempre `urlFor(key)`, que hoy apunta al endpoint
 * autenticado `/api/media` y mañana puede devolver una URL firmada de un bucket
 * compatible con S3 sin tocar los módulos de dominio.
 */

/** Archivo ya guardado, identificado por su key relativa a la raíz del driver. */
export interface IStoredFile {
  /** Key relativa con forma `userId/entityId/archivo.ext`. */
  key: string;
  mimeType: string;
  byteSize: number;
}

export interface ISaveFileOptions {
  userId: string;
  entityId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}

/** Contenido leído de disco/bucket, listo para responder por HTTP. */
export interface IReadFile {
  buffer: Buffer;
  mimeType: string;
  byteSize: number;
}

export abstract class StorageDriver {
  abstract save(options: ISaveFileOptions): Promise<IStoredFile>;
  abstract read(key: string): Promise<IReadFile | null>;
  abstract delete(key: string): Promise<void>;
  abstract urlFor(key: string): string;
}
