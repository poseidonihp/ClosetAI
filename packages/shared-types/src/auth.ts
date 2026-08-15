import { z } from 'zod';

const maxDisplayName = 80;
// Password en claro: sólo vive en memoria del cliente. Por la red viaja cifrado.
const minPassword = 8;
const maxPassword = 128;
// Payload RSA-OAEP en base64 (1024 caracteres cubren RSA-2048 con margen).
const maxEncryptedPassword = 1024;

// Datos del formulario en el frontend (password en claro, sólo en memoria del cliente).
export const LoginRequestSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'Password requerido'),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

// Lo que viaja realmente por HTTP: password cifrado con la clave pública RSA del backend.
export const EncryptedLoginRequestSchema = z.object({
  email: z.string().email(),
  encryptedPassword: z.string().min(1).max(maxEncryptedPassword),
});
export type EncryptedLoginRequest = z.infer<typeof EncryptedLoginRequestSchema>;

export const RegisterRequestSchema = z.object({
  email: z.string().email('Email inválido'),
  displayName: z.string().min(1, 'Nombre requerido').max(maxDisplayName),
  password: z.string().min(minPassword, 'Mínimo 8 caracteres').max(maxPassword),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const EncryptedRegisterRequestSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(maxDisplayName),
  encryptedPassword: z.string().min(1).max(maxEncryptedPassword),
});
export type EncryptedRegisterRequest = z.infer<typeof EncryptedRegisterRequestSchema>;

export const PublicKeyResponseSchema = z.object({
  publicKey: z.string().min(1),
});
export type PublicKeyResponse = z.infer<typeof PublicKeyResponseSchema>;

export const AuthenticatedUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
});
export type AuthenticatedUser = z.infer<typeof AuthenticatedUserSchema>;

export const AuthResponseSchema = z.object({
  user: AuthenticatedUserSchema,
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export const SessionPolicySchema = z.object({
  idleTimeoutSeconds: z.number().int().positive(),
});
export type SessionPolicy = z.infer<typeof SessionPolicySchema>;

/**
 * Ventana de inactividad por defecto (5 minutos). Vive aquí porque el cliente
 * necesita un valor con el que contar antes de recibir la política del servidor.
 */
export const defaultSessionIdleSeconds = 300;

/** Longitud mínima del password en claro, compartida por formulario y backend. */
export const passwordMinLength = minPassword;
