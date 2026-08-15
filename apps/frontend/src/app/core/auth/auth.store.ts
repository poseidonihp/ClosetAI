import { Injectable, computed, inject, signal } from '@angular/core';
import type {
  AuthResponse,
  AuthenticatedUser,
  EncryptedLoginRequest,
  EncryptedRegisterRequest,
  LoginRequest,
  RegisterRequest,
} from '@closetai/shared-types';
import { ApiClient } from '../http/api.client';
import { PasswordCryptoService } from './password-crypto.service';
import { raiseLoggedOutFlag } from './session-flag';
import { clearSessionActivity, markActivity, markSessionStart } from './session-activity';

/**
 * Estado de sesión de la aplicación. Signals privados expuestos como readonly.
 * @class
 */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly _api = inject(ApiClient);
  private readonly _crypto = inject(PasswordCryptoService);

  private readonly _user = signal<AuthenticatedUser | null>(null);
  private readonly _loading = signal<boolean>(true);
  private readonly _error = signal<string | null>(null);

  readonly user = this._user.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);

  /**
   * Resuelve la sesión al cargar la página: primero /auth/me, y si falla intenta
   * un refresh antes de darla por muerta.
   * @returns {Promise<void>}
   */
  async hydrate(): Promise<void> {
    this._loading.set(true);
    try {
      const me = await this._api.get<AuthenticatedUser>('auth/me');
      this._user.set(me);
      markActivity(Date.now());
    } catch {
      try {
        const refreshed = await this._api.post<AuthResponse>('auth/refresh');
        this._user.set(refreshed.user);
        markSessionStart(Date.now());
      } catch {
        this._user.set(null);
        clearSessionActivity();
      }
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Crea una cuenta y deja la sesión abierta.
   * @param {RegisterRequest} payload - Email, nombre y password en claro.
   * @returns {Promise<void>}
   */
  async register(payload: RegisterRequest): Promise<void> {
    this._error.set(null);
    this._loading.set(true);
    try {
      const encryptedPassword = await this._crypto.encrypt(payload.password);
      const body: EncryptedRegisterRequest = {
        email: payload.email,
        displayName: payload.displayName,
        encryptedPassword,
      };
      const response = await this._api.post<AuthResponse>('auth/register', body);
      this._user.set(response.user);
      markSessionStart(Date.now());
    } catch (error) {
      this._error.set(ApiClient.messageFromError(error));
      throw error;
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Inicia sesión con email y password.
   * @param {LoginRequest} payload - Email y password en claro.
   * @returns {Promise<void>}
   */
  async login(payload: LoginRequest): Promise<void> {
    this._error.set(null);
    this._loading.set(true);
    try {
      const encryptedPassword = await this._crypto.encrypt(payload.password);
      const body: EncryptedLoginRequest = { email: payload.email, encryptedPassword };
      const response = await this._api.post<AuthResponse>('auth/login', body);
      this._user.set(response.user);
      markSessionStart(Date.now());
    } catch (error) {
      this._error.set(ApiClient.messageFromError(error));
      throw error;
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Rota el par de tokens para deslizar la ventana de inactividad. No toca
   * `loading`: pasa en segundo plano y la pantalla no debe enterarse.
   * @returns {Promise<boolean>}
   */
  async keepAlive(): Promise<boolean> {
    try {
      const refreshed = await this._api.post<AuthResponse>('auth/refresh');
      this._user.set(refreshed.user);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cierra la sesión en servidor y limpia el estado local.
   * @returns {Promise<void>}
   */
  async logout(): Promise<void> {
    try {
      await this._api.post<void>('auth/logout');
    } catch {
      // Da igual por qué falló el servidor: la sesión local se limpia en el
      // `finally`, y dejar al usuario dentro porque no se pudo avisar sería peor.
    } finally {
      this._user.set(null);
      this._loading.set(false);
      this._error.set(null);
      clearSessionActivity();
      raiseLoggedOutFlag();
    }
  }
}
