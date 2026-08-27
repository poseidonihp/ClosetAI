import {
  enumLabels,
  formalityLabel,
  type Garment,
  type GarmentSlot,
  type PurchaseMeasurement,
  type StyleProfile,
} from '@closetai/shared-types';

/**
 * Prompt de "¿me lo compro?", versión 2.
 *
 * Va versionado y su versión se guarda en `PurchaseAdvice.promptVersion`: la
 * redacción de un LLM no es reproducible, así que comparar dos versiones sobre la
 * misma prenda exige saber cuál escribió cada veredicto. La v1 vive en el
 * historial de git.
 *
 * Lo que arregla la v2: **el modelo no aportaba nada**. Recibía un veredicto ya
 * tomado y sus tres campos de texto lo parafraseaban, cuando la pantalla ya
 * enseña ese veredicto con su etiqueta y sus números al lado. La llamada pagada
 * producía una segunda versión de algo que el usuario ya estaba leyendo.
 *
 * Dos decisiones sostienen el resto:
 *
 * - **El veredicto sigue siendo del código y ahora además no se repite.** No se le
 *   da al modelo ningún campo donde cambiarlo, y se le prohíbe volver a
 *   enunciarlo: su texto empieza donde el veredicto acaba, en qué hace ahora con
 *   la prenda.
 * - **La alternativa sale de sus brechas, no de la imaginación del modelo.** Lo
 *   único que un algoritmo no sabe decir es "ésta no, pero lo que te falta de
 *   verdad es aquello". Las brechas abiertas ya estaban calculadas y ordenadas por
 *   la Fase 5 y sólo se usaban para un booleano; ahora viajan como ids cortos
 *   `b1..bN` declarados como enum, igual que las prendas.
 */

/** Versión del prompt + esquema del veredicto. Sube si cambia cualquiera de los dos. */
export const advicePromptVersion = 'advice-v2';

/** Una prenda del usuario tal como se le enseña al modelo. */
export interface IAdvicePromptGarment {
  shortId: string;
  name: string;
  typeName: string;
  slotLabel: string;
  colorName: string;
  formality: number;
}

/** Una brecha abierta, ofrecida como posible alternativa de compra. */
export interface IAdvicePromptGap {
  shortId: string;
  description: string;
  slot: GarmentSlot;
  formality: number;
  priority: number;
  unlockedOutfitsEstimate: number;
}

export interface IAdvicePromptInput {
  profile: StyleProfile;
  candidate: Garment;
  measurement: PurchaseMeasurement;
  /** Prendas propias con las que el motor la combinó, ya con su id corto. */
  pairedGarments: readonly IAdvicePromptGarment[];
  /** Nombres de las prendas propias que harían el mismo papel. */
  duplicateNames: readonly string[];
  /** Brechas abiertas entre las que puede elegir qué comprar en su lugar. */
  openGaps: readonly IAdvicePromptGap[];
  /** Si viaja la portada de la prenda. Sin ella el prompt no la menciona. */
  hasPhoto: boolean;
}

export const adviceInstructions = [
  'Ayudas a alguien que está de pie en una tienda decidiendo si comprarse una prenda concreta.',
  'Un motor determinista ya midió qué pasaría con su clóset si la comprara, y **el veredicto ya está tomado**.',
  'El usuario lo está viendo en pantalla ahora mismo, con su etiqueta y sus números al lado de tu texto.',
  '',
  'Reglas que no puedes romper:',
  '1. **No repitas el veredicto ni lo parafrasees.** Ya lo leyó. Tu texto empieza donde ese veredicto acaba:',
  '   qué hace ahora con esta prenda. Un titular que vuelve a decir "no te conviene" ocupa sitio y no informa.',
  '2. Tampoco lo contradigas ni lo suavices. Si es negativo, todo lo que escribas da por hecho que no la compra.',
  '3. Sólo existen las prendas de SU CLÓSET, citadas por su id corto (`g1`, `g2`…).',
  '   No menciones ninguna otra: si no está en esa lista, el usuario no la tiene.',
  '4. Usa **los números que te doy** y ninguno más. No inventes cuántos conjuntos abre.',
  '5. `stylingNotes` son hasta tres formas concretas de combinarla, nombrando prendas suyas y distintas entre sí.',
  '   Déjalas vacías si el veredicto es negativo: nadie quiere consejos para lo que no debería comprar.',
  '6. `pairedGarmentIds` son las prendas que citas en tus notas. Deja la lista vacía si no citas ninguna.',
  '7. `alternativeGapId` es qué comprar **en su lugar**, elegido de SU LISTA DE LA COMPRA (`b1`, `b2`…).',
  '   Rellénalo sólo si el veredicto no es "te la recomiendo" y alguna de esas brechas le sirve más que esta prenda.',
  '   Ponlo a null si el veredicto es positivo, si no hay lista o si ninguna encaja. Nunca propongas algo que no esté ahí.',
  '8. `alternativeNote` dice por qué ésa y no la que está mirando, con los números de la lista. Null si no hay alternativa.',
  '9. Nada de precio, disponibilidad, tiendas, descuentos ni urgencia comercial.',
  '10. La foto, si la hay, es de la prenda. Describe la prenda y nunca a la persona que pueda aparecer en ella:',
  '    ni su cuerpo, ni su edad, ni su aspecto. No infieras nada que el usuario no te haya declarado.',
  '11. Escribe en español, en segunda persona, corto y sin adornos.',
].join('\n');

/**
 * Construye el mensaje del usuario en bloques nombrados.
 * @param {IAdvicePromptInput} input - Perfil, candidata, medición, clóset y brechas.
 * @returns {string}
 */
export function buildAdvicePrompt(input: IAdvicePromptInput): string {
  return [
    ...block('PERFIL', profileLines(input.profile)),
    ...block('LA PRENDA QUE ESTÁ MIRANDO', candidateLines(input)),
    ...block(
      'VEREDICTO YA DECIDIDO (lo tiene delante, no lo repitas)',
      verdictLines(input.measurement),
    ),
    ...block('LO QUE MIDIÓ EL MOTOR', measurementLines(input.measurement)),
    ...block(
      'SU CLÓSET (prendas con las que el motor la combinó)',
      input.pairedGarments.map(describeGarment),
    ),
    ...block(
      'LO QUE YA TIENE PARECIDO',
      input.duplicateNames.map(name => `- ${name}`),
    ),
    ...block(
      'SU LISTA DE LA COMPRA (brechas abiertas, ya medidas por el motor)',
      input.openGaps.map(describeGap),
    ),
    '',
    'Escribe qué hace ahora con esta prenda y, si procede, qué le conviene más de su lista.',
  ].join('\n');
}

/**
 * Envuelve un bloque con su título; si no tiene líneas, el bloque no aparece. Un
 * bloque vacío invita a rellenarlo, y aquí lo que no se sabe no se dice.
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
 * @param {IAdvicePromptInput} input - Entrada completa del prompt.
 * @returns {string[]}
 */
function candidateLines(input: IAdvicePromptInput): string[] {
  const { candidate } = input;
  const lines = [
    `- ${candidate.name} (${candidate.garmentTypeName}, ${enumLabels.garmentSlot[candidate.slot].toLowerCase()}).`,
    `- Color ${candidate.primaryColorName}, ${enumLabels.garmentPattern[candidate.pattern].toLowerCase()}, ${enumLabels.garmentMaterial[candidate.material].toLowerCase()}.`,
    `- Corte ${enumLabels.fitPreference[candidate.fit].toLowerCase()}, formalidad ${formalityLabel(candidate.formality).toLowerCase()}.`,
  ];
  if (input.hasPhoto) {
    lines.push('- La foto adjunta es esta prenda; los atributos de arriba salieron de ella.');
  }
  return lines;
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

/**
 * Una brecha abierta con lo que justifica proponerla en lugar de la candidata.
 * @param {IAdvicePromptGap} gap - Brecha pendiente con su id corto.
 * @returns {string}
 */
function describeGap(gap: IAdvicePromptGap): string {
  const slot = enumLabels.garmentSlot[gap.slot].toLowerCase();
  const formality = formalityLabel(gap.formality).toLowerCase();
  const unlocks = `desbloquearía ${gap.unlockedOutfitsEstimate} conjunto(s)`;
  return `- ${gap.shortId} · ${gap.description} (${slot}, ${formality}) · puesto ${gap.priority} de su lista · ${unlocks}`;
}
