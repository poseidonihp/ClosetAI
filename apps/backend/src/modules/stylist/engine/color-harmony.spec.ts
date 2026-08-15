import { describe, expect, it } from 'vitest';
import { harmonyScore, hueDistance, isNeutralColor } from './color-harmony';

const black = '#1a1815';
const white = '#f5f1e8';
const beige = '#d8c9ae';
const navy = '#26364f';
const blue = '#3a5f96';
const orange = '#d2762b';
const green = '#2f8f3f';
const purple = '#7b2fbf';
const red = '#c22020';

describe('isNeutralColor', () => {
  it('trata como neutros el negro, el blanco y los grises', () => {
    expect(isNeutralColor(black)).toBe(true);
    expect(isNeutralColor(white)).toBe(true);
    expect(isNeutralColor('#8b8b8b')).toBe(true);
  });

  it('el beige y el crudo son neutros aunque su HSL tenga saturación', () => {
    expect(isNeutralColor(beige)).toBe(true);
    expect(isNeutralColor('#f0ebdf')).toBe(true);
  });

  it('un azul con tono propio no es neutro', () => {
    expect(isNeutralColor(blue)).toBe(false);
  });
});

describe('hueDistance', () => {
  it('mide por el camino corto de la rueda', () => {
    expect(hueDistance(350, 10)).toBe(20);
    expect(hueDistance(10, 350)).toBe(20);
    expect(hueDistance(0, 180)).toBe(180);
  });
});

describe('harmonyScore', () => {
  it('una paleta sólo de neutros siempre funciona', () => {
    const harmony = harmonyScore([black, white, '#8b8b8b']);

    expect(harmony.score).toBe(1);
    expect(harmony.reason).toContain('neutra');
  });

  it('neutros con un único color protagonista también', () => {
    const harmony = harmonyScore([white, blue, black]);

    expect(harmony.score).toBe(1);
    expect(harmony.reason).toContain('protagonista');
  });

  it('dos tonos vecinos puntúan más que dos que compiten', () => {
    const analogous = harmonyScore([blue, navy]);
    const clashing = harmonyScore([green, purple]);

    expect(analogous.score).toBeGreaterThan(clashing.score);
    expect(analogous.reason).toContain('vecinos');
  });

  it('el contraste complementario se reconoce como tal', () => {
    const harmony = harmonyScore([blue, orange]);

    expect(harmony.reason).toContain('complementario');
    expect(harmony.score).toBeGreaterThan(0.5);
  });

  it('manda el peor par: un choque no lo arregla el resto', () => {
    const harmony = harmonyScore([blue, navy, red, green]);

    expect(harmony.score).toBeLessThan(harmonyScore([blue, navy]).score);
  });

  it('ignora los hex inválidos en vez de reventar', () => {
    expect(harmonyScore(['rojo', black]).score).toBe(1);
  });
});
