import { createHash } from 'node:crypto';
import {
  enumLabels,
  type Garment,
  type GarmentSlot,
  type GenerateOutfitsRequest,
} from '@closetai/shared-types';
import { engineVersion, maxAccessoriesPerOutfit } from '../engine/engine.constants';
import type { IEngineInput, IEngineResult, IScoredOutfit } from '../engine/engine.types';
import { allGarments } from '../engine/outfit-draft';
import { needsLayerAt } from '../engine/outfit-scoring';
import { maxGarmentsInEnum, toGarmentShortId } from './stylist.contract';
import {
  stylistPromptVersion,
  type IStylistPromptCombination,
  type IStylistPromptGarment,
  type IStylistPromptInput,
} from './stylist.prompt.v2';

/**
 * Traduce lo que produjo el motor en lo que ve el modelo.
 */

/** Combinaciones válidas que se le enseñan al modelo como punto de partida. */
const maxPromptCombinations = 8;
/** Notas de ajuste distintas que se le pasan; salen todas de `fit-rules.ts`. */
const maxPromptFitNotes = 6;
/** Prendas más usadas que se citan en las preferencias aprendidas. */
const maxMostWornNames = 5;
/** Prendas de looks guardados que se citan en las preferencias aprendidas. */
const maxLikedNames = 8;
/** Caracteres del hash del conjunto de candidatos. 16 hex ya no colisionan. */
const candidateHashLength = 16;

/** Slots que un look puede llevar o no. Son los que decide la Capa 2. */
const optionalSlots = new Set<GarmentSlot>(['MID_LAYER', 'OUTERWEAR', 'ACCESSORY']);

export interface IStylistInputResult {
  promptInput: IStylistPromptInput;
  garmentsByShortId: Map<string, Garment>;
  candidateSetHash: string;
  candidateCount: number;
}

/**
 * Construye la entrada del estilista a partir del resultado del motor.
 * @param {IEngineInput} input - Clóset, perfil, petición normalizada e historial.
 * @param {IEngineResult} result - Elegibles y candidatos puntuados del motor.
 * @param {GenerateOutfitsRequest} request - Petición tal como llegó del cliente.
 * @returns {IStylistInputResult}
 */
export function buildStylistInput(
  input: IEngineInput,
  result: IEngineResult,
  request: GenerateOutfitsRequest,
): IStylistInputResult {
  const scored = result.scored;
  const garmentsByShortId = selectGarments(input, result);
  const shortIdByGarmentId = new Map(
    [...garmentsByShortId].map(([shortId, garment]) => [garment.id, shortId]),
  );
  const combinations = toCombinations(scored, shortIdByGarmentId);
  const mustIncludeId = input.request.mustIncludeGarmentId;

  return {
    garmentsByShortId,
    candidateCount: combinations.length,
    candidateSetHash: hashCandidates(garmentsByShortId),
    promptInput: {
      request,
      combinations,
      profile: input.profile,
      resolvedTemperatureC: input.request.temperatureC,
      garments: [...garmentsByShortId].map(([shortId, garment]) =>
        toPromptGarment(shortId, garment),
      ),
      compositionAdvice: buildCompositionAdvice(input, [...garmentsByShortId.values()]),
      fitNotes: collectFitNotes(scored),
      limit: input.request.limit,
      mustInclude: toMustInclude(mustIncludeId, shortIdByGarmentId, garmentsByShortId),
      likedGarmentNames: namesOf(input.feedback.likedGarmentIds, input.garments, maxLikedNames),
      rejectionReasons: collectRejectionReasons(input),
      mostWornNames: mostWornNames(input.garments),
    },
  };
}

/**
 * Elige las prendas que entran en el enum: las de los mejores candidatos, en el
 * orden en que aparecen, hasta el tope del esquema.
 * @param {IEngineInput} input - Clóset, perfil y petición normalizada.
 * @param {IEngineResult} result - Elegibles y candidatos puntuados del motor.
 * @returns {Map<string, Garment>}
 */
function selectGarments(input: IEngineInput, result: IEngineResult): Map<string, Garment> {
  const ordered: Garment[] = [];
  const seen = new Set<string>();
  const mustIncludeId = input.request.mustIncludeGarmentId;
  const mustInclude = result.eligible.find(garment => garment.id === mustIncludeId);
  if (mustInclude) {
    ordered.push(mustInclude);
    seen.add(mustInclude.id);
  }

  for (const candidate of result.scored) {
    for (const garment of allGarments(candidate.draft)) {
      if (!seen.has(garment.id) && ordered.length < maxGarmentsInEnum) {
        seen.add(garment.id);
        ordered.push(garment);
      }
    }
  }

  // Capas y accesorios elegibles que ningún candidato llegó a usar. El motor los
  // deja fuera cuando la temperatura no los pide, pero la ocasión también puede
  // pedirlos —una chaqueta para una cena a 24 °C— y esa decisión es de la Capa 2.
  // Si no entran aquí, el modelo no puede citarlos por mucho que el prompt se lo
  // sugiera: el enum es lo único que existe para él.
  for (const garment of result.eligible) {
    if (
      !seen.has(garment.id) &&
      optionalSlots.has(garment.slot) &&
      ordered.length < maxGarmentsInEnum
    ) {
      seen.add(garment.id);
      ordered.push(garment);
    }
  }
  return new Map(ordered.map((garment, index) => [toGarmentShortId(index), garment]));
}

/**
 * Traduce los mejores candidatos a combinaciones de ids cortos. Se descarta la
 * combinación a la que el recorte del enum le quitó alguna prenda: enseñar un
 * conjunto incompleto sería peor que no enseñarlo.
 * @param {readonly IScoredOutfit[]} scored - Candidatos puntuados, de mejor a peor.
 * @param {ReadonlyMap<string, string>} shortIdByGarmentId - Prenda real → id corto.
 * @returns {IStylistPromptCombination[]}
 */
function toCombinations(
  scored: readonly IScoredOutfit[],
  shortIdByGarmentId: ReadonlyMap<string, string>,
): IStylistPromptCombination[] {
  return scored
    .map(candidate => toCombination(candidate, shortIdByGarmentId))
    .filter((combination): combination is IStylistPromptCombination => combination !== null)
    .slice(0, maxPromptCombinations);
}

/**
 * Traduce un candidato a ids cortos, o null si alguna de sus prendas se quedó
 * fuera del enum.
 * @param {IScoredOutfit} candidate - Candidato puntuado por el motor.
 * @param {ReadonlyMap<string, string>} shortIdByGarmentId - Prenda real → id corto.
 * @returns {IStylistPromptCombination | null}
 */
function toCombination(
  candidate: IScoredOutfit,
  shortIdByGarmentId: ReadonlyMap<string, string>,
): IStylistPromptCombination | null {
  const garments = allGarments(candidate.draft);
  const shortIds = garments
    .map(garment => shortIdByGarmentId.get(garment.id))
    .filter((shortId): shortId is string => shortId !== undefined);
  if (shortIds.length !== garments.length) {
    return null;
  }
  return { shortIds, engineScore: candidate.engineScore };
}

/**
 * Decide la composición del look y se la da al modelo ya resuelta.
 *
 * Esta decisión **no se delega**: si hace fresco, el look lleva capa, y eso no
 * puede depender de la tirada. El servidor usa el mismo umbral con el que el motor
 * arma sus candidatos (`needsLayerAt`), así que lo que se le pide al modelo coincide
 * con lo que ya trae la lista de combinaciones validadas.
 * @param {IEngineInput} input - Clóset, perfil y petición normalizada.
 * @param {readonly Garment[]} available - Prendas que entraron en el enum.
 * @returns {string[]}
 */
function buildCompositionAdvice(input: IEngineInput, available: readonly Garment[]): string[] {
  const temperature = input.request.temperatureC;
  const layers = available.filter(
    garment => garment.slot === 'MID_LAYER' || garment.slot === 'OUTERWEAR',
  );
  const accessories = available.filter(garment => garment.slot === 'ACCESSORY');
  return [...describeLayerAdvice(temperature, layers), ...describeAccessoryAdvice(accessories)];
}

/**
 * Qué hacer con las capas: la respuesta sale de la temperatura y de lo que hay.
 * @param {number | null} temperatureC - Temperatura resuelta, o null si no hay.
 * @param {readonly Garment[]} layers - Capas disponibles en el enum.
 * @returns {string[]}
 */
function describeLayerAdvice(temperatureC: number | null, layers: readonly Garment[]): string[] {
  if (layers.length === 0) {
    return [
      'No hay ninguna capa disponible para esta petición: el look son tres prendas y no menciones ninguna chaqueta.',
    ];
  }
  const names = listNames(layers);
  if (needsLayerAt(temperatureC)) {
    return [
      `A ${temperatureC} °C el look LLEVA capa: base + base + calzado + una de estas (${names}).`,
      'Es la cuarta prenda y no es opcional. Si la quitas, el usuario pasa frío.',
    ];
  }
  if (temperatureC !== null) {
    return [
      `A ${temperatureC} °C no hace falta capa. Tienes disponibles ${names}: úsalas sólo si la ocasión las pide.`,
    ];
  }
  return [
    `Sin temperatura indicada. Tienes capas disponibles (${names}): añade una si la ocasión la pide.`,
  ];
}

/**
 * Qué hacer con los accesorios. Se nombran uno a uno para que el modelo no tenga
 * que deducir de la lista de prendas cuáles lo son.
 * @param {readonly Garment[]} accessories - Accesorios disponibles en el enum.
 * @returns {string[]}
 */
function describeAccessoryAdvice(accessories: readonly Garment[]): string[] {
  if (accessories.length === 0) {
    return ['No hay accesorios disponibles: no menciones ninguno.'];
  }
  return [
    `Accesorios disponibles: ${listNames(accessories)}.`,
    `Añade hasta ${maxAccessoriesPerOutfit} por look cuando encajen con el estilo y con el clima; son lo que remata un look.`,
  ];
}

/**
 * Enumera prendas por su nombre, para citarlas dentro de una frase.
 * @param {readonly Garment[]} garments - Prendas a nombrar.
 * @returns {string}
 */
function listNames(garments: readonly Garment[]): string {
  return garments.map(garment => garment.name).join(', ');
}

/**
 * Describe una prenda para el prompt, con sus etiquetas en español.
 * @param {string} shortId - Id corto asignado a la prenda.
 * @param {Garment} garment - Prenda real del clóset.
 * @returns {IStylistPromptGarment}
 */
function toPromptGarment(shortId: string, garment: Garment): IStylistPromptGarment {
  return {
    shortId,
    slot: garment.slot,
    name: garment.name,
    garmentTypeName: garment.garmentTypeName,
    colorName: garment.primaryColorName,
    colorHex: garment.primaryColorHex,
    pattern: enumLabels.garmentPattern[garment.pattern].toLowerCase(),
    material: enumLabels.garmentMaterial[garment.material].toLowerCase(),
    fit: enumLabels.fitPreference[garment.fit].toLowerCase(),
    formality: garment.formality,
    brand: garment.brand,
    weather: describeWeather(garment),
  };
}

/**
 * Rango térmico declarado de la prenda, ya formateado, o null si no lo tiene.
 * @param {Garment} garment - Prenda real del clóset.
 * @returns {string | null}
 */
function describeWeather(garment: Garment): string | null {
  const { weatherMinC, weatherMaxC } = garment;
  if (weatherMinC !== null && weatherMaxC !== null) {
    return `${weatherMinC}–${weatherMaxC} °C`;
  }
  if (weatherMinC !== null) {
    return `desde ${weatherMinC} °C`;
  }
  return weatherMaxC === null ? null : `hasta ${weatherMaxC} °C`;
}

/**
 * Notas de ajuste distintas de los mejores candidatos. Se deduplican porque casi
 * todas dependen del perfil y no del conjunto, así que se repetirían.
 * @param {readonly IScoredOutfit[]} scored - Candidatos puntuados, de mejor a peor.
 * @returns {string[]}
 */
function collectFitNotes(scored: readonly IScoredOutfit[]): string[] {
  const notes = scored.slice(0, maxPromptCombinations).flatMap(candidate => candidate.fitNotes);
  return [...new Set(notes)].slice(0, maxPromptFitNotes);
}

/**
 * Motivos distintos por los que el usuario rechazó looks, ya en español.
 * @param {IEngineInput} input - Entrada del motor con el historial.
 * @returns {string[]}
 */
function collectRejectionReasons(input: IEngineInput): string[] {
  const reasons = input.feedback.rejected
    .map(rejected => rejected.reason)
    .filter((reason): reason is NonNullable<typeof reason> => reason !== null)
    .map(reason => enumLabels.outfitRejectedReason[reason].toLowerCase());
  return [...new Set(reasons)];
}

/**
 * Nombres de las prendas indicadas que siguen en el clóset.
 * @param {readonly string[]} garmentIdList - Ids de las prendas buscadas.
 * @param {readonly Garment[]} closet - Clóset del usuario.
 * @param {number} limit - Cuántos nombres como máximo.
 * @returns {string[]}
 */
function namesOf(
  garmentIdList: readonly string[],
  closet: readonly Garment[],
  limit: number,
): string[] {
  const wanted = new Set(garmentIdList);
  return closet
    .filter(garment => wanted.has(garment.id))
    .map(garment => garment.name)
    .slice(0, limit);
}

/**
 * Prendas que el usuario más se pone. Sólo cuentan las que tienen algún uso: una
 * lista de prendas con cero usos no dice nada.
 * @param {readonly Garment[]} closet - Clóset del usuario.
 * @returns {string[]}
 */
function mostWornNames(closet: readonly Garment[]): string[] {
  return [...closet]
    .filter(garment => garment.wearCount > 0)
    .sort((first, second) => second.wearCount - first.wearCount)
    .slice(0, maxMostWornNames)
    .map(garment => garment.name);
}

/**
 * Prenda exigida con su id corto, si el usuario pidió alguna y sigue disponible.
 * @param {string | null} mustIncludeId - Prenda exigida por el usuario.
 * @param {ReadonlyMap<string, string>} shortIdByGarmentId - Prenda real → id corto.
 * @param {ReadonlyMap<string, Garment>} garmentsByShortId - Id corto → prenda real.
 * @returns {{ shortId: string; name: string } | null}
 */
function toMustInclude(
  mustIncludeId: string | null,
  shortIdByGarmentId: ReadonlyMap<string, string>,
  garmentsByShortId: ReadonlyMap<string, Garment>,
): { shortId: string; name: string } | null {
  if (mustIncludeId === null) {
    return null;
  }
  const shortId = shortIdByGarmentId.get(mustIncludeId);
  const garment = shortId === undefined ? undefined : garmentsByShortId.get(shortId);
  if (shortId === undefined || !garment) {
    return null;
  }
  return { shortId, name: garment.name };
}

/**
 * Huella del conjunto de candidatos que viajó al modelo. Incluye la versión del
 * motor y la del prompt porque un mismo clóset con otra versión no es el mismo
 * experimento.
 * @param {ReadonlyMap<string, Garment>} garmentsByShortId - Id corto → prenda real.
 * @returns {string}
 */
function hashCandidates(garmentsByShortId: ReadonlyMap<string, Garment>): string {
  const parts = [...garmentsByShortId].map(([shortId, garment]) => `${shortId}=${garment.id}`);
  return createHash('sha256')
    .update([engineVersion, stylistPromptVersion, ...parts].join('|'))
    .digest('hex')
    .slice(0, candidateHashLength);
}
