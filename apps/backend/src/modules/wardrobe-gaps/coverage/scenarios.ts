import { climateReferenceTempC, enumLabels, type StyleProfile } from '@closetai/shared-types';
import { layeringTemperatureC } from '../../stylist/engine/engine.constants';
import {
  coolScenarioTemperatureC,
  defaultScenarioStyleTags,
  defaultScenarioTemperatureC,
  maxScenarioStyleTags,
  maxScenarios,
  warmScenarioTemperatureC,
} from './coverage.constants';
import type { IScenarioSpec } from './coverage.types';

/**
 * Los escenarios de la matriz de cobertura.
 */

/**
 * Construye los escenarios que se van a evaluar: los estilos del usuario por las
 * bandas térmicas en las que de verdad se viste.
 * @param {StyleProfile} profile - Perfil del usuario.
 * @returns {IScenarioSpec[]}
 */
export function buildScenarios(profile: StyleProfile): IScenarioSpec[] {
  const styleTags = resolveStyleTags(profile);
  const temperatures = resolveTemperatures(profile);

  return styleTags
    .flatMap(styleTag => temperatures.map(temperatureC => ({ styleTag, temperatureC })))
    .slice(0, maxScenarios)
    .map((scenario, index) => ({
      ...scenario,
      id: `s${index + 1}`,
      label: `${enumLabels.styleArchetype[scenario.styleTag]} a ${scenario.temperatureC} °C`,
    }));
}

/**
 * Estilos que se evalúan: los que el usuario declaró, o los por defecto si no
 * declaró ninguno.
 * @param {StyleProfile} profile - Perfil del usuario.
 * @returns {StyleProfile['styleArchetypes']}
 */
function resolveStyleTags(profile: StyleProfile): StyleProfile['styleArchetypes'] {
  const declared = [...new Set(profile.styleArchetypes)].slice(0, maxScenarioStyleTags);
  return declared.length > 0 ? declared : [...defaultScenarioStyleTags];
}

/**
 * Bandas térmicas del análisis: la del clima declarado y una segunda al otro
 * lado del umbral de capa, que es donde aparecen las brechas de abrigo.
 * @param {StyleProfile} profile - Perfil del usuario.
 * @returns {number[]}
 */
function resolveTemperatures(profile: StyleProfile): number[] {
  const declared = profile.climate === null ? null : climateReferenceTempC[profile.climate];
  const base: number = declared ?? defaultScenarioTemperatureC;
  const second = base > layeringTemperatureC ? coolScenarioTemperatureC : warmScenarioTemperatureC;
  return [...new Set([base, second])];
}
