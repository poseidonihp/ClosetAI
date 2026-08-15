import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  InvalidImageError,
  maxImageDimensionPx,
  processGarmentImage,
  thumbDimensionPx,
} from './image-processing';

const backgroundColor = { r: 60, g: 95, b: 150 };

/**
 * Genera un JPEG sintético del tamaño pedido.
 * @param {number} width - Ancho en píxeles.
 * @param {number} height - Alto en píxeles.
 * @returns {Promise<Buffer>}
 */
function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: backgroundColor } })
    .jpeg()
    .toBuffer();
}

describe('processGarmentImage', () => {
  it('devuelve original y miniatura en WebP', async () => {
    const processed = await processGarmentImage(await jpeg(900, 1200));

    const originalMeta = await sharp(processed.original.buffer).metadata();
    const thumbMeta = await sharp(processed.thumb.buffer).metadata();
    expect(originalMeta.format).toBe('webp');
    expect(thumbMeta.format).toBe('webp');
    expect(processed.original.byteSize).toBe(processed.original.buffer.byteLength);
  });

  it('acota el lado mayor de la original y de la miniatura', async () => {
    const processed = await processGarmentImage(await jpeg(4000, 3000));

    expect(processed.original.width).toBe(maxImageDimensionPx);
    expect(processed.original.height).toBe(Math.round((maxImageDimensionPx * 3000) / 4000));
    expect(processed.thumb.width).toBe(thumbDimensionPx);
  });

  it('no amplía una foto pequeña', async () => {
    const processed = await processGarmentImage(await jpeg(300, 300));

    expect(processed.original.width).toBe(300);
    expect(processed.thumb.width).toBe(300);
  });

  it('elimina el EXIF, incluida la geolocalización', async () => {
    const withExif = await sharp({
      create: { width: 800, height: 800, channels: 3, background: backgroundColor },
    })
      .withMetadata({ exif: { IFD0: { Copyright: 'prueba' }, IFD3: { GPSLatitudeRef: 'N' } } })
      .jpeg()
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const processed = await processGarmentImage(withExif);

    expect((await sharp(processed.original.buffer).metadata()).exif).toBeUndefined();
    expect((await sharp(processed.thumb.buffer).metadata()).exif).toBeUndefined();
  });

  it('rechaza un binario que no es una imagen', async () => {
    await expect(processGarmentImage(Buffer.from('esto no es una imagen'))).rejects.toBeInstanceOf(
      InvalidImageError,
    );
  });

  it('rechaza una imagen demasiado pequeña para servir de foto', async () => {
    await expect(processGarmentImage(await jpeg(16, 16))).rejects.toBeInstanceOf(InvalidImageError);
  });

  it('acepta PNG y WebP además de JPEG', async () => {
    const png = await sharp({
      create: { width: 500, height: 500, channels: 3, background: backgroundColor },
    })
      .png()
      .toBuffer();
    const webp = await sharp({
      create: { width: 500, height: 500, channels: 3, background: backgroundColor },
    })
      .webp()
      .toBuffer();

    await expect(processGarmentImage(png)).resolves.toBeDefined();
    await expect(processGarmentImage(webp)).resolves.toBeDefined();
  });
});
