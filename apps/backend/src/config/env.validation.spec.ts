import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.validation';

const validBaseEnv = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/closetai_test',
  JWT_SECRET: 'a'.repeat(48),
  COOKIE_SECRET: 'b'.repeat(24),
  RSA_PRIVATE_KEY_B64: 'cGVt',
};

describe('validateEnv', () => {
  it('aplica los valores por defecto cuando sólo se dan los obligatorios', () => {
    const env = validateEnv({ ...validBaseEnv });

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:4200']);
    expect(env.COOKIE_SECURE).toBe(false);
    expect(env.AI_MONTHLY_BUDGET_USD).toBe(10);
    expect(env.AI_JOB_MAX_ATTEMPTS).toBe(3);
  });

  it('rechaza un JWT_SECRET demasiado corto', () => {
    expect(() => validateEnv({ ...validBaseEnv, JWT_SECRET: 'corto' })).toThrowError(
      /JWT_SECRET debe tener al menos 32 caracteres/,
    );
  });

  it('exige cookies seguras en producción', () => {
    expect(() =>
      validateEnv({ ...validBaseEnv, NODE_ENV: 'production', COOKIE_SECURE: 'false' }),
    ).toThrowError(/COOKIE_SECURE debe ser "true" en producción/);
  });

  it('acepta producción con cookies seguras', () => {
    const env = validateEnv({ ...validBaseEnv, NODE_ENV: 'production', COOKIE_SECURE: 'true' });

    expect(env.COOKIE_SECURE).toBe(true);
  });

  it('parte CORS_ORIGINS por comas y descarta espacios', () => {
    const env = validateEnv({
      ...validBaseEnv,
      CORS_ORIGINS: 'http://localhost:4200, https://closet.local ',
    });

    expect(env.CORS_ORIGINS).toEqual(['http://localhost:4200', 'https://closet.local']);
  });
});
