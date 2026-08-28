import { describe, expect, it } from 'vitest';
import { carriesFiles, imagesFrom } from './image-drop';

/**
 * Construye un archivo de prueba con el tipo declarado.
 * @param {string} name - Nombre del archivo.
 * @param {string} type - Tipo MIME declarado por el navegador.
 * @returns {File}
 */
function buildFile(name: string, type: string): File {
  return new File([new Uint8Array([0])], name, { type });
}

describe('carriesFiles', () => {
  it('acepta un arrastre que transporta archivos', () => {
    expect(carriesFiles(['Files'])).toBe(true);
  });

  it('rechaza un arrastre de texto o de un enlace', () => {
    expect(carriesFiles(['text/plain', 'text/uri-list'])).toBe(false);
  });

  it('rechaza un arrastre sin tipos', () => {
    expect(carriesFiles([])).toBe(false);
  });
});

describe('imagesFrom', () => {
  it('se queda con las imágenes y descarta el resto', () => {
    const screenshot = buildFile('image.png', 'image/png');
    const invoice = buildFile('ticket.pdf', 'application/pdf');

    expect(imagesFrom([screenshot, invoice])).toEqual([screenshot]);
  });

  it('acepta una captura pegada, cuyo nombre es de relleno', () => {
    expect(imagesFrom([buildFile('image.png', 'image/png')])).toHaveLength(1);
  });

  it('descarta un archivo sin tipo declarado', () => {
    expect(imagesFrom([buildFile('foto', '')])).toEqual([]);
  });
});
