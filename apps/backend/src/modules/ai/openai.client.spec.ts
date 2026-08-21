import { describe, expect, it } from 'vitest';
import { supportsInputFidelity } from './openai.client';

/**
 * Mandar `input_fidelity` a un modelo que no lo acepta devuelve un 400 y tira el
 * render entero, así que la tabla decide si el parámetro viaja o no.
 */

describe('supportsInputFidelity', () => {
  it('lo acepta en los modelos que sí lo admiten', () => {
    expect(supportsInputFidelity('gpt-image-1')).toBe(true);
    expect(supportsInputFidelity('gpt-image-1.5')).toBe(true);
  });

  it('lo omite en gpt-image-2, que procesa la entrada en alta fidelidad y lo rechaza', () => {
    expect(supportsInputFidelity('gpt-image-2')).toBe(false);
    expect(supportsInputFidelity('gpt-image-2-2026-04-21')).toBe(false);
  });

  it('lo omite en los mini, que devuelven error si se manda', () => {
    expect(supportsInputFidelity('gpt-image-1-mini')).toBe(false);
  });

  it('lo omite en un modelo desconocido: perder fidelidad es preferible a un 400', () => {
    expect(supportsInputFidelity('modelo-que-no-existe')).toBe(false);
  });
});
