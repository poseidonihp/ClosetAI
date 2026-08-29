import { Injectable, inject } from '@angular/core';
import type { PublicKeyResponse } from '@closetai/shared-types';
import { ApiClient } from '../http/api.client';

type ForgeModule = typeof import('node-forge');
type ForgePublicKey = ReturnType<ForgeModule['pki']['publicKeyFromPem']>;
type ImportedForge = ForgeModule & { default?: ForgeModule };

/**
 * Desenvuelve node-forge, que es CommonJS. El bundle de producción lo entrega
 * bajo `default` y el dev server con sus exports arriba, así que sin esto
 * `pki` llega undefined sólo en producción.
 * @param {ImportedForge} imported - Módulo tal como lo devuelve el import dinámico.
 * @returns {ForgeModule}
 */
export function unwrapForge(imported: ImportedForge): ForgeModule {
  return imported.default ?? imported;
}

/**
 * Cifra el password con la clave pública RSA del backend antes de enviarlo.
 * @class
 */
@Injectable({ providedIn: 'root' })
export class PasswordCryptoService {
  private readonly _api = inject(ApiClient);
  private _forge: ForgeModule | null = null;
  private _publicKey: ForgePublicKey | null = null;

  /**
   * Cifra un password con RSA-OAEP (SHA-256) y lo devuelve en base64.
   * @param {string} password - Password en claro.
   * @returns {Promise<string>}
   */
  async encrypt(password: string): Promise<string> {
    const forge = await this._loadForge();
    const key = await this._getPublicKey();
    const cipher = key.encrypt(forge.util.encodeUtf8(password), 'RSA-OAEP', {
      md: forge.md.sha256.create(),
      mgf1: { md: forge.md.sha256.create() },
    });
    return forge.util.encode64(cipher);
  }

  /**
   * Carga y cachea el módulo de criptografía.
   * @private
   * @returns {Promise<ForgeModule>}
   */
  private async _loadForge(): Promise<ForgeModule> {
    this._forge ??= unwrapForge(await import('node-forge'));
    return this._forge;
  }

  /**
   * Obtiene y cachea la clave pública del backend.
   * @private
   * @returns {Promise<ForgePublicKey>}
   */
  private async _getPublicKey(): Promise<ForgePublicKey> {
    if (this._publicKey) {
      return this._publicKey;
    }
    const [forge, response] = await Promise.all([
      this._loadForge(),
      this._api.get<PublicKeyResponse>('auth/public-key'),
    ]);
    this._publicKey = forge.pki.publicKeyFromPem(response.publicKey);
    return this._publicKey;
  }
}
