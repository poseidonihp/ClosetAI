import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalDiskDriver } from './local-disk.driver';

const ownerUserId = '11111111-1111-1111-1111-111111111111';
const otherUserId = '22222222-2222-2222-2222-222222222222';
const entityId = '33333333-3333-3333-3333-333333333333';

describe('LocalDiskDriver', () => {
  let temporaryRoot: string;
  let driver: LocalDiskDriver;
  let previousStorageRoot: string | undefined;

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'closetai-storage-'));
    previousStorageRoot = process.env.STORAGE_ROOT;
    process.env.STORAGE_ROOT = temporaryRoot;
    driver = new LocalDiskDriver();
  });

  afterEach(async () => {
    if (previousStorageRoot === undefined) {
      delete process.env.STORAGE_ROOT;
    } else {
      process.env.STORAGE_ROOT = previousStorageRoot;
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  it('guarda con key userId/entityId/archivo y lee lo mismo que escribió', async () => {
    const buffer = Buffer.from('imagen-de-prueba');

    const stored = await driver.save({
      userId: ownerUserId,
      entityId,
      filename: 'prenda.webp',
      mimeType: 'image/webp',
      buffer,
    });

    expect(stored.key.startsWith(`${ownerUserId}/${entityId}/`)).toBe(true);
    expect(stored.key.endsWith('.webp')).toBe(true);
    expect(stored.byteSize).toBe(buffer.byteLength);

    const read = await driver.read(stored.key);
    expect(read?.buffer.toString()).toBe('imagen-de-prueba');
    expect(read?.mimeType).toBe('image/webp');
  });

  it('devuelve null cuando la key no existe', async () => {
    const read = await driver.read(`${otherUserId}/${entityId}/inexistente.webp`);

    expect(read).toBeNull();
  });

  it('no permite salir de la raíz de almacenamiento', async () => {
    const read = await driver.read('../../secreto.env');

    expect(read).toBeNull();
  });

  it('borra sin fallar aunque el archivo ya no esté', async () => {
    const stored = await driver.save({
      userId: ownerUserId,
      entityId,
      filename: 'prenda.png',
      mimeType: 'image/png',
      buffer: Buffer.from('x'),
    });

    await driver.delete(stored.key);
    await driver.delete(stored.key);

    expect(await driver.read(stored.key)).toBeNull();
  });

  it('genera una URL autenticada y no una ruta pública', () => {
    const url = driver.urlFor(`${ownerUserId}/${entityId}/a.webp`);

    expect(url.startsWith('/api/media?key=')).toBe(true);
  });
});
