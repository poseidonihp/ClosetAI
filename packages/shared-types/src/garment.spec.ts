import { describe, expect, it } from 'vitest';
import { CreateGarmentSchema, UpdateGarmentSchema } from './garment';

const validGarment = {
  name: 'Camiseta blanca',
  garmentTypeId: '11111111-1111-1111-1111-111111111111',
  slot: 'TOP',
  primaryColorHex: '#FFFFFF',
  primaryColorName: 'Blanco',
  secondaryColorHex: null,
  pattern: 'SOLID',
  patternScale: 'NONE',
  material: 'COTTON',
  fit: 'REGULAR',
  formality: 2,
  seasons: ['SPRING', 'SUMMER'],
  weatherMinC: 18,
  weatherMaxC: 34,
  brand: null,
  size: 'M',
  status: 'ACTIVE',
};

describe('CreateGarmentSchema', () => {
  it('acepta una prenda completa y normaliza el color', () => {
    const parsed = CreateGarmentSchema.parse(validGarment);

    expect(parsed.primaryColorHex).toBe('#ffffff');
  });

  it('rechaza un rango de temperatura invertido', () => {
    const result = CreateGarmentSchema.safeParse({
      ...validGarment,
      weatherMinC: 30,
      weatherMaxC: 10,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['weatherMaxC']);
  });

  it('acepta un solo extremo del rango de temperatura', () => {
    expect(
      CreateGarmentSchema.safeParse({ ...validGarment, weatherMinC: 12, weatherMaxC: null })
        .success,
    ).toBe(true);
  });

  it('rechaza una formalidad fuera de 1..5', () => {
    expect(CreateGarmentSchema.safeParse({ ...validGarment, formality: 0 }).success).toBe(false);
    expect(CreateGarmentSchema.safeParse({ ...validGarment, formality: 6 }).success).toBe(false);
  });

  it('exige nombre y tipo de prenda', () => {
    expect(CreateGarmentSchema.safeParse({ ...validGarment, name: '' }).success).toBe(false);
    expect(CreateGarmentSchema.safeParse({ ...validGarment, garmentTypeId: 'x' }).success).toBe(
      false,
    );
  });
});

describe('UpdateGarmentSchema', () => {
  it('acepta una actualización de un solo campo', () => {
    const parsed = UpdateGarmentSchema.parse({ status: 'LAUNDRY' });

    expect(parsed).toEqual({ status: 'LAUNDRY' });
  });

  it('no rellena con valores por defecto lo que no se envía', () => {
    const parsed = UpdateGarmentSchema.parse({ name: 'Camiseta negra' });

    expect(Object.keys(parsed)).toEqual(['name']);
  });

  it('rechaza campos desconocidos en vez de ignorarlos', () => {
    expect(UpdateGarmentSchema.safeParse({ userId: 'otro-usuario' }).success).toBe(false);
  });

  it('sigue validando el rango de temperatura', () => {
    expect(UpdateGarmentSchema.safeParse({ weatherMinC: 30, weatherMaxC: 10 }).success).toBe(false);
  });
});
