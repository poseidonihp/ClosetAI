import { describe, expect, it } from 'vitest';
import { unwrapForge } from './password-crypto.service';

type ForgeModule = typeof import('node-forge');
type ImportedForge = ForgeModule & { default?: ForgeModule };

/**
 * Crea un doble mínimo de node-forge, con lo justo para reconocerlo.
 * @returns {ForgeModule}
 */
function fakeForge(): ForgeModule {
  return { pki: { publicKeyFromPem: () => null } } as unknown as ForgeModule;
}

describe('unwrapForge', () => {
  it('devuelve el módulo tal cual cuando ya expone sus exports', () => {
    const forge = fakeForge();

    expect(unwrapForge(forge)).toBe(forge);
  });

  it('desenvuelve `default` cuando el bundle envuelve el CommonJS', () => {
    const inner = fakeForge();
    const wrapped = { default: inner } as unknown as ImportedForge;

    expect(unwrapForge(wrapped)).toBe(inner);
  });

  it('deja `pki` accesible, que es lo que faltaba en producción', () => {
    const wrapped = { default: fakeForge() } as unknown as ImportedForge;

    expect(unwrapForge(wrapped).pki.publicKeyFromPem).toBeTypeOf('function');
  });
});
