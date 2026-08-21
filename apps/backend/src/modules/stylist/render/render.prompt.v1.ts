import { enumLabels, type StyleProfile } from '@closetai/shared-types';
import type { IRenderPromptGarment, IRenderPromptInput } from './render.types';

/**
 * Prompt del render visual, versión 1.
 *
 * Va versionado y su versión se guarda en `OutfitRender.promptVersion`, igual que
 * en el estilista: un modelo de imagen no es reproducible, así que la única forma
 * de saber si un cambio mejora el resultado es comparar dos versiones sobre el
 * mismo look. El prompt exacto se guarda además en `promptUsed`.
 *
 * Tres decisiones sostienen el resto:
 *
 * - **Las prendas van atadas a su foto por número.** El modelo recibe N imágenes y
 *   N párrafos numerados; describir la ropa sin decir cuál es cada foto dejaba que
 *   mezclara el color de una con el corte de otra.
 * - **La persona de las fotos no es parte del encargo.** Fotografiar tu propia ropa
 *   frente al espejo es la forma más natural de hacerlo desde el móvil, así que las
 *   fotos pueden llevar cara y cuerpo. Se prohíbe explícitamente reproducirlos: es
 *   el riesgo 7 del plan y no se resuelve pidiéndole al usuario otras fotos.
 * - **No se infiere el cuerpo de nadie.** Sólo entra lo que el usuario declaró en su
 *   perfil; lo que no declaró no aparece, ni como "desconocido". Es el riesgo 8 y el
 *   motivo de que la figura vaya encuadrada sin cara.
 */

/** Versión del prompt del render. Sube si cambia el texto o la forma de la entrada. */
export const renderPromptVersion = 'render-v1';

export const renderInstructions = [
  'Generas una imagen de moda a partir de fotos reales de la ropa de una persona.',
  'Cada foto que recibes es UNA prenda distinta del mismo conjunto, en el orden en que se numeran en PRENDAS.',
  '',
  'Reglas que no puedes romper:',
  '1. La imagen muestra ese conjunto completo y puesto: todas las prendas que te doy y ninguna más.',
  '   No añadas ropa que no esté en las fotos ni quites ninguna de las que están.',
  '2. Cada prenda se parece a su foto: color exacto, estampado, textura, largo y corte.',
  '   Entre parecerte a la foto y quedar más bonito, párecete a la foto.',
  '3. No reproduzcas a ninguna persona que aparezca en las fotos. Son fotos de ropa, a veces tomadas frente',
  '   a un espejo: la cara, el cuerpo y el fondo de quien salga no son parte del encargo.',
  '4. Quien lleva el conjunto es una figura anónima: encuádrala de forma que la cara quede fuera del plano.',
  '   No inventes rasgos, edad, peso ni complexión; usa sólo lo que diga PERFIL y nada más.',
  '5. Fondo de estudio neutro y liso, luz suave y uniforme, plano completo con el calzado dentro.',
  '6. Nada de texto, marcas de agua, logotipos inventados ni collage: una sola escena.',
].join('\n');

/**
 * Construye el prompt del render en bloques nombrados. Lo que el usuario no
 * declaró no aparece.
 * @param {IRenderPromptInput} input - Look, prendas con su foto y perfil.
 * @returns {string}
 */
export function buildRenderPrompt(input: IRenderPromptInput): string {
  return [
    ...block('LOOK', lookLines(input)),
    ...block('PRENDAS (una por foto, en este orden)', input.garments.map(describeGarment)),
    ...block('PERFIL (sólo lo que declaró; no añadas nada)', profileLines(input.profile)),
    '',
    'Genera una sola imagen del conjunto puesto, con las prendas tal como están en sus fotos.',
  ].join('\n');
}

/**
 * Envuelve un bloque con su título; sin líneas, el bloque no aparece.
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
 * Qué look es: su estilo, su frase y cuándo se usa. Da el tono de la escena sin
 * decidir nada sobre las prendas.
 * @param {IRenderPromptInput} input - Datos del look.
 * @returns {string[]}
 */
function lookLines(input: IRenderPromptInput): string[] {
  const lines = [
    `- Título: ${input.title}`,
    `- Estilo: ${enumLabels.styleArchetype[input.styleTag]}`,
  ];
  if (input.oneLiner.length > 0) {
    lines.push(`- Cómo se siente: ${input.oneLiner}`);
  }
  if (input.occasions.length > 0) {
    lines.push(
      `- Para: ${input.occasions.map(occasion => enumLabels.lookOccasion[occasion]).join(', ')}`,
    );
  }
  const weather = describeWeather(input);
  if (weather !== null) {
    lines.push(`- Clima para el que está pensado: ${weather}`);
  }
  return lines;
}

/**
 * Rango térmico del look ya formateado, o null si sus prendas no lo declaran.
 * @param {IRenderPromptInput} input - Datos del look.
 * @returns {string | null}
 */
function describeWeather(input: IRenderPromptInput): string | null {
  const { weatherMinC, weatherMaxC } = input;
  if (weatherMinC !== null && weatherMaxC !== null) {
    return `${weatherMinC}–${weatherMaxC} °C`;
  }
  if (weatherMinC !== null) {
    return `desde ${weatherMinC} °C`;
  }
  return weatherMaxC === null ? null : `hasta ${weatherMaxC} °C`;
}

/**
 * Describe una prenda y la ata a su foto por número.
 * @param {IRenderPromptGarment} garment - Prenda del look con su foto.
 * @returns {string}
 */
function describeGarment(garment: IRenderPromptGarment): string {
  return [
    `- Foto ${garment.imageIndex}: ${garment.name} (${garment.garmentTypeName})`,
    `${enumLabels.outfitItemRole[garment.role].toLowerCase()} · ${enumLabels.garmentSlot[garment.slot].toLowerCase()}`,
    `${garment.colorName} ${garment.colorHex}`,
    `${garment.pattern} · ${garment.material} · corte ${garment.fit}`,
  ].join(' · ');
}

/**
 * Datos del perfil que pueden afectar a la figura o a la escena. Género y
 * presentación entran sólo si el usuario los declaró; el peso y la complexión no
 * entran nunca, porque el render no debe representar el cuerpo de nadie.
 * @param {StyleProfile} profile - Perfil del usuario.
 * @returns {string[]}
 */
function profileLines(profile: StyleProfile): string[] {
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
  const fits =
    profile.preferredFits.length > 0
      ? `- Cortes que le resultan cómodos: ${profile.preferredFits
          .map(fit => enumLabels.fitPreference[fit])
          .join(', ')}`
      : null;
  return [gender, presentation, height, fits].filter((line): line is string => line !== null);
}
