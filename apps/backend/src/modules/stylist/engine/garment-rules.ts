import {
  colorFamilyFromHex,
  colorFamilyLabels,
  enumLabels,
  type ExcludedGarment,
  type Garment,
  type StyleProfile,
} from '@closetai/shared-types';
import { weatherToleranceC } from './engine.constants';
import type { IEngineRequest } from './engine.types';

/**
 * Reglas duras a nivel de prenda: las que deciden qué entra siquiera en la
 * enumeración de candidatos.
 */

export interface IEligibilityContext {
  profile: StyleProfile;
  request: IEngineRequest;
}

interface IEligibilityRule {
  code: string;
  skippedForMustInclude: boolean;
  reject: (garment: Garment, context: IEligibilityContext) => string | null;
}

export interface IEligibilitySplit {
  eligible: Garment[];
  excluded: ExcludedGarment[];
}

/** Marcas diacríticas que deja `normalize('NFD')` al separar las tildes. */
const diacriticsPattern = /[̀-ͯ]/g;

/**
 * Normaliza un texto de color para compararlo: minúsculas y sin tildes, porque
 * el usuario escribe "Marrón" y la prenda dice "marron".
 * @param {string} text - Texto tal como se escribió.
 * @returns {string}
 */
function normalizeColorTerm(text: string): string {
  return text.trim().toLowerCase().normalize('NFD').replace(diacriticsPattern, '');
}

/**
 * Describe el rango térmico declarado de una prenda.
 * @param {Garment} garment - Prenda a describir.
 * @returns {string}
 */
function describeRange(garment: Garment): string {
  const { weatherMinC, weatherMaxC } = garment;
  if (weatherMinC !== null && weatherMaxC !== null) {
    return `su rango es ${weatherMinC}–${weatherMaxC} °C`;
  }
  if (weatherMinC !== null) {
    return `la marcaste cómoda desde ${weatherMinC} °C`;
  }
  return `la marcaste cómoda hasta ${weatherMaxC} °C`;
}

/**
 * Indica si el color de una prenda cae en la lista de colores evitados.
 * @param {Garment} garment - Prenda a evaluar.
 * @param {readonly string[]} avoidedColors - Colores que el usuario evita.
 * @returns {boolean}
 */
function matchesAvoidedColor(garment: Garment, avoidedColors: readonly string[]): boolean {
  const colorName = normalizeColorTerm(garment.primaryColorName);
  const family = colorFamilyFromHex(garment.primaryColorHex);
  const familyName = family ? normalizeColorTerm(colorFamilyLabels[family]) : '';
  return avoidedColors
    .map(normalizeColorTerm)
    .filter(term => term.length > 0)
    .some(term => colorName.includes(term) || familyName === term);
}

const eligibilityRules: readonly IEligibilityRule[] = [
  {
    code: 'availability',
    skippedForMustInclude: false,
    reject: garment =>
      garment.status === 'ACTIVE'
        ? null
        : `No está disponible: ${enumLabels.garmentStatus[garment.status].toLowerCase()}.`,
  },
  {
    code: 'tagging',
    skippedForMustInclude: false,
    reject: (garment, context) => {
      if (context.request.includeSuggested || garment.taggingStatus === 'CONFIRMED') {
        return null;
      }
      return `Sus atributos todavía no están confirmados (${enumLabels.taggingStatus[garment.taggingStatus].toLowerCase()}).`;
    },
  },
  {
    code: 'avoided-type',
    skippedForMustInclude: true,
    reject: (garment, context) =>
      context.profile.avoidedGarmentTypeIds.includes(garment.garmentTypeId)
        ? `Marcaste "${garment.garmentTypeName}" como un tipo que prefieres evitar.`
        : null,
  },
  {
    code: 'avoided-color',
    skippedForMustInclude: true,
    reject: (garment, context) =>
      matchesAvoidedColor(garment, context.profile.avoidedColors)
        ? `Su color (${garment.primaryColorName}) está entre los que prefieres evitar.`
        : null,
  },
  {
    code: 'weather',
    skippedForMustInclude: false,
    reject: (garment, context) => {
      const temperature = context.request.temperatureC;
      if (temperature === null) {
        return null;
      }
      const { weatherMinC, weatherMaxC } = garment;
      if (weatherMinC !== null && temperature < weatherMinC - weatherToleranceC) {
        return `A ${temperature} °C se queda corta de abrigo: ${describeRange(garment)}.`;
      }
      if (weatherMaxC !== null && temperature > weatherMaxC + weatherToleranceC) {
        return `A ${temperature} °C da demasiado calor: ${describeRange(garment)}.`;
      }
      return null;
    },
  },
];

/**
 * Separa las prendas que pueden entrar en un look de las que no, con el motivo
 * del descarte de cada una.
 * @param {readonly Garment[]} garments - Clóset completo del usuario.
 * @param {IEligibilityContext} context - Perfil y petición ya normalizada.
 * @returns {IEligibilitySplit}
 */
export function splitEligibility(
  garments: readonly Garment[],
  context: IEligibilityContext,
): IEligibilitySplit {
  const eligible: Garment[] = [];
  const excluded: ExcludedGarment[] = [];

  for (const garment of garments) {
    const isMustInclude = garment.id === context.request.mustIncludeGarmentId;
    const failure = firstFailure(garment, context, isMustInclude);
    if (failure) {
      excluded.push({ garmentId: garment.id, name: garment.name, ...failure });
    } else {
      eligible.push(garment);
    }
  }

  return { eligible, excluded };
}

/**
 * Devuelve la primera regla que descarta la prenda, o null si las pasa todas.
 * @param {Garment} garment - Prenda a evaluar.
 * @param {IEligibilityContext} context - Perfil y petición ya normalizada.
 * @param {boolean} isMustInclude - Si el usuario pidió esta prenda explícitamente.
 * @returns {{ rule: string; reason: string } | null}
 */
function firstFailure(
  garment: Garment,
  context: IEligibilityContext,
  isMustInclude: boolean,
): { rule: string; reason: string } | null {
  const applicable = eligibilityRules.filter(rule => !isMustInclude || !rule.skippedForMustInclude);
  for (const rule of applicable) {
    const reason = rule.reject(garment, context);
    if (reason) {
      return { rule: rule.code, reason };
    }
  }
  return null;
}
