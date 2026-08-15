/**
 * Compresión de las fotos antes de subirlas.
 */

const bytesPerMegabyte = 1024 * 1024;
/** Por debajo de este tamaño no compensa recodificar. */
const compressionThresholdBytes = 1.2 * bytesPerMegabyte;
const maxUploadDimensionPx = 1600;
const webpQuality = 0.85;
const webpMimeType = 'image/webp';
const webpExtension = '.webp';

export interface IUploadPayload {
  blob: Blob;
  filename: string;
}

/**
 * Reduce una foto a WebP de 1600 px como máximo. Devuelve el archivo original
 * si ya es pequeño o si el navegador no puede procesarlo.
 * @param {File} file - Archivo elegido por el usuario.
 * @returns {Promise<IUploadPayload>}
 */
export async function compressForUpload(file: File): Promise<IUploadPayload> {
  const original: IUploadPayload = { blob: file, filename: file.name };
  if (file.size <= compressionThresholdBytes) {
    return original;
  }
  try {
    const compressed = await encodeScaledWebp(file);
    return compressed && compressed.size < file.size
      ? { blob: compressed, filename: toWebpName(file.name) }
      : original;
  } catch {
    return original;
  }
}

/**
 * Decodifica, reescala y codifica a WebP mediante canvas.
 * @param {File} file - Archivo elegido por el usuario.
 * @returns {Promise<Blob | null>}
 */
async function encodeScaledWebp(file: File): Promise<Blob | null> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, maxUploadDimensionPx / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await toBlob(canvas);
  } finally {
    bitmap.close();
  }
}

/**
 * Promisifica `canvas.toBlob`.
 * @param {HTMLCanvasElement} canvas - Lienzo ya dibujado.
 * @returns {Promise<Blob | null>}
 */
function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob), webpMimeType, webpQuality);
  });
}

/**
 * Cambia la extensión del nombre original por `.webp`.
 * @param {string} filename - Nombre original del archivo.
 * @returns {string}
 */
function toWebpName(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  const base = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  return `${base}${webpExtension}`;
}
