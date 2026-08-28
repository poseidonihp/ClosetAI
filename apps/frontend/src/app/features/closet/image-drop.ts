/**
 * Imágenes que llegan sin pasar por un `<input type="file">`: soltadas desde otra
 * ventana o pegadas del portapapeles. Es código puro y trabaja sobre listas ya
 * materializadas para poder probarlo sin un `DataTransfer`, que jsdom no
 * implementa.
 */

/** Valor con el que un arrastre anuncia que transporta archivos. */
const filesTransferType = 'Files';
const imageMimePrefix = 'image/';

/**
 * Indica si un arrastre transporta archivos y no texto o un enlace.
 * @param {readonly string[]} transferTypes - Tipos que anuncia el arrastre.
 * @returns {boolean}
 */
export function carriesFiles(transferTypes: readonly string[]): boolean {
  return transferTypes.includes(filesTransferType);
}

/**
 * Se queda con los archivos que son imágenes. Una captura pegada nunca existió
 * en el disco y llega con un nombre de relleno, así que el filtro mira el tipo
 * declarado y jamás la extensión.
 * @param {readonly File[]} files - Archivos soltados o pegados.
 * @returns {File[]}
 */
export function imagesFrom(files: readonly File[]): File[] {
  return files.filter(file => file.type.startsWith(imageMimePrefix));
}
