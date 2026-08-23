import { describe, expect, it } from 'vitest';
import { makeGarment } from '../stylist/engine/engine.fixtures';
import { findDuplicates, formalityBand } from './duplicates';

/**
 * Qué cuenta como "ya tengo una igual". Es una comparación de atributos y se
 * comprueba como tal: nunca se le pregunta al modelo.
 */

const ownedId = 'a1111111-1111-4111-8111-111111111111';
const otherTypeId = 'c0000000-0000-4000-8000-000000000099';

/** Camisa azul marino formal que el usuario ya tiene. */
const owned = makeGarment(ownedId, 'Camisa azul marino', 'TOP', {
  primaryColorHex: '#2c3e57',
  primaryColorName: 'Azul marino',
  formality: 4,
});

describe('formalityBand', () => {
  it('agrupa la escala 1-5 en tres bandas', () => {
    expect(formalityBand(1)).toBe(formalityBand(2));
    expect(formalityBand(3)).not.toBe(formalityBand(2));
    expect(formalityBand(4)).toBe(formalityBand(5));
  });
});

describe('findDuplicates', () => {
  it('marca la prenda que repite tipo, slot, familia de color y banda', () => {
    const candidate = makeGarment('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Camisa azul', 'TOP', {
      primaryColorHex: '#3a5f96',
      primaryColorName: 'Azul',
      formality: 5,
    });

    expect(findDuplicates(candidate, [owned])).toEqual([ownedId]);
  });

  it('no marca nada cuando cambia la familia de color', () => {
    const candidate = makeGarment('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Camisa verde', 'TOP', {
      primaryColorHex: '#4a7c50',
      primaryColorName: 'Verde',
      formality: 4,
    });

    expect(findDuplicates(candidate, [owned])).toEqual([]);
  });

  it('no marca nada cuando cambia la banda de formalidad', () => {
    const candidate = makeGarment('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Camisa azul', 'TOP', {
      primaryColorHex: '#2c3e57',
      primaryColorName: 'Azul marino',
      formality: 2,
    });

    expect(findDuplicates(candidate, [owned])).toEqual([]);
  });

  it('no marca nada cuando cambia el tipo de prenda', () => {
    const candidate = makeGarment('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Polo azul', 'TOP', {
      garmentTypeId: otherTypeId,
      primaryColorHex: '#2c3e57',
      primaryColorName: 'Azul marino',
      formality: 4,
    });

    expect(findDuplicates(candidate, [owned])).toEqual([]);
  });

  it('nunca se marca a sí misma', () => {
    expect(findDuplicates(owned, [owned])).toEqual([]);
  });
});
