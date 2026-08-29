/**
 * Captura de fotos con la cámara del dispositivo. Es la única vía que funciona
 * en Chrome de escritorio: el atributo `capture` de un `<input type="file">` es
 * una sugerencia que sólo atienden los navegadores móviles, y en escritorio abre
 * el explorador de archivos.
 */

/**
 * Formato de la foto capturada. WebP está en `acceptedUploadMimeTypes` y pesa
 * bastante menos que un JPEG a la misma calidad percibida.
 */
export const captureMimeType = 'image/webp';
/** Respaldo para un navegador cuyo canvas no sepa codificar WebP. */
export const fallbackCaptureMimeType = 'image/jpeg';
/** Calidad de la codificación: la foto todavía pasa por el normalizado del servidor. */
export const captureQuality = 0.9;
/**
 * Lado máximo de la captura. Es el mismo tope que aplica `compressForUpload`, así
 * que capturar más grande sólo gastaría memoria para reescalarlo después.
 */
export const maxCaptureEdgePx = 1600;

/** Prefijo del nombre del archivo generado. La foto nunca existió en el disco. */
const captureFilePrefix = 'prenda';
const mimeExtensions: Record<string, string> = {
  [captureMimeType]: 'webp',
  [fallbackCaptureMimeType]: 'jpg',
};
const fallbackExtension = 'jpg';

/**
 * Mensaje para cada fallo que devuelve `getUserMedia`. La clave es el `name` de
 * la `DOMException`; los alias antiguos apuntan al mismo texto porque algunos
 * navegadores siguen usándolos.
 */
const cameraErrorMessages: Record<string, string> = {
  NotAllowedError:
    'No diste permiso para usar la cámara. Habilítalo en el candado de la barra de direcciones y vuelve a intentarlo.',
  PermissionDeniedError:
    'No diste permiso para usar la cámara. Habilítalo en el candado de la barra de direcciones y vuelve a intentarlo.',
  NotFoundError: 'No se encontró ninguna cámara conectada a este equipo.',
  DevicesNotFoundError: 'No se encontró ninguna cámara conectada a este equipo.',
  NotReadableError: 'Otra aplicación está usando la cámara. Ciérrala y vuelve a intentarlo.',
  TrackStartError: 'Otra aplicación está usando la cámara. Ciérrala y vuelve a intentarlo.',
  OverconstrainedError: 'Esta cámara no acepta la configuración pedida. Prueba con otra.',
  SecurityError:
    'El navegador sólo da acceso a la cámara sobre HTTPS. Abre la app por su dirección segura.',
  AbortError: 'El navegador interrumpió el acceso a la cámara. Vuelve a intentarlo.',
};
const genericCameraErrorMessage = 'No se pudo abrir la cámara.';

/** El navegador exige contexto seguro para la cámara: HTTPS o localhost. */
const insecureContextMessage =
  'La cámara sólo funciona sobre HTTPS. Abre closetAI por su dirección segura y vuelve a intentarlo.';

/**
 * Indica si este navegador puede abrir la cámara. Sin contexto seguro el
 * navegador ni siquiera expone `mediaDevices`, así que se comprueban las dos
 * cosas por separado para poder explicar cuál falta.
 * @returns {boolean}
 */
export function isCameraAvailable(): boolean {
  return (
    window.isSecureContext === true && typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

/**
 * Traduce un fallo de `getUserMedia` a una frase accionable. Un error sin nombre
 * conocido no se muestra crudo: su texto viene del navegador y está en inglés.
 * @param {unknown} error - Error lanzado por el navegador.
 * @returns {string}
 */
export function cameraErrorMessage(error: unknown): string {
  if (window.isSecureContext === false) {
    return insecureContextMessage;
  }
  const name = error instanceof Error ? error.name : '';
  return cameraErrorMessages[name] ?? genericCameraErrorMessage;
}

/**
 * Nombre del archivo capturado. Lleva la fecha porque una prenda puede tener
 * varias fotos y todas nacen en el mismo segundo.
 * @param {Date} takenAt - Momento de la captura.
 * @param {string} mimeType - Formato con el que se codificó.
 * @returns {string}
 */
export function captureFileName(takenAt: Date, mimeType: string): string {
  const stamp = takenAt.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  return `${captureFilePrefix}-${stamp}.${mimeExtensions[mimeType] ?? fallbackExtension}`;
}

/** Ancho y alto de la imagen que se va a codificar. */
export interface ICaptureSize {
  width: number;
  height: number;
}

/**
 * Encaja el fotograma dentro del lado máximo conservando la proporción. Nunca
 * amplía: una webcam de 640 px no gana nada estirada a 1600.
 * @param {number} width - Ancho real del fotograma.
 * @param {number} height - Alto real del fotograma.
 * @param {number} maxEdgePx - Lado máximo permitido.
 * @returns {ICaptureSize}
 */
export function fitWithin(width: number, height: number, maxEdgePx: number): ICaptureSize {
  const longestEdge = Math.max(width, height);
  if (longestEdge <= 0) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(1, maxEdgePx / longestEdge);
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}
