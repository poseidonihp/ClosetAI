import {
  enumLabels,
  formalityLabel,
  type CoverageColor,
  type CoverageScenario,
  type CoverageSlot,
  type GapHypothesis,
  type StyleProfile,
  type WardrobeCoverage,
} from '@closetai/shared-types';

/**
 * Prompt del análisis de vacíos, versión 1.
 *
 * Va versionado y su versión se guarda en `WardrobeGap.promptVersion`: la
 * redacción de un LLM no es reproducible, así que la única forma de saber si un
 * cambio de prompt mejora o empeora es comparar dos versiones sobre el mismo
 * clóset, y para eso hay que saber cuál produjo cada brecha.
 *
 * Dos decisiones sostienen el resto:
 *
 * - **El modelo no decide qué falta, decide qué comprar primero.** La matriz y las
 *   prendas candidatas llegan calculadas por el motor, con sus números. Lo que se
 *   le pide es ordenarlas y explicarlas, que es lo que un algoritmo no sabe hacer.
 * - **Nada de precios ni de disponibilidad.** Las marcas son referencias de estilo
 *   filtradas por país y presupuesto; afirmar que algo cuesta X o que está en
 *   stock sería inventarse un dato que este sistema no tiene.
 */

/** Versión del prompt + esquema del análisis. Sube si cambia cualquiera de los dos. */
export const gapsPromptVersion = 'gaps-v1';

export interface IGapsPromptInput {
  profile: StyleProfile;
  coverage: WardrobeCoverage;
  hypotheses: readonly GapHypothesis[];
}

export const gapsInstructions = [
  'Eres quien ayuda a decidir la próxima compra de ropa de una persona concreta.',
  'Recibes la cobertura real de su clóset —calculada prenda a prenda, no estimada— y una lista corta de',
  'prendas candidatas que un motor determinista ya probó a añadir, con lo que desbloquearía cada una.',
  '',
  'Reglas que no puedes romper:',
  '1. Sólo existen las prendas de PRENDAS CANDIDATAS, citadas por su id (`h1`, `h2`…).',
  '   No propongas ninguna otra: la lista sale de medir qué pasa al añadirla al clóset de verdad.',
  '2. Devuélvelas ordenadas de la que más conviene comprar a la que menos. Ese orden ES la prioridad.',
  '3. Puedes devolver menos de las que te doy, y ninguna si crees que ninguna merece el gasto.',
  '   Devolver una lista larga por rellenar es peor que devolver dos brechas que de verdad valen.',
  '4. `description` es la prenda concreta en una línea: tipo, color y corte ("chaqueta de cuero negra,',
  '   corte regular"). El tipo y el color te vienen dados; no los cambies, sólo redáctalos.',
  '5. `reason` explica qué desbloquea y por qué va en ese puesto, **usando los números que te doy**.',
  '   No inventes cuántos conjuntos abre ni cuánto cuesta: si no está en los datos, no lo digas.',
  '6. `referenceBrands` son marcas que orientan sobre el estilo y el rango de precio en su país.',
  '   No afirmes precio ni disponibilidad, y déjalas vacías si no tienes nada razonable para su mercado.',
  '7. Nunca digas ni des a entender que ya tiene una prenda que no aparece en la cobertura.',
  '8. `note` es para un supuesto que el usuario deba conocer, o null si no hay ninguno.',
  '9. Escribe en español, en segunda persona y sin exagerar. Nada de urgencia comercial.',
].join('\n');

/**
 * Construye el mensaje del usuario en bloques nombrados.
 * @param {IGapsPromptInput} input - Perfil, cobertura y prendas candidatas.
 * @returns {string}
 */
export function buildGapsPrompt(input: IGapsPromptInput): string {
  return [
    ...block('PERFIL', profileLines(input.profile)),
    ...block('COBERTURA ACTUAL', coverageLines(input.coverage)),
    ...block('LO QUE TIENE POR PARTE DEL CUERPO', input.coverage.slots.map(describeSlot)),
    ...block('PALETA DEL CLÓSET', input.coverage.colors.map(describeColor)),
    ...block('ESCENARIOS EVALUADOS', input.coverage.scenarios.map(describeScenario)),
    ...block('PRENDAS CANDIDATAS', input.hypotheses.map(describeHypothesis)),
    '',
    `Devuelve como mucho ${input.hypotheses.length} brechas, ordenadas por prioridad.`,
  ].join('\n');
}

/**
 * Envuelve un bloque con su título; si no tiene líneas, el bloque no aparece.
 * @param {string} title - Título del bloque.
 * @param {readonly string[]} lines - Líneas del bloque.
 * @returns {string[]}
 */
function block(title: string, lines: readonly string[]): string[] {
  if (lines.length === 0) {
    return [];
  }
  return ['', `${title}:`, ...lines];
}

/**
 * Lo que el usuario declaró y que acota las marcas: presupuesto, país, moneda y
 * clima. Lo que no declaró no aparece, ni como "desconocido".
 * @param {StyleProfile} profile - Perfil del usuario.
 * @returns {string[]}
 */
function profileLines(profile: StyleProfile): string[] {
  const lines = [
    profile.gender !== null && profile.gender !== 'UNSPECIFIED'
      ? `- Género declarado: ${enumLabels.gender[profile.gender]}`
      : null,
    profile.styleArchetypes.length > 0
      ? `- Estilos con los que se identifica: ${profile.styleArchetypes
          .map(archetype => enumLabels.styleArchetype[archetype])
          .join(', ')}`
      : null,
    profile.preferredFits.length > 0
      ? `- Cortes que le resultan cómodos: ${profile.preferredFits
          .map(fit => enumLabels.fitPreference[fit])
          .join(', ')}`
      : null,
    profile.avoidedColors.length > 0
      ? `- Colores que evita: ${profile.avoidedColors.join(', ')}`
      : null,
    profile.budgetTier !== null
      ? `- Presupuesto: ${enumLabels.budgetTier[profile.budgetTier]}`
      : null,
    placeLine(profile),
    profile.heightCm !== null ? `- Altura: ${profile.heightCm} cm` : null,
  ];
  return lines.filter((line): line is string => line !== null);
}

/**
 * País, moneda, ciudad y clima: es lo que acota las marcas de referencia.
 * @param {StyleProfile} profile - Perfil del usuario.
 * @returns {string | null}
 */
function placeLine(profile: StyleProfile): string | null {
  const parts = [
    profile.city,
    profile.country,
    profile.currency,
    profile.climate === null ? null : enumLabels.climate[profile.climate],
  ].filter((part): part is string => part !== null && part.length > 0);
  return parts.length > 0 ? `- Dónde vive y con qué compra: ${parts.join(' · ')}` : null;
}

/**
 * Resumen numérico de la cobertura.
 * @param {WardrobeCoverage} coverage - Matriz ya calculada.
 * @returns {string[]}
 */
function coverageLines(coverage: WardrobeCoverage): string[] {
  const uncovered = coverage.uncoveredScenarioIds.length;
  return [
    `- Prendas en el clóset: ${coverage.closetSize}; utilizables hoy por el motor: ${coverage.eligibleCount}.`,
    `- Conjuntos distintos que puede armar hoy: ${coverage.distinctOutfits}.`,
    `- Escenarios evaluados: ${coverage.scenarios.length}; sin ningún conjunto posible: ${uncovered}.`,
  ];
}

/**
 * Qué tiene el usuario en un slot y en qué franja de formalidad.
 * @param {CoverageSlot} slot - Fila de la matriz por slot.
 * @returns {string}
 */
function describeSlot(slot: CoverageSlot): string {
  const label = enumLabels.garmentSlot[slot.slot];
  if (slot.availableCount === 0) {
    const owned = slot.totalCount > 0 ? ` (tiene ${slot.totalCount} sin poder usar)` : '';
    return `- ${label}: ninguna disponible${owned}.`;
  }
  const range =
    slot.minFormality === slot.maxFormality
      ? formalityLabel(slot.minFormality ?? 0).toLowerCase()
      : `${formalityLabel(slot.minFormality ?? 0).toLowerCase()} a ${formalityLabel(slot.maxFormality ?? 0).toLowerCase()}`;
  return `- ${label}: ${slot.availableCount} disponible(s), formalidad de ${range}.`;
}

/**
 * Una familia de color de la paleta con cuántas prendas la usan.
 * @param {CoverageColor} color - Entrada de la paleta.
 * @returns {string}
 */
function describeColor(color: CoverageColor): string {
  return `- ${color.label}: ${color.count} prenda(s).`;
}

/**
 * Un escenario con lo que el motor pudo armar en él.
 * @param {CoverageScenario} scenario - Escenario evaluado.
 * @returns {string}
 */
function describeScenario(scenario: CoverageScenario): string {
  if (scenario.outfitCount === 0) {
    const missing = scenario.missingSlots
      .map(slot => enumLabels.garmentSlot[slot].toLowerCase())
      .join(', ');
    const detail = missing.length > 0 ? ` Le falta: ${missing}.` : '';
    return `- ${scenario.label}: ningún conjunto posible.${detail}`;
  }
  const layer =
    scenario.needsLayer && !scenario.hasLayer ? ' A esa temperatura le falta una capa.' : '';
  return `- ${scenario.label}: ${scenario.outfitCount} conjunto(s), el mejor con nota ${scenario.bestEngineScore}/100.${layer}`;
}

/**
 * Una prenda candidata con todo lo que midió el motor.
 * @param {GapHypothesis} hypothesis - Prenda hipotética evaluada.
 * @returns {string}
 */
function describeHypothesis(hypothesis: GapHypothesis): string {
  const head = `- ${hypothesis.id} · ${hypothesis.garmentTypeName} ${hypothesis.colorName.toLowerCase()}`;
  const slot = enumLabels.garmentSlot[hypothesis.slot].toLowerCase();
  const formality = formalityLabel(hypothesis.formality).toLowerCase();
  return `${head} (${slot}, ${formality}) · ${hypothesis.rationale}`;
}
