import { describe, expect, it } from 'vitest';
import { MeasurementsSchema, UpdateStyleProfileSchema, measurementsVersion } from './profile';

describe('MeasurementsSchema', () => {
  it('rellena versión y unidad para que el Json guardado sea autodescriptivo', () => {
    const parsed = MeasurementsSchema.parse({ chest: 100, waist: 84 });

    expect(parsed.version).toBe(measurementsVersion);
    expect(parsed.unit).toBe('cm');
  });

  it('rechaza medidas fuera de rango humano', () => {
    expect(MeasurementsSchema.safeParse({ chest: 5 }).success).toBe(false);
    expect(MeasurementsSchema.safeParse({ chest: 500 }).success).toBe(false);
  });

  it('rechaza una versión distinta a la actual, para no leer un formato viejo', () => {
    expect(MeasurementsSchema.safeParse({ version: 99, unit: 'cm', chest: 100 }).success).toBe(
      false,
    );
  });
});

describe('UpdateStyleProfileSchema', () => {
  it('acepta un perfil completamente vacío: nada es obligatorio', () => {
    expect(UpdateStyleProfileSchema.parse({})).toEqual({});
  });

  it('distingue un campo ausente de un null explícito', () => {
    const parsed = UpdateStyleProfileSchema.parse({ heightCm: null });

    expect('heightCm' in parsed).toBe(true);
    expect(parsed.heightCm).toBeNull();
    expect('weightKg' in parsed).toBe(false);
  });

  it('rechaza campos desconocidos', () => {
    expect(UpdateStyleProfileSchema.safeParse({ userId: 'otro' }).success).toBe(false);
  });

  it('rechaza una altura imposible', () => {
    expect(UpdateStyleProfileSchema.safeParse({ heightCm: 12 }).success).toBe(false);
  });

  it('exige código ISO de tres letras en la moneda', () => {
    expect(UpdateStyleProfileSchema.safeParse({ currency: 'COP' }).success).toBe(true);
    expect(UpdateStyleProfileSchema.safeParse({ currency: 'pesos' }).success).toBe(false);
  });
});
