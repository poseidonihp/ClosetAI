import { describe, expect, it } from 'vitest';
import {
  LookScoreSignalEnum,
  type Garment,
  type Look,
  type LookScoreLine,
} from '@closetai/shared-types';
import { generateLooks, resolveTemperatureC, toEngineRequest } from './engine';
import { millisecondsPerDay } from './engine.constants';
import {
  basicCloset,
  dressCloset,
  fixedNow,
  makeGarment,
  makeInput,
  makeProfile,
  makeRequest,
} from './engine.fixtures';

/**
 * Casos golden del motor. Cubren exactamente lo que el producto promete: que un
 * look sólo use prendas que existen y están disponibles, que `mustInclude` se
 * honre, que un clóset que no da para el estilo pedido lo diga en vez de
 * inventar, y que un vestido baste como base.
 */

const jeanId = '33333333-3333-4333-8333-333333333333';
const chinoId = '44444444-4444-4444-8444-444444444444';
const sneakersId = '55555555-5555-4555-8555-555555555555';
const blackTeeId = '22222222-2222-4222-8222-222222222222';

/**
 * Ids de las prendas de un look.
 * @param {Look} look - Look generado.
 * @returns {string[]}
 */
function idsOf(look: Look): string[] {
  return look.items.map(item => item.garmentId);
}

/**
 * Slots presentes en un look.
 * @param {Look} look - Look generado.
 * @returns {string[]}
 */
function slotsOf(look: Look): string[] {
  return look.items.map(item => item.slot);
}

/**
 * Línea de variedad del desglose del mejor look.
 * @param {ReturnType<typeof generateLooks>} result - Resultado del motor.
 * @returns {LookScoreLine | undefined}
 */
function freshnessLine(result: ReturnType<typeof generateLooks>): LookScoreLine | undefined {
  return result.looks[0]?.scoreBreakdown.find(line => line.signal === 'FRESHNESS');
}

/**
 * Ayer respecto a la fecha fija de los casos.
 * @returns {string}
 */
function yesterday(): string {
  return new Date(fixedNow.getTime() - millisecondsPerDay).toISOString();
}

describe('generateLooks — reglas duras', () => {
  it('sólo usa prendas que existen en el clóset del usuario', () => {
    const garments = basicCloset();
    const closetIds = new Set(garments.map(garment => garment.id));

    const result = generateLooks(makeInput(garments));

    expect(result.looks.length).toBeGreaterThan(0);
    for (const look of result.looks) {
      for (const garmentId of idsOf(look)) {
        expect(closetIds.has(garmentId)).toBe(true);
      }
    }
  });

  it('todo look trae base completa y calzado', () => {
    const result = generateLooks(makeInput(basicCloset()));

    for (const look of result.looks) {
      const slots = slotsOf(look);
      expect(slots).toContain('FOOTWEAR');
      const hasSeparates = slots.includes('TOP') && slots.includes('BOTTOM');
      expect(hasSeparates || slots.includes('FULL_BODY')).toBe(true);
    }
  });

  it('no propone lo que está en la lavandería', () => {
    const garments = basicCloset().map(garment =>
      garment.id === jeanId ? { ...garment, status: 'LAUNDRY' as const } : garment,
    );

    const result = generateLooks(makeInput(garments));

    expect(result.looks.every(look => !idsOf(look).includes(jeanId))).toBe(true);
    expect(result.excluded.some(entry => entry.garmentId === jeanId)).toBe(true);
  });

  it('la generación automática ignora las prendas sin confirmar', () => {
    const garments = basicCloset().map(garment =>
      garment.slot === 'BOTTOM' ? { ...garment, taggingStatus: 'SUGGESTED' as const } : garment,
    );

    const automatic = generateLooks(makeInput(garments));
    const explicit = generateLooks(
      makeInput(garments, { request: makeRequest({ includeSuggested: true }) }),
    );

    expect(automatic.looks).toHaveLength(0);
    expect(automatic.diagnostics.missingSlots).toContain('BOTTOM');
    expect(explicit.looks.length).toBeGreaterThan(0);
  });

  it('descarta por clima incompatible y explica el motivo', () => {
    const garments = [
      ...basicCloset(),
      makeGarment('99999999-9999-4999-8999-999999999999', 'Parka', 'OUTERWEAR', {
        garmentTypeName: 'Parka',
        weatherMinC: -10,
        weatherMaxC: 10,
      }),
    ];

    const result = generateLooks(
      makeInput(garments, { request: makeRequest({ temperatureC: 28 }) }),
    );

    const parka = result.excluded.find(entry => entry.name === 'Parka');
    expect(parka?.rule).toBe('weather');
    expect(parka?.reason).toContain('demasiado calor');
  });

  it('excluye los colores que el usuario declaró evitar', () => {
    const profile = makeProfile({ avoidedColors: ['Negro'] });

    const result = generateLooks(makeInput(basicCloset(), { profile }));

    expect(result.looks.length).toBeGreaterThan(0);
    for (const look of result.looks) {
      expect(look.items.every(item => item.colorName !== 'Negro')).toBe(true);
    }
  });
});

describe('generateLooks — mustInclude', () => {
  it('todos los looks contienen la prenda pedida', () => {
    const result = generateLooks(
      makeInput(basicCloset(), { request: makeRequest({ mustIncludeGarmentId: jeanId }) }),
    );

    expect(result.looks.length).toBeGreaterThan(0);
    expect(result.looks.every(look => idsOf(look).includes(jeanId))).toBe(true);
  });

  it('una prenda que no es del usuario no se ignora en silencio', () => {
    const result = generateLooks(
      makeInput(basicCloset(), {
        request: makeRequest({ mustIncludeGarmentId: '99999999-9999-4999-8999-999999999999' }),
      }),
    );

    expect(result.looks).toHaveLength(0);
    expect(result.diagnostics.note).toContain('no está en tu clóset');
  });

  it('una prenda pedida gana a un color evitado, pero no a la lavandería', () => {
    const profile = makeProfile({ avoidedColors: ['Negro'] });
    const requested = generateLooks(
      makeInput(basicCloset(), {
        profile,
        request: makeRequest({ mustIncludeGarmentId: blackTeeId }),
      }),
    );

    expect(requested.looks.every(look => idsOf(look).includes(blackTeeId))).toBe(true);

    const inLaundry = basicCloset().map(garment =>
      garment.id === blackTeeId ? { ...garment, status: 'LAUNDRY' as const } : garment,
    );
    const unavailable = generateLooks(
      makeInput(inLaundry, { request: makeRequest({ mustIncludeGarmentId: blackTeeId }) }),
    );

    expect(unavailable.looks).toHaveLength(0);
    expect(unavailable.diagnostics.note).toContain('Camiseta negra');
    expect(unavailable.diagnostics.note).toContain('lavandería');
  });
});

describe('generateLooks — diagnóstico en vez de inventar', () => {
  it('sin calzado no devuelve nada y dice qué falta', () => {
    const withoutFootwear = basicCloset().filter(garment => garment.slot !== 'FOOTWEAR');

    const result = generateLooks(makeInput(withoutFootwear));

    expect(result.looks).toHaveLength(0);
    expect(result.diagnostics.missingSlots).toEqual(['FOOTWEAR']);
    expect(result.diagnostics.note).toContain('calzado');
  });

  it('sin nada formal, no promete smart casual: avisa del techo del clóset', () => {
    const result = generateLooks(
      makeInput(basicCloset(), { request: makeRequest({ styleTag: 'SMART_CASUAL' }) }),
    );
    const [best] = result.looks;
    const [firstNote] = best?.styleNotes ?? [];

    expect(best).toBeDefined();
    expect(firstNote).toContain('lo más cercano a smart casual');
    expect(result.diagnostics.hints.join(' ')).toContain('Tenis blancos');
  });

  it('dentro de la ventana de formalidad no añade ningún aviso', () => {
    const result = generateLooks(
      makeInput(basicCloset(), { request: makeRequest({ styleTag: 'MINIMALIST' }) }),
    );
    const [best] = result.looks;

    expect(best?.styleNotes.join(' ')).not.toContain('lo más cercano');
    expect(result.diagnostics.hints).toHaveLength(0);
  });
});

describe('generateLooks — base FULL_BODY', () => {
  it('un vestido y unos zapatos ya son un look válido', () => {
    const result = generateLooks(makeInput(dressCloset()));
    const [look] = result.looks;

    expect(look).toBeDefined();
    expect(slotsOf(look as Look)).toContain('FULL_BODY');
    expect(slotsOf(look as Look)).toContain('FOOTWEAR');
    expect(result.diagnostics.missingSlots).toHaveLength(0);
  });

  it('añade la capa cuando la temperatura la justifica y no cuando sobra', () => {
    const cold = generateLooks(
      makeInput(dressCloset(), { request: makeRequest({ temperatureC: 15 }) }),
    );
    const warm = generateLooks(
      makeInput(dressCloset(), { request: makeRequest({ temperatureC: 30 }) }),
    );

    expect(slotsOf(cold.looks[0] as Look)).toContain('MID_LAYER');
    expect(slotsOf(warm.looks[0] as Look)).not.toContain('MID_LAYER');
    expect(warm.excluded.some(entry => entry.name === 'Cárdigan crudo')).toBe(true);
  });
});

describe('generateLooks — composición del look', () => {
  /**
   * Chaqueta con color propio: junto al jean azul empeora la armonía de color, así
   * que una regla de "sólo entra si sube la nota" la deja fuera aunque haga fresco.
   * @returns {Garment}
   */
  function oliveJacket(): Garment {
    return makeGarment('77777777-7777-4777-8777-777777777777', 'Chaqueta oliva', 'OUTERWEAR', {
      garmentTypeName: 'Chaqueta acolchada',
      primaryColorHex: '#4a5a2f',
      primaryColorName: 'Verde oliva',
      formality: 2,
      weatherMinC: -5,
      weatherMaxC: 20,
    });
  }

  it('a temperatura fresca el look lleva capa aunque le cueste armonía de color', () => {
    const closet = [...basicCloset(), oliveJacket()];

    const result = generateLooks(makeInput(closet, { request: makeRequest({ temperatureC: 16 }) }));

    // La nota del conjunto baja al meter un tercer color, y aun así la capa entra:
    // a 16 °C salir sin chaqueta no es una opción de estilo, es pasar frío.
    for (const look of result.looks) {
      expect(slotsOf(look)).toContain('OUTERWEAR');
    }
  });

  it('a temperatura templada la misma capa deja de aparecer', () => {
    const closet = [...basicCloset(), oliveJacket()];

    const result = generateLooks(makeInput(closet, { request: makeRequest({ temperatureC: 22 }) }));

    expect(slotsOf(result.looks[0] as Look)).not.toContain('OUTERWEAR');
  });

  it('sin ninguna capa en el clóset el fresco no inventa una', () => {
    const result = generateLooks(
      makeInput(basicCloset(), { request: makeRequest({ temperatureC: 16 }) }),
    );

    expect(result.looks.length).toBeGreaterThan(0);
    expect(slotsOf(result.looks[0] as Look)).not.toContain('OUTERWEAR');
  });

  it('un accesorio que no estorba entra en el look', () => {
    // No mejora ninguna señal —un cinturón negro no cambia la formalidad ni la
    // paleta— y ése es justo el motivo por el que antes no entraba nunca.
    const belt = makeGarment(
      '88888888-8888-4888-8888-888888888888',
      'Cinturón negro',
      'ACCESSORY',
      {
        garmentTypeName: 'Cinturón',
      },
    );

    const result = generateLooks(makeInput([...basicCloset(), belt]));

    expect(slotsOf(result.looks[0] as Look)).toContain('ACCESSORY');
  });

  it('un segundo estampado llamativo sigue quedándose fuera', () => {
    const loudTop = makeGarment('99999999-9999-4999-8999-999999999999', 'Camisa floral', 'TOP', {
      pattern: 'FLORAL',
      patternScale: 'LARGE',
      formality: 2,
    });
    const loudScarf = makeGarment(
      'aaaa1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'Bufanda estampada',
      'ACCESSORY',
      {
        pattern: 'GEOMETRIC',
        patternScale: 'LARGE',
      },
    );

    const result = generateLooks(
      makeInput([loudTop, loudScarf, ...basicCloset()], {
        request: makeRequest({ mustIncludeGarmentId: loudTop.id, limit: 1 }),
      }),
    );

    expect(idsOf(result.looks[0] as Look)).toContain(loudTop.id);
    expect(idsOf(result.looks[0] as Look)).not.toContain(loudScarf.id);
  });
});

describe('generateLooks — ajuste y perfil', () => {
  it('con altura declarada, las notas de ajuste la citan sin inventar medidas', () => {
    const profile = makeProfile({ heightCm: 165 });

    const result = generateLooks(makeInput(basicCloset(), { profile }));
    const [look] = result.looks;

    expect(look?.fitNotes.join(' ')).toContain('165 cm');
  });

  it('sin datos de perfil no hay notas de ajuste inventadas', () => {
    const result = generateLooks(makeInput(basicCloset()));
    const [look] = result.looks;

    expect(look?.fitNotes).toHaveLength(0);
  });

  it('premia el corte que el usuario marcó como cómodo', () => {
    const relaxed = makeProfile({ preferredFits: ['RELAXED'] });
    const garments = basicCloset().map(garment =>
      garment.id === jeanId ? { ...garment, fit: 'RELAXED' as const } : garment,
    );

    const result = generateLooks(makeInput(garments, { profile: relaxed }));
    const [look] = result.looks;

    expect(look?.fitNotes.join(' ')).toContain('holgado');
  });
});

describe('generateLooks — variedad y determinismo', () => {
  it('no repite el mismo núcleo en dos looks seguidos', () => {
    const result = generateLooks(makeInput(basicCloset(), { request: makeRequest({ limit: 3 }) }));
    const cores = result.looks.map(look =>
      look.items
        .filter(item => item.role !== 'ACCESSORY' && item.role !== 'LAYER')
        .map(item => item.garmentId)
        .sort()
        .join('|'),
    );

    expect(new Set(cores).size).toBe(cores.length);
  });

  it('la misma petición devuelve exactamente los mismos looks', () => {
    const first = generateLooks(makeInput(basicCloset()));
    const second = generateLooks(makeInput(basicCloset()));

    expect(first.looks.map(look => look.id)).toEqual(second.looks.map(look => look.id));
    expect(first.looks[0]?.engineScore).toBe(second.looks[0]?.engineScore);
  });

  it('la señal de variedad baja cuando el conjunto repite prenda reciente', () => {
    const worn = basicCloset().map(garment =>
      garment.id === sneakersId ? { ...garment, lastWornAt: yesterday() } : garment,
    );

    const fresh = freshnessLine(generateLooks(makeInput(basicCloset())));
    const repeated = freshnessLine(generateLooks(makeInput(worn)));

    expect(repeated?.score ?? 1).toBeLessThan(fresh?.score ?? 0);
    expect(repeated?.reason).toContain('Tenis blancos');
  });

  it('entre dos prendas equivalentes prefiere la que no acabas de usar', () => {
    const worn = basicCloset().map(garment =>
      garment.id === blackTeeId ? { ...garment, lastWornAt: yesterday() } : garment,
    );

    const result = generateLooks(makeInput(worn, { request: makeRequest({ limit: 1 }) }));

    expect(idsOf(result.looks[0] as Look)).not.toContain(blackTeeId);
  });
});

describe('generateLooks — ficha', () => {
  it('la paleta y las prendas salen de datos reales del clóset', () => {
    const result = generateLooks(
      makeInput(basicCloset(), { request: makeRequest({ mustIncludeGarmentId: chinoId }) }),
    );
    const [look] = result.looks;
    const closetHexes = new Set(basicCloset().map(garment => garment.primaryColorHex));

    expect(look?.colorPalette.every(hex => closetHexes.has(hex))).toBe(true);
    expect(look?.items.every(item => item.why.length > 0)).toBe(true);
    expect(look?.occasions.length).toBeGreaterThan(0);
    expect(look?.scoreBreakdown.map(line => line.signal)).toEqual(LookScoreSignalEnum.options);
  });

  it('el rango térmico del look es la intersección de sus prendas', () => {
    const result = generateLooks(
      makeInput(basicCloset(), { request: makeRequest({ mustIncludeGarmentId: chinoId }) }),
    );
    const [look] = result.looks;

    expect(look?.weatherMinC).toBe(16);
    expect(look?.weatherMaxC).toBe(30);
  });
});

describe('resolveTemperatureC', () => {
  it('la temperatura exacta manda sobre el clima y sobre el perfil', () => {
    const profile = makeProfile({ climate: 'COLD' });
    const request = {
      styleTag: 'MINIMALIST' as const,
      temperatureC: 22,
      climate: 'HOT' as const,
      mustIncludeGarmentId: null,
      includeSuggested: false,
      limit: 3,
    };

    expect(resolveTemperatureC(request, profile)).toBe(22);
    expect(resolveTemperatureC({ ...request, temperatureC: null }, profile)).toBe(30);
    expect(resolveTemperatureC({ ...request, temperatureC: null, climate: null }, profile)).toBe(6);
  });

  it('sin ningún dato de clima, el motor no filtra por temperatura', () => {
    const request = toEngineRequest(
      {
        styleTag: 'MINIMALIST',
        temperatureC: null,
        climate: null,
        mustIncludeGarmentId: null,
        includeSuggested: false,
        limit: 3,
      },
      makeProfile(),
    );

    expect(request.temperatureC).toBeNull();
  });
});
