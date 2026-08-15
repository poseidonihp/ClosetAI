import {
  enumLabels,
  formalityLabel,
  maxFormality,
  minFormality,
  type GarmentSlot,
  type GenerateOutfitsRequest,
  type StyleProfile,
} from '@closetai/shared-types';
import {
  formalityWindowByStyleTag,
  maxAccessoriesPerOutfit,
  maxLayersPerOutfit,
} from '../engine/engine.constants';

/**
 * Prompt del estilista, versión 2.
 *
 * Va versionado y su versión se guarda en `Outfit.promptVersion`: la redacción de
 * un LLM no es reproducible, así que la única forma de saber si un cambio de prompt
 * mejora o empeora es comparar dos versiones sobre el mismo clóset, y para eso hay
 * que saber cuál produjo cada look. La v1 vive en el historial de git.
 *
 * Lo que arregla la v2: **la composición del look estaba implícita**. El modelo
 * devolvía tres prendas —base, base y calzado— y sólo añadía capa o accesorios si le
 * apetecía, así que dos looks de la misma tanda salían con chaqueta y sin ella sin
 * ningún criterio visible. Ahora la composición objetivo va en su propio bloque y
 * **ya resuelta**: el servidor calcula si la temperatura pide capa y qué accesorios
 * hay, y el modelo recibe la conclusión en vez del dato crudo. La decisión de si
 * hace fresco no es cuestión de gusto y no debería depender de la tirada.
 *
 * La entrada va en **bloques nombrados** y no en un párrafo, porque el modelo tiene
 * que distinguir qué es un dato del usuario, qué es la petición y qué prendas puede
 * usar. Dentro de cada bloque sólo hay datos reales: si el usuario no declaró su
 * altura, la altura no aparece —ni como "desconocida"—, para que no haya nada sobre
 * lo que especular.
 *
 * Dos decisiones que sostienen el resto:
 *
 * - **No se le pide al modelo que no invente ropa, se le impide.** Las prendas
 *   llegan como ids cortos `g1..gN`, el esquema declara `garmentId` como un enum con
 *   esos ids y el servidor vuelve a resolver cada uno contra el clóset. El prompt
 *   sólo explica el formato.
 * - **Se le enseñan las combinaciones que el motor ya validó**, con su nota. No es
 *   una restricción —puede componer otra— pero es lo que hace que casi siempre
 *   devuelva conjuntos completos a la primera en vez de que el servidor tenga que
 *   descartarlos.
 */

/** Versión del prompt + esquema del estilista. Sube si cambia cualquiera de los dos. */
export const stylistPromptVersion = 'stylist-v2';

/** Una prenda tal como se la enseña al modelo: compacta, en español y sin UUID. */
export interface IStylistPromptGarment {
  shortId: string;
  slot: GarmentSlot;
  name: string;
  garmentTypeName: string;
  colorName: string;
  colorHex: string;
  pattern: string;
  material: string;
  fit: string;
  formality: number;
  brand: string | null;
  /** Rango térmico declarado, ya formateado, o null si la prenda no lo tiene. */
  weather: string | null;
}

/** Un conjunto que el motor ya declaró válido, con su nota. */
export interface IStylistPromptCombination {
  shortIds: readonly string[];
  engineScore: number;
}

export interface IStylistPromptInput {
  profile: StyleProfile;
  request: GenerateOutfitsRequest;
  /** Temperatura efectiva tras resolver petición, clima y perfil. */
  resolvedTemperatureC: number | null;
  garments: readonly IStylistPromptGarment[];
  combinations: readonly IStylistPromptCombination[];
  /**
   * Qué debe llevar el look, ya decidido con la temperatura y con lo que hay en el
   * clóset. Va resuelto y no en crudo porque si hace fresco no es una opinión.
   */
  compositionAdvice: readonly string[];
  /** Notas de ajuste que ya resolvió `fit-rules.ts` para este usuario. */
  fitNotes: readonly string[];
  /** Cuántos looks se piden como máximo. */
  limit: number;
  /** Prenda que el usuario exigió incluir, con su id corto, si la hay. */
  mustInclude: { shortId: string; name: string } | null;
  /** Prendas que aparecen en looks que el usuario guardó o se puso. */
  likedGarmentNames: readonly string[];
  /** Motivos por los que rechazó looks anteriores, ya traducidos. */
  rejectionReasons: readonly string[];
  /** Prendas que más usa, por número de usos. */
  mostWornNames: readonly string[];
}

export const stylistInstructions = [
  'Eres el estilista de un clóset personal. Recibes la ropa que el usuario tiene de verdad y compones looks con ella.',
  '',
  'Reglas que no puedes romper:',
  '1. Sólo existen las prendas de la lista PRENDAS DISPONIBLES, citadas por su id (`g1`, `g2`…).',
  '   No nombres ni des por puesta ninguna otra prenda: el usuario ve las fotos de su ropa al lado de tu texto.',
  '2. La base de un look es parte de arriba + parte de abajo + calzado, o una prenda entera + calzado.',
  '3. Encima de esa base va la COMPOSICIÓN que te doy resuelta, y es lo que decide si el look lleva capa.',
  '   Cuando ahí diga que toca capa, el look son CUATRO prendas: las dos de la base, el calzado y la capa.',
  '   No decidas tú si hace fresco: ya está decidido con la temperatura de la petición.',
  '4. Los accesorios (gafas, bufanda, gorra, collar, pulsera, cinturón…) entran si los hay y encajan con el',
  '   estilo y con el clima. Añádelos: son lo que separa un conjunto de ropa de un look. Lo que no encaje,',
  '   fuera — una bufanda a 28 °C sobra por mucho que esté disponible.',
  `5. Como máximo una prenda por parte del cuerpo, ${maxLayersPerOutfit} capas y ${maxAccessoriesPerOutfit} accesorios.`,
  '   Nunca mezcles una prenda entera con una parte de arriba o de abajo, y no repitas prenda dentro de un look.',
  '6. En COMBINACIONES VALIDADAS tienes conjuntos que el motor ya comprobó, de mejor a peor. Empieza por ahí.',
  '   Ya vienen con la capa y los accesorios que corresponden: si les quitas algo, explica por qué en `qualityNote`.',
  '   Puedes componer otro conjunto si crees que queda mejor, pero tiene que cumplir las reglas 2, 3 y 5.',
  '7. Devuelve EXACTAMENTE el número de looks que se te pide, todos distintos entre sí.',
  '   Si dos se diferencian sólo en un accesorio, cambia uno por otro conjunto en vez de repetir.',
  '   Devuelve menos únicamente si la ropa no da para más combinaciones distintas, y dilo en `note`.',
  '8. Si la petición exige una prenda concreta, esa prenda va en TODOS los looks. Un look sin ella se descarta',
  '   en el servidor y el usuario no lo llega a ver, así que devolverlo es perder uno de los looks que pidió.',
  '9. En `items` va una entrada por prenda del look, y `why` dice qué aporta ESA prenda, no el conjunto entero.',
  '10. `fitNotes`: parte de las NOTAS DE AJUSTE que te doy ya resueltas para este usuario.',
  '    Puedes reescribirlas para que suenen naturales, pero no inventes medidas ni digas nada sobre su cuerpo.',
  '    Si no te doy ninguna, deja la lista vacía.',
  '11. `referenceBrands` son marcas que sirven de referencia del ESTILO del look, según su país y presupuesto.',
  '    No son las marcas de su ropa y no afirmes precio ni disponibilidad. Si no tienes nada razonable, déjalas vacías.',
  '12. `qualityNote` admite un compromiso real ("el calzado es lo menos formal del conjunto").',
  '    Nunca un porcentaje ni un número de confianza. Si el look no tiene peros, ponlo en null.',
  '13. `note` dice qué le faltó respecto a lo que pedía, o null si no le faltó nada.',
  '    Nunca sugieras que tiene una prenda que no está en la lista.',
  '14. Escribe en español, en segunda persona y sin exagerar.',
].join('\n');

/**
 * Construye el mensaje del usuario en bloques nombrados.
 * @param {IStylistPromptInput} input - Perfil, petición, prendas y preferencias.
 * @returns {string}
 */
export function buildStylistPrompt(input: IStylistPromptInput): string {
  return [
    ...block('PERFIL', profileLines(input.profile)),
    ...block('PETICIÓN', requestLines(input)),
    ...block('COMPOSICIÓN (ya decidida, no la discutas)', bulletLines(input.compositionAdvice)),
    ...block('PRENDAS DISPONIBLES', input.garments.map(describeGarment)),
    ...block('COMBINACIONES VALIDADAS POR EL MOTOR', combinationLines(input.combinations)),
    ...block('NOTAS DE AJUSTE (ya resueltas para este usuario)', bulletLines(input.fitNotes)),
    ...block('PREFERENCIAS APRENDIDAS', learnedLines(input)),
    '',
    `Devuelve exactamente ${input.limit} looks distintos con su ficha.`,
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
  if (lines.length === 0) {
    return [];
  }
  return ['', `${title}:`, ...lines];
}

/**
 * Convierte una lista de frases en viñetas.
 * @param {readonly string[]} values - Frases a listar.
 * @returns {string[]}
 */
function bulletLines(values: readonly string[]): string[] {
  return values.map(value => `- ${value}`);
}

/**
 * Datos del perfil que el usuario decidió compartir. Lo que no declaró no
 * aparece: ni el género, ni la altura, ni las medidas.
 * @param {StyleProfile} profile - Perfil del usuario.
 * @returns {string[]}
 */
function profileLines(profile: StyleProfile): string[] {
  return [
    ...identityLines(profile),
    ...measurementLines(profile),
    ...preferenceLines(profile),
    ...placeLines(profile),
    ...notesLines(profile),
  ];
}

/**
 * Género, presentación y altura, sólo si el usuario los declaró.
 * @param {StyleProfile} profile - Perfil del usuario.
 * @returns {string[]}
 */
function identityLines(profile: StyleProfile): string[] {
  const gender =
    profile.gender !== null && profile.gender !== 'UNSPECIFIED'
      ? `- Género declarado: ${enumLabels.gender[profile.gender]}`
      : null;
  const presentation =
    profile.presentationPreferences.length > 0
      ? `- Presentación que prefiere: ${profile.presentationPreferences
          .map(preference => enumLabels.presentationPreference[preference])
          .join(', ')}`
      : null;
  const height = profile.heightCm !== null ? `- Altura: ${profile.heightCm} cm` : null;
  return [gender, presentation, height].filter((line): line is string => line !== null);
}

/**
 * Preferencias de estilo: cortes cómodos, arquetipos, colores evitados y presupuesto.
 * @param {StyleProfile} profile - Perfil del usuario.
 * @returns {string[]}
 */
function preferenceLines(profile: StyleProfile): string[] {
  const fits =
    profile.preferredFits.length > 0
      ? `- Cortes que le resultan cómodos: ${profile.preferredFits
          .map(fit => enumLabels.fitPreference[fit])
          .join(', ')}`
      : null;
  const archetypes =
    profile.styleArchetypes.length > 0
      ? `- Estilos con los que se identifica: ${profile.styleArchetypes
          .map(archetype => enumLabels.styleArchetype[archetype])
          .join(', ')}`
      : null;
  const avoided =
    profile.avoidedColors.length > 0
      ? `- Colores que evita: ${profile.avoidedColors.join(', ')}`
      : null;
  const budget =
    profile.budgetTier !== null
      ? `- Presupuesto: ${enumLabels.budgetTier[profile.budgetTier]}`
      : null;
  return [fits, archetypes, avoided, budget].filter((line): line is string => line !== null);
}

/**
 * Lo que el usuario escribió a mano en su perfil.
 * @param {StyleProfile} profile - Perfil del usuario.
 * @returns {string[]}
 */
function notesLines(profile: StyleProfile): string[] {
  const notes = profile.notes?.trim() ?? '';
  return notes.length > 0 ? [`- Notas que escribió: ${notes}`] : [];
}

/**
 * Medidas declaradas, en centímetros. Se enumeran para que las notas de ajuste
 * puedan citarlas sin que el modelo tenga que estimar ninguna.
 * @param {StyleProfile} profile - Perfil del usuario.
 * @returns {string[]}
 */
function measurementLines(profile: StyleProfile): string[] {
  const measurements = profile.measurements;
  if (!measurements) {
    return [];
  }
  const declared = Object.entries(measurements)
    .filter(([key, value]) => key !== 'version' && key !== 'unit' && typeof value === 'number')
    .map(([key, value]) => `${key} ${String(value)} cm`);
  return declared.length > 0 ? [`- Medidas que dio: ${declared.join(', ')}`] : [];
}

/**
 * País, moneda, ciudad y clima, que es lo que acota las marcas de referencia.
 * @param {StyleProfile} profile - Perfil del usuario.
 * @returns {string[]}
 */
function placeLines(profile: StyleProfile): string[] {
  const parts = [
    profile.city,
    profile.country,
    profile.currency,
    profile.climate === null ? null : enumLabels.climate[profile.climate],
  ].filter((part): part is string => part !== null && part.length > 0);
  return parts.length > 0 ? [`- Dónde vive y con qué compra: ${parts.join(' · ')}`] : [];
}

/**
 * Qué pidió el usuario, con la ventana de formalidad del estilo ya resuelta.
 * @param {IStylistPromptInput} input - Datos de la petición.
 * @returns {string[]}
 */
function requestLines(input: IStylistPromptInput): string[] {
  const { request } = input;
  const window = formalityWindowByStyleTag[request.styleTag];
  const lines = [
    `- Estilo pedido: ${enumLabels.styleArchetype[request.styleTag]} (formalidad ${window.min}–${window.max})`,
    `- Escala de formalidad: ${formalityScale()}`,
  ];
  if (request.occasion !== null) {
    lines.push(`- Ocasión: ${enumLabels.lookOccasion[request.occasion]}`);
  }
  if (input.resolvedTemperatureC !== null) {
    lines.push(`- Temperatura para la que se viste: ${input.resolvedTemperatureC} °C`);
  }
  if (input.mustInclude !== null) {
    lines.push(
      `- Pidió usar "${input.mustInclude.name}" (${input.mustInclude.shortId}): tiene que estar en TODOS los looks, sin excepción`,
    );
  }
  lines.push(`- Cuántos looks quiere: ${input.limit}, ni uno más`);
  return lines;
}

/**
 * Escala de formalidad en una línea, para que 1–5 signifique lo mismo aquí que en
 * las prendas.
 * @returns {string}
 */
function formalityScale(): string {
  const levels: string[] = [];
  for (let level = minFormality; level <= maxFormality; level += 1) {
    levels.push(`${level} ${formalityLabel(level).toLowerCase()}`);
  }
  return levels.join(', ');
}

/**
 * Describe una prenda en una línea compacta.
 * @param {IStylistPromptGarment} garment - Prenda disponible.
 * @returns {string}
 */
function describeGarment(garment: IStylistPromptGarment): string {
  const extras = [
    garment.brand === null ? null : `marca ${garment.brand}`,
    garment.weather === null ? null : `cómoda ${garment.weather}`,
  ].filter((part): part is string => part !== null);
  const tail = extras.length > 0 ? ` · ${extras.join(' · ')}` : '';
  return [
    `- ${garment.shortId} · ${enumLabels.garmentSlot[garment.slot]}`,
    `${garment.name} (${garment.garmentTypeName})`,
    `${garment.colorName} ${garment.colorHex}`,
    `${garment.pattern} · ${garment.material} · corte ${garment.fit}`,
    `formalidad ${garment.formality}${tail}`,
  ].join(' · ');
}

/**
 * Combinaciones que el motor validó, de mejor a peor.
 * @param {readonly IStylistPromptCombination[]} combinations - Conjuntos válidos.
 * @returns {string[]}
 */
function combinationLines(combinations: readonly IStylistPromptCombination[]): string[] {
  return combinations.map(
    combination => `- ${combination.shortIds.join(' + ')} (nota ${combination.engineScore}/100)`,
  );
}

/**
 * Lo que se ha aprendido de los looks anteriores y de cómo usa su ropa.
 * @param {IStylistPromptInput} input - Datos de la petición.
 * @returns {string[]}
 */
function learnedLines(input: IStylistPromptInput): string[] {
  const liked =
    input.likedGarmentNames.length > 0
      ? [`- Prendas de looks que guardó o se puso: ${input.likedGarmentNames.join(', ')}`]
      : [];
  const mostWorn =
    input.mostWornNames.length > 0
      ? [`- Prendas que más usa: ${input.mostWornNames.join(', ')}`]
      : [];
  const rejections =
    input.rejectionReasons.length > 0
      ? [
          `- Rechazó looks anteriores por: ${input.rejectionReasons.join('; ')}`,
          '  El motor ya penalizó esos conjuntos; lo que se te pide es que la explicación no insista en lo que no le gustó.',
        ]
      : [];
  return [...liked, ...mostWorn, ...rejections];
}
