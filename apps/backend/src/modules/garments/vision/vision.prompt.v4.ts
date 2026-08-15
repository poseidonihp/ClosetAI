import { enumLabels, formalityLabel, maxFormality, minFormality } from '@closetai/shared-types';

/**
 * Prompt de etiquetado por visión, versión 4.
 *
 * Está versionado y se guarda en `Garment.taggingVersion` junto al resultado:
 * comparar dos versiones sobre las mismas fotos es la única forma de saber si un
 * cambio de prompt mejora o empeora, y sin la versión guardada no se puede. Las
 * anteriores viven en el historial de git: v1 mandaba sólo la portada, v2 ya
 * mandaba varias fotos y v3 arregló las temporadas.
 *
 * Llegan **varias fotos de la misma prenda**. Eso obliga a decir dos cosas que
 * con una sola foto no hacían falta y que son el fallo obvio si se omiten: que
 * todas las fotos son la misma prenda —si no, el modelo describiría una prenda
 * distinta por foto— y que manda la primera cuando alguna incluye más ropa, como
 * una foto de cuerpo entero.
 *
 * Lo que arregla la v4: **el modelo puede negarse**. Antes tenía que rellenar los
 * atributos siempre, así que de un retrato salían valores plausibles pero
 * inventados. Ahora `usableForTagging` es la salida honesta, y por eso el prompt
 * insiste en la frontera exacta: una prenda puesta sobre una persona **sí** se
 * cataloga; un retrato donde no se distingue ninguna prenda, no. Confundir las
 * dos cosas rompería la forma más natural de fotografiar tu propia ropa.
 *
 * Dos cosas no son negociables aquí y por eso están en el mensaje de sistema y
 * además en el esquema: **describir sólo la prenda, nunca a la persona** —el
 * producto no infiere género, peso ni complexión desde una foto— y **no
 * inventar la marca**, que va a `brandGuess` y jamás pisa la marca que escribió
 * el usuario.
 */

/** Catálogo de tipos que se le enseña al modelo, ya resuelto para esta petición. */
export interface IVisionCatalogEntry {
  slug: string;
  name: string;
  slot: string;
}

export const visionInstructions = [
  'Eres un catalogador de ropa. Recibes entre una y varias fotos de UNA MISMA prenda y devuelves sus atributos objetivos.',
  '',
  'Reglas que no puedes romper:',
  '1. Todas las fotos son de la misma prenda, vista desde ángulos distintos o en detalle. Devuelve UN solo conjunto de atributos, no uno por foto.',
  '2. La primera foto es la principal. Si en alguna aparece más ropa —una foto de cuerpo entero, un conjunto completo—, describe la prenda que se ve en la primera y ignora el resto.',
  '3. Describe únicamente la prenda. Si en alguna foto aparece una persona, marca `personVisible` en true y no digas nada sobre ella: ni edad, ni género, ni complexión, ni tono de piel.',
  '4. Si de estas fotos NO se puede catalogar una prenda concreta, pon `usableForTagging` en false y explica en `unusableReason` qué falta:',
  '   - un retrato o un primer plano de la cara donde no se distingue ninguna prenda;',
  '   - una foto que no es de ropa;',
  '   - varias prendas distintas sin forma de saber cuál hay que catalogar.',
  '   Que alguien lleve la prenda puesta NO es motivo: una foto en el espejo con la chaqueta puesta sí se cataloga.',
  '   Cuando pongas false rellena el resto de campos con valores neutros; no se van a usar.',
  '5. Aprovecha las fotos de detalle: si se lee una etiqueta de composición, úsala para `material`; si se lee un logo o una etiqueta de marca, úsalo para `brandGuess`.',
  '6. El tipo de prenda sale del catálogo que te doy. Elige el más cercano; si ninguno encaja bien, elige el más genérico del slot correcto.',
  '7. `brandGuess` sólo lleva una marca si su logo o su etiqueta se leen en alguna foto. Si lo estás deduciendo por el estilo, pon null.',
  '8. Los colores van en hex #rrggbb tomados de la prenda, no del fondo ni de la sombra. Si las fotos discrepan por la luz, usa la primera como referencia.',
  '9. `seasons` lleva siempre al menos una temporada. Si la prenda sirve en cualquier época del año, lista las cuatro; no la dejes vacía nunca.',
  '10. Si un atributo no se distingue en ninguna foto, elige el valor más neutro (OTHER, NONE, REGULAR) y baja su `confidence`. No adivines con seguridad fingida.',
  '11. Escribe en español los campos de texto.',
].join('\n');

/**
 * Construye el mensaje del usuario con el catálogo y la escala de formalidad ya
 * resueltos, para que el modelo no tenga que suponer el vocabulario.
 * @param {readonly IVisionCatalogEntry[]} catalog - Tipos de prenda disponibles.
 * @param {number} photoCount - Cuántas fotos van adjuntas en esta petición.
 * @returns {string}
 */
export function buildVisionPrompt(
  catalog: readonly IVisionCatalogEntry[],
  photoCount: number,
): string {
  return [
    'CATÁLOGO DE TIPOS DE PRENDA (slug — nombre — parte del cuerpo):',
    ...catalog.map(entry => `- ${entry.slug} — ${entry.name} — ${entry.slot}`),
    '',
    'ESCALA DE FORMALIDAD:',
    ...formalityScale(),
    '',
    'PARTES DEL CUERPO:',
    ...Object.entries(enumLabels.garmentSlot).map(([slot, label]) => `- ${slot}: ${label}`),
    '',
    photosLine(photoCount),
  ].join('\n');
}

/**
 * Explica cuántas fotos vienen y qué hacer con ellas. Se dice el número de forma
 * explícita para que el modelo no trate una foto de detalle como otra prenda.
 * @param {number} photoCount - Cuántas fotos van adjuntas.
 * @returns {string}
 */
function photosLine(photoCount: number): string {
  if (photoCount <= 1) {
    return 'Analiza la foto adjunta y devuelve los atributos de esa prenda.';
  }
  return `Van ${photoCount} fotos de la misma prenda; la primera es la principal. Analízalas juntas y devuelve un solo conjunto de atributos.`;
}

/**
 * Enumera la escala de formalidad con su etiqueta en español.
 * @returns {string[]}
 */
function formalityScale(): string[] {
  const levels: string[] = [];
  for (let level = minFormality; level <= maxFormality; level += 1) {
    levels.push(`- ${level}: ${formalityLabel(level)}`);
  }
  return levels;
}
