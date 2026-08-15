import {
  colorFamilyFromHex,
  colorFamilyLabels,
  enumLabels,
  formalityLabel,
  type Garment,
  type LookItem,
  type LookOccasion,
  type StyleArchetype,
} from '@closetai/shared-types';
import {
  additionalOccasionByStyleTag,
  formalityGapWorthMentioning,
  formalityWindowByStyleTag,
  maxOccasions,
  maxPaletteColors,
  maxStyleNotes,
  maxTitleColors,
  occasionBands,
} from './engine.constants';
import { isNeutralColor } from './color-harmony';
import type { IEngineInput, IScoredOutfit } from './engine.types';
import { allGarments, coreGarments, roleForSlot, type IOutfitDraft } from './outfit-draft';
import { formatDecimal } from './score-utils';

/**
 * Textos de la ficha, generados en código.
 */

const hashSeed = 5381;
const hashShift = 5;
const hashRadix = 36;

/**
 * Título del look: el estilo pedido más los colores que realmente lleva.
 * @param {IOutfitDraft} draft - Conjunto ya elegido.
 * @param {StyleArchetype} styleTag - Estilo pedido.
 * @returns {string}
 */
export function buildTitle(draft: IOutfitDraft, styleTag: StyleArchetype): string {
  const styleLabel = enumLabels.styleArchetype[styleTag];
  const families = uniqueFamilies(coreGarments(draft)).slice(0, maxTitleColors);
  if (families.length === 0) {
    return styleLabel;
  }
  return `${styleLabel} en ${families.join(' y ')}`;
}

/**
 * Familias de color distintas del conjunto, en orden de aparición y en español.
 * @param {readonly Garment[]} garments - Prendas del conjunto.
 * @returns {string[]}
 */
function uniqueFamilies(garments: readonly Garment[]): string[] {
  const labels: string[] = [];
  for (const garment of garments) {
    const family = colorFamilyFromHex(garment.primaryColorHex);
    const label = family ? colorFamilyLabels[family].toLowerCase() : null;
    if (label && !labels.includes(label)) {
      labels.push(label);
    }
  }
  return labels;
}

/**
 * Paleta del look: los hex reales de las prendas, sin repetir.
 * @param {IOutfitDraft} draft - Conjunto ya elegido.
 * @returns {string[]}
 */
export function buildPalette(draft: IOutfitDraft): string[] {
  const hexes = allGarments(draft).flatMap(garment =>
    garment.secondaryColorHex
      ? [garment.primaryColorHex, garment.secondaryColorHex]
      : [garment.primaryColorHex],
  );
  return [...new Set(hexes)].slice(0, maxPaletteColors);
}

/**
 * Cuándo usar el look. Sale de la formalidad media real del conjunto, más la
 * ocasión propia del estilo pedido cuando la tiene.
 * @param {StyleArchetype} styleTag - Estilo pedido.
 * @param {number} averageFormality - Formalidad media del núcleo.
 * @returns {LookOccasion[]}
 */
export function buildOccasions(styleTag: StyleArchetype, averageFormality: number): LookOccasion[] {
  const band = occasionBands.find(candidate => averageFormality >= candidate.minFormality);
  const extra = additionalOccasionByStyleTag[styleTag];
  const occasions = [...(extra ? [extra] : []), ...(band?.occasions ?? [])];
  return [...new Set(occasions)].slice(0, maxOccasions);
}

/**
 * Notas de estilo: las razones del motor, de la señal que más pesa a la que
 * menos. Si el conjunto no alcanza la ventana del estilo pedido, la primera nota
 * lo dice — antes que prometer un smart casual que el clóset no da.
 * @param {IScoredOutfit} scored - Conjunto ya puntuado.
 * @param {StyleArchetype} styleTag - Estilo pedido.
 * @returns {string[]}
 */
export function buildStyleNotes(scored: IScoredOutfit, styleTag: StyleArchetype): string[] {
  const notes = [...scored.breakdown]
    .filter(line => line.signal !== 'FIT')
    .sort((first, second) => second.weight - first.weight)
    .map(line => line.reason);
  const caveat = buildFormalityCaveat(scored, styleTag);
  return [...(caveat ? [caveat] : []), ...notes].slice(0, maxStyleNotes);
}

/**
 * Aviso cuando el conjunto se queda lejos de la ventana del estilo pedido.
 * @param {IScoredOutfit} scored - Conjunto ya puntuado.
 * @param {StyleArchetype} styleTag - Estilo pedido.
 * @returns {string | null}
 */
function buildFormalityCaveat(scored: IScoredOutfit, styleTag: StyleArchetype): string | null {
  if (scored.formalityGap < formalityGapWorthMentioning) {
    return null;
  }
  const window = formalityWindowByStyleTag[styleTag];
  const styleLabel = enumLabels.styleArchetype[styleTag].toLowerCase();
  const measured = `la formalidad media del conjunto es ${formatDecimal(scored.averageFormality)}`;
  const expected = `${styleLabel} pide entre ${window.min} y ${window.max}`;
  return `Es lo más cercano a ${styleLabel} que permite tu clóset: ${measured} y ${expected}.`;
}

/**
 * Convierte el conjunto en la lista de prendas de la ficha, cada una con su foto
 * real y el motivo por el que está en el look.
 * @param {IOutfitDraft} draft - Conjunto ya elegido.
 * @param {IEngineInput} input - Clóset, perfil y petición normalizada.
 * @param {ReadonlyMap<string, string>} [whyByGarmentId] - Explicación del estilista por prenda.
 * @returns {LookItem[]}
 */
export function buildItems(
  draft: IOutfitDraft,
  input: IEngineInput,
  whyByGarmentId?: ReadonlyMap<string, string>,
): LookItem[] {
  return allGarments(draft).map(garment => {
    const cover = garment.photos.find(photo => photo.isPrimary) ?? garment.photos[0];
    return {
      garmentId: garment.id,
      name: garment.name,
      slot: garment.slot,
      role: roleForSlot(garment.slot),
      garmentTypeName: garment.garmentTypeName,
      brand: garment.brand,
      colorHex: garment.primaryColorHex,
      colorName: garment.primaryColorName,
      formality: garment.formality,
      thumbUrl: cover?.thumbUrl ?? null,
      url: cover?.url ?? null,
      why: whyByGarmentId?.get(garment.id) ?? describeWhy(garment, input),
    };
  });
}

/**
 * Explica por qué esta prenda está en el conjunto, con datos de la prenda.
 * @param {Garment} garment - Prenda del conjunto.
 * @param {IEngineInput} input - Clóset, perfil y petición normalizada.
 * @returns {string}
 */
function describeWhy(garment: Garment, input: IEngineInput): string {
  const prefix =
    garment.id === input.request.mustIncludeGarmentId ? 'La pediste para este look. ' : '';
  return `${prefix}${describeRole(garment, input.request.temperatureC)}`;
}

/**
 * Frase base según el papel de la prenda dentro del look.
 * @param {Garment} garment - Prenda del conjunto.
 * @param {number | null} temperatureC - Temperatura resuelta, o null si no hay.
 * @returns {string}
 */
function describeRole(garment: Garment, temperatureC: number | null): string {
  const formality = formalityLabel(garment.formality).toLowerCase();
  const role = roleForSlot(garment.slot);

  if (role === 'FOOTWEAR') {
    return `Cierra el conjunto con formalidad ${formality}.`;
  }
  if (role === 'LAYER') {
    return describeLayer(garment, temperatureC);
  }
  if (role === 'ACCESSORY') {
    return `Remata el conjunto sin cambiar su formalidad (${formality}).`;
  }
  return describeBase(garment, formality);
}

/**
 * Frase de una prenda base: qué papel juega su color y qué formalidad aporta.
 * @param {Garment} garment - Prenda base del conjunto.
 * @param {string} formality - Etiqueta de formalidad en minúscula.
 * @returns {string}
 */
function describeBase(garment: Garment, formality: string): string {
  if (isNeutralColor(garment.primaryColorHex)) {
    return `Color neutro que ancla el conjunto; formalidad ${formality}.`;
  }
  return `Pone el color del conjunto (${garment.primaryColorName.toLowerCase()}); formalidad ${formality}.`;
}

/**
 * Frase de una capa, anclada al rango térmico que declaró el usuario.
 * @param {Garment} garment - Capa del conjunto.
 * @param {number | null} temperatureC - Temperatura resuelta, o null si no hay.
 * @returns {string}
 */
function describeLayer(garment: Garment, temperatureC: number | null): string {
  if (temperatureC !== null && garment.weatherMinC !== null) {
    return `Suma abrigo para ${temperatureC} °C: la marcaste cómoda desde ${garment.weatherMinC} °C.`;
  }
  return `Añade una capa de ${enumLabels.garmentMaterial[garment.material].toLowerCase()} al conjunto.`;
}

/**
 * Rango de temperatura del look: la intersección de los rangos de sus prendas.
 * Si los rangos no se solapan no se inventa uno: se devuelve vacío.
 * @param {IOutfitDraft} draft - Conjunto ya elegido.
 * @returns {{ weatherMinC: number | null; weatherMaxC: number | null }}
 */
export function buildWeatherRange(draft: IOutfitDraft): {
  weatherMinC: number | null;
  weatherMaxC: number | null;
} {
  const garments = allGarments(draft);
  const mins = garments
    .map(garment => garment.weatherMinC)
    .filter((value): value is number => value !== null);
  const maxes = garments
    .map(garment => garment.weatherMaxC)
    .filter((value): value is number => value !== null);

  const weatherMinC = mins.length > 0 ? Math.max(...mins) : null;
  const weatherMaxC = maxes.length > 0 ? Math.min(...maxes) : null;
  if (weatherMinC !== null && weatherMaxC !== null && weatherMinC > weatherMaxC) {
    return { weatherMinC: null, weatherMaxC: null };
  }
  return { weatherMinC, weatherMaxC };
}

/**
 * Identificador estable del look: el mismo conjunto pedido con el mismo estilo
 * devuelve siempre el mismo id, sin necesidad de guardarlo en base de datos.
 * @param {readonly string[]} garmentIdList - Ids del conjunto, ya ordenados.
 * @param {StyleArchetype} styleTag - Estilo pedido.
 * @returns {string}
 */
export function buildLookId(garmentIdList: readonly string[], styleTag: StyleArchetype): string {
  let hash = hashSeed;
  for (const character of [styleTag, ...garmentIdList].join('|')) {
    hash = ((hash << hashShift) + hash + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash.toString(hashRadix);
}
