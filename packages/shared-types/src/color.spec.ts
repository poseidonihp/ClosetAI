import { describe, expect, it } from 'vitest';
import { HexColorSchema, colorFamilyFromHex, hexToHsl } from './color';

describe('HexColorSchema', () => {
  it('normaliza a minúsculas', () => {
    expect(HexColorSchema.parse('#FFAA00')).toBe('#ffaa00');
  });

  it('rechaza formatos que no sean #rrggbb', () => {
    for (const invalid of ['ffaa00', '#fa0', '#ffaa0', '#ffaa000', 'rojo']) {
      expect(HexColorSchema.safeParse(invalid).success).toBe(false);
    }
  });
});

describe('hexToHsl', () => {
  it('devuelve null si el hex no es válido', () => {
    expect(hexToHsl('rojo')).toBeNull();
  });

  it('trata los grises como saturación cero', () => {
    const hsl = hexToHsl('#808080');

    expect(hsl?.saturation).toBe(0);
    expect(hsl?.hue).toBe(0);
  });

  it('sitúa los primarios en su tono', () => {
    expect(hexToHsl('#ff0000')?.hue).toBe(0);
    expect(hexToHsl('#00ff00')?.hue).toBe(120);
    expect(hexToHsl('#0000ff')?.hue).toBe(240);
  });
});

describe('colorFamilyFromHex', () => {
  it('clasifica los neutros de un clóset real', () => {
    expect(colorFamilyFromHex('#000000')).toBe('BLACK');
    expect(colorFamilyFromHex('#1a1815')).toBe('BLACK');
    expect(colorFamilyFromHex('#ffffff')).toBe('WHITE');
    expect(colorFamilyFromHex('#f5f1e8')).toBe('WHITE');
    expect(colorFamilyFromHex('#8b8b8b')).toBe('GRAY');
  });

  it('un crudo es blanco, pero un pastel con color propio no', () => {
    expect(colorFamilyFromHex('#f7f3ea')).toBe('WHITE');
    expect(colorFamilyFromHex('#ffe0e8')).toBe('PINK');
  });

  it('separa beige y marrón de los cálidos saturados', () => {
    expect(colorFamilyFromHex('#d8c9ae')).toBe('BEIGE');
    expect(colorFamilyFromHex('#6b4a2f')).toBe('BROWN');
    expect(colorFamilyFromHex('#d2762b')).toBe('ORANGE');
  });

  it('clasifica los cromáticos por tono', () => {
    expect(colorFamilyFromHex('#b53c3c')).toBe('RED');
    expect(colorFamilyFromHex('#d9b430')).toBe('YELLOW');
    expect(colorFamilyFromHex('#4a7c50')).toBe('GREEN');
    expect(colorFamilyFromHex('#3a5f96')).toBe('BLUE');
    expect(colorFamilyFromHex('#6b4a8f')).toBe('PURPLE');
    expect(colorFamilyFromHex('#c9789a')).toBe('PINK');
  });

  it('devuelve rojo a ambos lados del cero de la rueda', () => {
    expect(colorFamilyFromHex('#ff0000')).toBe('RED');
    expect(colorFamilyFromHex('#ff0033')).toBe('RED');
  });

  it('devuelve null si el hex no es válido', () => {
    expect(colorFamilyFromHex('#zzz')).toBeNull();
  });
});
