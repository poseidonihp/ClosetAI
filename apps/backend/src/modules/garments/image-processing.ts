import sharp from 'sharp';

/**
 * Normalización de las fotos de prenda. Es código puro y sin dependencias de
 * Nest ni de base de datos, para poder probarlo con buffers sintéticos.
 */

export const maxImageDimensionPx = 1600;
export const thumbDimensionPx = 400;
export const processedMimeType = 'image/webp';

const originalWebpQuality = 82;
const thumbWebpQuality = 74;
const minImageDimensionPx = 48;

/** Formatos que `sharp` reconoce y aceptamos. `heif` es como reporta el AVIF. */
const acceptedImageFormats = new Set(['jpeg', 'png', 'webp', 'avif', 'heif']);

export interface IProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
  byteSize: number;
}

export interface IProcessedGarmentImage {
  original: IProcessedImage;
  thumb: IProcessedImage;
}

/** El binario recibido no es una imagen utilizable. El controlador lo traduce a 400. */
export class InvalidImageError extends Error {
  /**
   * Construye el error con un mensaje ya legible para el usuario.
   * @constructor
   * @param {string} message - Motivo del rechazo, en español.
   */
  constructor(message: string) {
    super(message);
    this.name = 'InvalidImageError';
  }
}

/**
 * Valida el binario y devuelve la imagen principal y su miniatura en WebP.
 * El formato se deduce del contenido, no del `Content-Type` que declaró el
 * cliente: un `.jpg` que en realidad es un script no pasa de aquí.
 * @param {Buffer} input - Binario tal como llegó en el multipart.
 * @returns {Promise<IProcessedGarmentImage>}
 */
export async function processGarmentImage(input: Buffer): Promise<IProcessedGarmentImage> {
  await assertUsableImage(input);
  const [original, thumb] = await Promise.all([
    toWebp(input, maxImageDimensionPx, originalWebpQuality),
    toWebp(input, thumbDimensionPx, thumbWebpQuality),
  ]);
  return { original, thumb };
}

/**
 * Comprueba que el buffer sea una imagen de un formato soportado y con un tamaño
 * mínimo razonable.
 * @param {Buffer} input - Binario recibido.
 * @returns {Promise<void>}
 */
async function assertUsableImage(input: Buffer): Promise<void> {
  let format: string | undefined;
  let width: number | undefined;
  let height: number | undefined;
  try {
    ({ format, width, height } = await sharp(input).metadata());
  } catch {
    throw new InvalidImageError('El archivo no es una imagen que podamos leer');
  }

  if (!format || !acceptedImageFormats.has(format)) {
    throw new InvalidImageError('Formato de imagen no soportado. Usa JPG, PNG, WebP o AVIF');
  }
  if (!width || !height || width < minImageDimensionPx || height < minImageDimensionPx) {
    throw new InvalidImageError(
      `La imagen es demasiado pequeña: mínimo ${minImageDimensionPx} px por lado`,
    );
  }
}

/**
 * Reescala manteniendo la proporción y codifica a WebP. Nunca amplía: una foto
 * de 300 px sale de 300 px, no interpolada a 1600.
 * @param {Buffer} input - Binario recibido.
 * @param {number} maxDimensionPx - Lado mayor máximo del resultado.
 * @param {number} quality - Calidad WebP entre 1 y 100.
 * @returns {Promise<IProcessedImage>}
 */
async function toWebp(
  input: Buffer,
  maxDimensionPx: number,
  quality: number,
): Promise<IProcessedImage> {
  const { data, info } = await sharp(input)
    .rotate()
    .resize({
      width: maxDimensionPx,
      height: maxDimensionPx,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality })
    .toBuffer({ resolveWithObject: true });

  return { buffer: data, width: info.width, height: info.height, byteSize: info.size };
}
