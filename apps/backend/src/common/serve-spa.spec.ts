import { describe, expect, it } from 'vitest';
import { isImmutableAsset, shouldServeIndex } from './serve-spa';

/**
 * Las dos decisiones que toma el servidor de la SPA. La de caché se equivoca del
 * lado seguro (revalidar de más), y la del respaldo del router decide si un 404
 * de la API se convierte en una página en blanco.
 */

const htmlAccept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const jsonAccept = 'application/json';

describe('isImmutableAsset', () => {
  it('reconoce el nombre con hash que produce el build de producción', () => {
    expect(isImmutableAsset('/dist/main-QK4XZP7A.js')).toBe(true);
    expect(isImmutableAsset('/dist/styles-6TNTPQGH.css')).toBe(true);
  });

  it('no marca inmutable el índice ni los archivos del service worker', () => {
    expect(isImmutableAsset('/dist/index.html')).toBe(false);
    expect(isImmutableAsset('/dist/ngsw.json')).toBe(false);
    expect(isImmutableAsset('/dist/ngsw-worker.js')).toBe(false);
  });

  it('no confunde un nombre con guiones con un hash', () => {
    expect(isImmutableAsset('/dist/icons/apple-touch-icon.png')).toBe(false);
    expect(isImmutableAsset('/dist/icons/icon-maskable-512.png')).toBe(false);
    expect(isImmutableAsset('/dist/manifest.webmanifest')).toBe(false);
  });
});

describe('shouldServeIndex', () => {
  it('devuelve la página en una navegación a una ruta del router', () => {
    expect(shouldServeIndex('GET', '/comprar?tab=evaluar', htmlAccept)).toBe(true);
  });

  it('deja que la API conteste su propio 404', () => {
    expect(shouldServeIndex('GET', '/api/garments/no-existe', htmlAccept)).toBe(false);
    expect(shouldServeIndex('GET', '/health/db', htmlAccept)).toBe(false);
    expect(shouldServeIndex('GET', '/docs/json', htmlAccept)).toBe(false);
  });

  it('no confunde una ruta que sólo empieza igual con una de la API', () => {
    expect(shouldServeIndex('GET', '/apiario', htmlAccept)).toBe(true);
  });

  it('no devuelve la página a quien pide datos: un asset que falta es un 404', () => {
    expect(shouldServeIndex('GET', '/chunk-QK4XZP7A.js', jsonAccept)).toBe(false);
    expect(shouldServeIndex('GET', '/perfil', undefined)).toBe(false);
  });

  it('sólo responde a lecturas', () => {
    expect(shouldServeIndex('POST', '/perfil', htmlAccept)).toBe(false);
    expect(shouldServeIndex('HEAD', '/perfil', htmlAccept)).toBe(true);
  });
});
