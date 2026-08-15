import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  constants,
  createPrivateKey,
  createPublicKey,
  privateDecrypt,
  type KeyObject,
} from 'node:crypto';
import type { Env } from '../../config/env.validation';

const invalidCipherMessage = 'Password cifrado inválido';

/**
 * Cifrado del password en tránsito. Es defensa en profundidad **sobre** HTTPS:
 * evita que el password en claro acabe en logs de proxy/APM. El almacenamiento
 * sigue siendo un hash bcrypt.
 * @class
 */
@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly _logger = new Logger(CryptoService.name);
  private _privateKey!: KeyObject;
  private _publicKeyPem!: string;

  /**
   * Inicializa el servicio con la configuración validada.
   * @constructor
   * @param {ConfigService<Env, true>} _config - Configuración tipada del entorno.
   */
  constructor(private readonly _config: ConfigService<Env, true>) {}

  /**
   * Carga la clave privada RSA y deriva la pública al arrancar el módulo.
   * @returns {void}
   */
  onModuleInit(): void {
    const privateKeyBase64 = this._config.get('RSA_PRIVATE_KEY_B64', { infer: true });
    let pem: string;
    try {
      pem = Buffer.from(privateKeyBase64, 'base64').toString('utf8');
    } catch {
      throw new Error('RSA_PRIVATE_KEY_B64 no es base64 válido');
    }
    if (!pem.includes('PRIVATE KEY')) {
      throw new Error('RSA_PRIVATE_KEY_B64 no contiene un PEM PKCS8 válido');
    }
    this._privateKey = createPrivateKey(pem);
    this._publicKeyPem = createPublicKey(this._privateKey)
      .export({ type: 'spki', format: 'pem' })
      .toString();
    this._logger.log('CryptoService > onModuleInit - clave RSA cargada');
  }

  /**
   * Devuelve la clave pública en PEM para que el cliente cifre el password.
   * @returns {string}
   */
  getPublicKeyPem(): string {
    return this._publicKeyPem;
  }

  /**
   * Descifra un password cifrado con RSA-OAEP (SHA-256) y codificado en base64.
   * @param {string} cipherBase64 - Password cifrado en base64.
   * @returns {string}
   */
  decryptPassword(cipherBase64: string): string {
    let buffer: Buffer;
    try {
      buffer = Buffer.from(cipherBase64, 'base64');
    } catch {
      throw new BadRequestException(invalidCipherMessage);
    }
    if (buffer.length === 0) {
      throw new BadRequestException(invalidCipherMessage);
    }
    try {
      const plain = privateDecrypt(
        {
          key: this._privateKey,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        buffer,
      );
      return plain.toString('utf8');
    } catch {
      throw new BadRequestException('No se pudo descifrar el password');
    }
  }
}
