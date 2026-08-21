import { describe, expect, it } from 'vitest';
import { makeProfile } from '../engine/engine.fixtures';
import { buildRenderPrompt, renderInstructions } from './render.prompt.v1';
import type { IRenderPromptGarment, IRenderPromptInput } from './render.types';

/**
 * El prompt del render es lo único que separa "una imagen de tu conjunto" de "una
 * imagen de una persona con ropa parecida", y también lo que impide que la cara de
 * una foto de espejo acabe en el resultado.
 */

/**
 * Prenda con su número de foto.
 * @param {number} imageIndex - Posición de su foto, empezando en 1.
 * @param {Partial<IRenderPromptGarment>} [overrides] - Campos que el caso fija.
 * @returns {IRenderPromptGarment}
 */
function makeGarment(
  imageIndex: number,
  overrides: Partial<IRenderPromptGarment> = {},
): IRenderPromptGarment {
  return {
    imageIndex,
    name: 'Camiseta blanca',
    slot: 'TOP',
    role: 'BASE',
    garmentTypeName: 'Camiseta',
    colorName: 'Blanco',
    colorHex: '#FFFFFF',
    pattern: 'liso',
    material: 'algodón',
    fit: 'regular',
    ...overrides,
  };
}

/**
 * Entrada del prompt con un look mínimo.
 * @param {Partial<IRenderPromptInput>} [overrides] - Campos que el caso fija.
 * @returns {IRenderPromptInput}
 */
function makeInput(overrides: Partial<IRenderPromptInput> = {}): IRenderPromptInput {
  return {
    profile: makeProfile(),
    styleTag: 'MINIMALIST',
    title: 'Minimalista en blanco y azul',
    oneLiner: 'Lo justo, bien puesto.',
    occasions: ['DAILY'],
    weatherMinC: null,
    weatherMaxC: null,
    garments: [
      makeGarment(1),
      makeGarment(2, { name: 'Jean azul', slot: 'BOTTOM', colorName: 'Azul' }),
      makeGarment(3, { name: 'Sneakers blancos', slot: 'FOOTWEAR', role: 'FOOTWEAR' }),
    ],
    ...overrides,
  };
}

describe('renderInstructions', () => {
  it('prohíbe reproducir a la persona que aparezca en las fotos', () => {
    expect(renderInstructions).toContain('No reproduzcas a ninguna persona');
    expect(renderInstructions).toContain('espejo');
  });

  it('deja la cara fuera del plano y prohíbe inventar el cuerpo', () => {
    expect(renderInstructions).toContain('la cara quede fuera del plano');
    expect(renderInstructions).toContain('No inventes rasgos, edad, peso ni complexión');
  });

  it('exige el conjunto completo y nada más que las prendas dadas', () => {
    expect(renderInstructions).toContain('ninguna más');
    expect(renderInstructions).toContain('párecete a la foto');
  });
});

describe('buildRenderPrompt', () => {
  it('ata cada prenda al número de su foto', () => {
    const prompt = buildRenderPrompt(makeInput());

    expect(prompt).toContain('Foto 1: Camiseta blanca');
    expect(prompt).toContain('Foto 2: Jean azul');
    expect(prompt).toContain('Foto 3: Sneakers blancos');
  });

  it('describe la prenda con su color exacto y su corte', () => {
    const prompt = buildRenderPrompt(makeInput());

    expect(prompt).toContain('Blanco #FFFFFF');
    expect(prompt).toContain('corte regular');
  });

  it('no menciona el perfil cuando el usuario no declaró nada', () => {
    const prompt = buildRenderPrompt(makeInput());

    expect(prompt).not.toContain('PERFIL');
    expect(prompt).not.toContain('Altura');
    expect(prompt).not.toContain('Género');
  });

  it('cita lo que el usuario sí declaró y nada más', () => {
    const prompt = buildRenderPrompt(
      makeInput({
        profile: makeProfile({ heightCm: 178, weightKg: 74, bodyShape: 'RECTANGLE' }),
      }),
    );

    expect(prompt).toContain('Altura: 178 cm');
    expect(prompt).not.toContain('74');
    expect(prompt).not.toContain('Recta');
  });

  it('incluye el rango térmico del look sólo si sus prendas lo declaran', () => {
    expect(buildRenderPrompt(makeInput())).not.toContain('Clima');
    expect(buildRenderPrompt(makeInput({ weatherMinC: 14, weatherMaxC: 22 }))).toContain(
      '14–22 °C',
    );
  });

  it('omite el bloque de prendas si no hay ninguna, en vez de dejarlo vacío', () => {
    const prompt = buildRenderPrompt(makeInput({ garments: [] }));

    expect(prompt).not.toContain('PRENDAS');
  });
});
