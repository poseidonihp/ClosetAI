import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import { Logger } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/**
 * Sirve la SPA compilada desde el propio backend.
 */

const indexFileName = 'index.html';
/**
 * Prefijos que pertenecen a la API. Un 404 bajo ellos devuelve JSON: contestar el
 * `index.html` haría que un endpoint mal escrito pareciera funcionar.
 */
const apiPathPrefixes = ['/api', '/health', '/docs'] as const;
const readableMethods = ['GET', 'HEAD'] as const;
const htmlAcceptToken = 'text/html';

const secondsPerYear = 31_536_000;
/** Los archivos con hash de contenido nunca cambian bajo el mismo nombre. */
const immutableCacheControl = `public, max-age=${secondsPerYear}, immutable`;
export const revalidateCacheControl = 'no-cache';
export const htmlContentType = 'text/html; charset=utf-8';
const hashedFileNamePattern = /-[A-Z0-9]{8,}\.[a-z0-9]+$/;

/**
 * Indica si el archivo lleva hash de contenido y puede cachearse para siempre.
 * @param {string} filePath - Ruta del archivo que se va a servir.
 * @returns {boolean}
 */
export function isImmutableAsset(filePath: string): boolean {
  return hashedFileNamePattern.test(filePath);
}

/**
 * Decide si una petición sin ruta debe recibir el `index.html` del router de
 * Angular. Se exige que el cliente pida HTML: un asset que falta tiene que dar
 * 404 y no la página, o el error se esconde y el service worker cachea basura.
 * @param {string} method - Método HTTP de la petición.
 * @param {string} url - URL solicitada, con query si la trae.
 * @param {string} [accept] - Cabecera `Accept` del cliente.
 * @returns {boolean}
 */
export function shouldServeIndex(method: string, url: string, accept?: string): boolean {
  const isReadable = readableMethods.some(readable => readable === method.toUpperCase());
  if (!isReadable) {
    return false;
  }
  const path = url.split('?')[0] ?? '';
  const belongsToApi = apiPathPrefixes.some(
    prefix => path === prefix || path.startsWith(`${prefix}/`),
  );
  if (belongsToApi) {
    return false;
  }
  return (accept ?? '').includes(htmlAcceptToken);
}

/**
 * Monta los archivos de la SPA compilada y devuelve su `index.html`, que es lo
 * que el filtro global usa como respaldo del router de Angular. El respaldo no
 * puede vivir en un `setNotFoundHandler` propio: Nest registra el suyo al
 * arrancar y Fastify sólo admite uno por prefijo.
 * @param {NestFastifyApplication} app - Aplicación Nest ya creada.
 * @param {string} rootPath - Carpeta `browser/` del build de Angular.
 * @returns {Promise<Buffer>}
 */
export async function registerSpa(app: NestFastifyApplication, rootPath: string): Promise<Buffer> {
  const logger = new Logger('registerSpa');
  const indexPath = join(rootPath, indexFileName);

  let indexHtml: Buffer;
  try {
    indexHtml = await readFile(indexPath);
  } catch (error: unknown) {
    throw new Error(
      `No se encontró la SPA compilada en ${indexPath}. Compílala con "pnpm build" o apaga SERVE_SPA. Detalle: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  await app.register(fastifyStatic, {
    root: rootPath,
    prefix: '/',
    wildcard: false,
    index: false,
    decorateReply: false,
    cacheControl: false,
    setHeaders: (response, filePath) => {
      response.setHeader(
        'Cache-Control',
        isImmutableAsset(filePath) ? immutableCacheControl : revalidateCacheControl,
      );
    },
  });

  logger.log(`registerSpa - SPA servida desde ${rootPath}`);
  return indexHtml;
}
