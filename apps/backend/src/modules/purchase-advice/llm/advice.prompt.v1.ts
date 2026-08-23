import {
  enumLabels,
  formalityLabel,
  type Garment,
  type PurchaseMeasurement,
  type StyleProfile,
} from '@closetai/shared-types';

/**
 * Prompt de "¿me lo compro?", versión 1.
 *
 * Va versionado y su versión se guarda en `PurchaseAdvice.promptVersion`: la
 * redacción de un LLM no es reproducible, así que comparar dos versiones sobre la
 * misma prenda exige saber cuál escribió cada veredicto.
 *
 * Dos decisiones sostienen el resto:
 *
 * - **El veredicto llega decidido.** El modelo no elige si conviene comprarla: eso
 *   sale de reglas sobre lo que midió el motor. Si el veredicto es negativo, el
 *   prompt le prohíbe darle la vuelta.
 * - **Sólo puede emparejarla con ropa que existe.** Las prendas del usuario viajan
 *   como ids cortos declarados como enum, y el servidor las vuelve a resolver.
 */

/** Versión del prompt + esquema del veredicto. Sube si cambia cualquiera de los dos. */
export const advicePromptVersion = 'advice-v1';

/** Una prenda del usuario tal como se le enseña al modelo. */
export interface IAdvicePromptGarment {
  shortId: string;
  name: string;
  typeName: string;
  slotLabel: string;
  colorName: string;
  formality: number;
}

export interface IAdvicePromptInput {
  profile: StyleProfile;
  candidate: Garment;
  measurement: PurchaseMeasurement;
  /** Prendas propias con las que el motor la combinó, ya con su id corto. */
  pairedGarments: readonly IAdvicePromptGarment[];
  /** Nombres de las prendas propias que haría el mismo papel. */
  duplicateNames: readonly string[];
}

export const adviceInstructions = [
  'Ayudas a alguien que está de pie en una tienda decidiendo si comprarse una prenda concreta.',
  'Un motor determinista ya midió qué pasaría con su clóset si la comprara, y **el veredicto ya está tomado**.',
  '',
  'Reglas que no puedes romper:',
  '1. El veredicto te llega dado. No lo cambies, no lo suavices y no lo contradigas.',
  '   Si es "no te la recomiendo", tu texto dice que no; si es "opcional", no la vendas como imprescindible.',
  '2. Sólo existen las prendas de SU CLÓSET, citadas por su id corto (`g1`, `g2`…).',
  '   No menciones ninguna otra: si no está en esa lista, el usuario no la tiene.',
  '3. Usa **los números que te doy** y ninguno más. No inventes cuántos conjuntos abre.',
  '4. Nada de precio, disponibilidad, tiendas, descuentos ni urgencia comercial.',
  '5. `stylingNotes` son hasta tres formas concretas de combinarla, nombrando prendas suyas.',
  '   Déjalas vacías si el veredicto es negativo: nadie quiere consejos para lo que no debería comprar.',
  '6. `pairedGarmentIds` son las prendas que citas en tus notas. Deja la lista vacía si no citas ninguna.',
  '7. No describas ni juzgues el cuerpo de la persona, y no infieras nada que no te haya declarado.',
  '8. Escribe en español, en segunda persona, corto y sin adornos.',
].join('\n');

/**
 * Construye el mensaje del usuario en bloques nombrados.
 * @param {IAdvicePromptInput} input - Perfil, candidata, medición y prendas propias.
 * @returns {string}
 */
export function buildAdvicePrompt(input: IAdvicePromptInput): string {
  return [
    ...block('PERFIL', profileLines(input.profile)),
    ...block('LA PRENDA QUE ESTÁ MIRANDO', candidateLines(input.candidate)),
    ...block('VEREDICTO YA DECIDIDO', verdictLines(input.measurement)),
    ...block('LO QUE MIDIÓ EL MOTOR', measurementLines(input.measurement)),
    ...block(
      'SU CLÓSET (prendas con las que el motor la combinó)',
      input.pairedGarments.map(describeGarment),
    ),
    ...block(
      'LO QUE YA TIENE PARECIDO',
      input.duplicateNames.map(name => `- ${name}`),
    ),
    '',
    'Redacta el titular, la explicación y las notas de combinación de ese veredicto.',
  ].join('\n');
}

/**
 * Envuelve un bloque con su título; si no tiene líneas, el bloque no aparece.
 * @param {string} title - Título del bloque.
 * @param {readonly string[]} lines - Líneas del bloque.
 * @returns {string[]}
 */
function block(title: string, lines: readonly string[]): string[] {
  return lines.length === 0 ? [] : ['', `${title}:`, ...lines];
}

/**
 * Lo que el usuario declaró y que acota el consejo. Lo que no declaró no
 * aparece, ni como "desconocido"; el peso y la complexión no aparecen nunca.
 * @param {StyleProfile} profile - Perfil del usuario.
 * @returns {string[]}
 */
function profileLines(profile: StyleProfile): string[] {
  const lines = [
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
    profile.climate !== null ? `- Clima habitual: ${enumLabels.climate[profile.climate]}` : null,
  ];
  return lines.filter((line): line is string => line !== null);
}

/**
 * La candidata con los atributos que el usuario revisó antes de medir.
 * @param {Garment} candidate - Prenda que se está evaluando.
 * @returns {string[]}
 */
function candidateLines(candidate: Garment): string[] {
  return [
    `- ${candidate.name} (${candidate.garmentTypeName}, ${enumLabels.garmentSlot[candidate.slot].toLowerCase()}).`,
    `- Color ${candidate.primaryColorName}, ${enumLabels.garmentPattern[candidate.pattern].toLowerCase()}, ${enumLabels.garmentMaterial[candidate.material].toLowerCase()}.`,
    `- Corte ${enumLabels.fitPreference[candidate.fit].toLowerCase()}, formalidad ${formalityLabel(candidate.formality).toLowerCase()}.`,
  ];
}

/**
 * El veredicto y su motivo, tal como los decidió el servidor.
 * @param {PurchaseMeasurement} measurement - Medición ya resuelta.
 * @returns {string[]}
 */
function verdictLines(measurement: PurchaseMeasurement): string[] {
  return [
    `- Veredicto: ${enumLabels.purchaseVerdict[measurement.verdict]}.`,
    `- Motivo: ${enumLabels.purchaseVerdictReason[measurement.verdictReason].toLowerCase()}.`,
  ];
}

/**
 * Los números del motor. Son los únicos que el modelo puede citar.
 * @param {PurchaseMeasurement} measurement - Medición ya resuelta.
 * @returns {string[]}
 */
function measurementLines(measurement: PurchaseMeasurement): string[] {
  const { impact } = measurement;
  if (impact === null) {
    return [];
  }
  const lines = [
    `- Entra en ${impact.outfitsUsingItEstimate} conjunto(s) de los que el motor sabe armar.`,
    `- De ésos, ${impact.unlockedOutfitsEstimate} son imposibles sin ella.`,
    `- Sube ${impact.scoreGainPoints} punto(s) la nota del mejor conjunto.`,
  ];
  if (impact.newlyCoveredScenarioLabels.length > 0) {
    lines.push(`- Con ella podría vestirse para: ${impact.newlyCoveredScenarioLabels.join(', ')}.`);
  }
  if (impact.matchedGapId !== null) {
    lines.push('- Cubre una prenda que ya tenía apuntada en su lista de la compra.');
  }
  return lines;
}

/**
 * Una prenda del usuario con lo que hace falta para citarla.
 * @param {IAdvicePromptGarment} garment - Prenda propia con su id corto.
 * @returns {string}
 */
function describeGarment(garment: IAdvicePromptGarment): string {
  const formality = formalityLabel(garment.formality).toLowerCase();
  const detail = [garment.typeName, garment.slotLabel, garment.colorName, formality].join(', ');
  return `- ${garment.shortId} · ${garment.name} (${detail})`;
}
