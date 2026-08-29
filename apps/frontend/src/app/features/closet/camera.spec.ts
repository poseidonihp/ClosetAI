import { describe, expect, it } from 'vitest';
import {
  cameraErrorMessage,
  captureFileName,
  captureMimeType,
  fallbackCaptureMimeType,
  fitWithin,
  maxCaptureEdgePx,
} from './camera';

/**
 * Construye el fallo tal como lo lanza el navegador: lo que identifica el motivo
 * es el `name`, no el mensaje, que además llega en inglés.
 * @param {string} name - Nombre de la `DOMException`.
 * @returns {Error}
 */
function buildDomError(name: string): Error {
  const error = new Error('browser text');
  error.name = name;
  return error;
}

describe('cameraErrorMessage', () => {
  it('explica cómo reabrir el permiso cuando el usuario lo negó', () => {
    expect(cameraErrorMessage(buildDomError('NotAllowedError'))).toContain('permiso');
  });

  it('trata el alias antiguo del permiso igual que el actual', () => {
    expect(cameraErrorMessage(buildDomError('PermissionDeniedError'))).toBe(
      cameraErrorMessage(buildDomError('NotAllowedError')),
    );
  });

  it('distingue que no hay cámara de que otra app la tiene tomada', () => {
    const missing = cameraErrorMessage(buildDomError('NotFoundError'));
    const busy = cameraErrorMessage(buildDomError('NotReadableError'));

    expect(missing).not.toBe(busy);
  });

  it('no filtra el texto en inglés del navegador ante un error desconocido', () => {
    expect(cameraErrorMessage(buildDomError('SomethingBrandNewError'))).not.toContain(
      'browser text',
    );
  });

  it('responde a algo que ni siquiera es un Error', () => {
    expect(cameraErrorMessage('roto')).toBeTruthy();
  });
});

describe('captureFileName', () => {
  it('usa la extensión del formato con el que se codificó', () => {
    const takenAt = new Date(Date.UTC(2026, 7, 28, 15, 30, 5));

    expect(captureFileName(takenAt, captureMimeType)).toMatch(/\.webp$/);
    expect(captureFileName(takenAt, fallbackCaptureMimeType)).toMatch(/\.jpg$/);
  });

  it('distingue dos capturas del mismo minuto', () => {
    const first = captureFileName(new Date(Date.UTC(2026, 7, 28, 15, 30, 5)), captureMimeType);
    const second = captureFileName(new Date(Date.UTC(2026, 7, 28, 15, 30, 6)), captureMimeType);

    expect(first).not.toBe(second);
  });

  it('cae a una extensión conocida si el formato no lo es', () => {
    expect(captureFileName(new Date(), 'image/tiff')).toMatch(/\.jpg$/);
  });
});

describe('fitWithin', () => {
  it('reduce el lado largo al tope y conserva la proporción', () => {
    expect(fitWithin(4000, 3000, maxCaptureEdgePx)).toEqual({ width: 1600, height: 1200 });
  });

  it('respeta el retrato: el lado largo es el alto', () => {
    expect(fitWithin(1080, 1920, maxCaptureEdgePx)).toEqual({ width: 900, height: 1600 });
  });

  it('no amplía una webcam pequeña', () => {
    expect(fitWithin(640, 480, maxCaptureEdgePx)).toEqual({ width: 640, height: 480 });
  });

  it('devuelve cero cuando el vídeo todavía no tiene fotograma', () => {
    expect(fitWithin(0, 0, maxCaptureEdgePx)).toEqual({ width: 0, height: 0 });
  });
});
