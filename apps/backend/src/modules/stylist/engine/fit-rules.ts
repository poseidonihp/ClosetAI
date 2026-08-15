import {
  enumLabels,
  type FitPreference,
  type Garment,
  type StyleProfile,
} from '@closetai/shared-types';
import {
  balanceDifferenceCm,
  heightProportionDelta,
  loosePiecesBeforePenalty,
  measurementBalanceDelta,
  neutralFitScore,
  preferredFitBonus,
  preferredFitPenalty,
  shortHeightCm,
  tallHeightCm,
  volumeBalanceDelta,
} from './engine.constants';
import { clampScore } from './score-utils';
import { coreGarments, type IOutfitDraft } from './outfit-draft';

/**
 * Reglas de ajuste como **datos tipados**, no como prosa dentro de un prompt.
 */

export interface IFitRuleOutcome {
  /** Positivo premia, negativo penaliza. */
  delta: number;
  note: string;
}

export interface IFitRule {
  code: string;
  applies: (profile: StyleProfile) => boolean;
  evaluate: (draft: IOutfitDraft, profile: StyleProfile) => IFitRuleOutcome | null;
}

export interface IFitEvaluation {
  score: number;
  notes: string[];
  reason: string;
}

const noPreferencesReason =
  'Sin preferencias de ajuste declaradas: no se ha penalizado ningún corte.';

/** Cortes que añaden volumen. Dos a la vez ya se notan. */
const looseFits: ReadonlySet<FitPreference> = new Set(['RELAXED', 'OVERSIZED']);

/**
 * Nombre en minúscula del corte, para incrustarlo en una frase.
 * @param {FitPreference} fit - Corte de la prenda o preferencia del usuario.
 * @returns {string}
 */
function fitLabel(fit: FitPreference): string {
  return enumLabels.fitPreference[fit].toLowerCase();
}

/**
 * Enumera nombres de prenda en una lista legible en español.
 * @param {readonly Garment[]} garments - Prendas a nombrar.
 * @returns {string}
 */
function listNames(garments: readonly Garment[]): string {
  return garments.map(garment => garment.name).join(', ');
}

export const fitRules: readonly IFitRule[] = [
  {
    code: 'preferred-fit',
    applies: profile => profile.preferredFits.length > 0,
    evaluate: (draft, profile) => {
      const core = coreGarments(draft);
      const matching = core.filter(garment => profile.preferredFits.includes(garment.fit));
      const ratio = matching.length / core.length;
      const labels = profile.preferredFits.map(fitLabel).join(' o ');
      return {
        delta: ratio * preferredFitBonus - (1 - ratio) * preferredFitPenalty,
        note: `${matching.length} de ${core.length} prendas usan el corte ${labels} que marcaste como cómodo.`,
      };
    },
  },
  {
    code: 'volume-balance',
    applies: () => true,
    evaluate: draft => {
      const loose = [...coreGarments(draft), ...draft.layers].filter(garment =>
        looseFits.has(garment.fit),
      );
      if (loose.length < loosePiecesBeforePenalty) {
        return null;
      }
      return {
        delta: -volumeBalanceDelta,
        note: `Hay ${loose.length} prendas holgadas a la vez (${listNames(loose)}); cambiar una por un corte regular equilibra el volumen.`,
      };
    },
  },
  {
    code: 'short-height-proportions',
    applies: profile => profile.heightCm !== null && profile.heightCm < shortHeightCm,
    evaluate: (draft, profile) => {
      const bottom = draft.bottom ?? draft.fullBody;
      if (!bottom || profile.heightCm === null) {
        return null;
      }
      if (bottom.fit === 'OVERSIZED') {
        return {
          delta: -heightProportionDelta,
          note: `Con ${profile.heightCm} cm, ${bottom.name} en corte oversized corta la línea; un corte regular o ajustado la alarga.`,
        };
      }
      return {
        delta: heightProportionDelta,
        note: `Con ${profile.heightCm} cm, el corte ${fitLabel(bottom.fit)} de ${bottom.name} mantiene la línea continua.`,
      };
    },
  },
  {
    code: 'tall-height-lengths',
    applies: profile => profile.heightCm !== null && profile.heightCm > tallHeightCm,
    evaluate: (draft, profile) => {
      if (profile.heightCm === null) {
        return null;
      }
      const roomy = [...coreGarments(draft), ...draft.layers].filter(garment =>
        looseFits.has(garment.fit),
      );
      if (roomy.length === 0) {
        return {
          delta: 0,
          note: `Con ${profile.heightCm} cm puedes con largos amplios: comprueba que las mangas y los bajos no queden cortos.`,
        };
      }
      return {
        delta: heightProportionDelta,
        note: `Con ${profile.heightCm} cm, el volumen de ${listNames(roomy)} cae bien; revisa que los bajos lleguen donde toca.`,
      };
    },
  },
  {
    code: 'measurement-balance',
    applies: profile =>
      typeof profile.measurements?.shoulder === 'number' &&
      typeof profile.measurements?.hips === 'number',
    evaluate: (draft, profile) => {
      const shoulder = profile.measurements?.shoulder;
      const hips = profile.measurements?.hips;
      if (typeof shoulder !== 'number' || typeof hips !== 'number') {
        return null;
      }
      if (Math.abs(shoulder - hips) < balanceDifferenceCm) {
        return null;
      }
      const measurementsText = `las medidas que diste (hombros ${shoulder} cm, cadera ${hips} cm)`;
      const fits = new Set(coreGarments(draft).map(garment => garment.fit));
      if (fits.size > 1) {
        return {
          delta: measurementBalanceDelta,
          note: `Según ${measurementsText}, mezclar cortes distintos como en este conjunto equilibra la silueta.`,
        };
      }
      return {
        delta: 0,
        note: `Según ${measurementsText}, combinar una prenda más ajustada con otra de más caída equilibraría la silueta.`,
      };
    },
  },
];

/**
 * Aplica todas las reglas de ajuste que el perfil habilita y devuelve la nota
 * junto con las frases que la justifican.
 * @param {IOutfitDraft} draft - Conjunto candidato.
 * @param {StyleProfile} profile - Perfil del usuario.
 * @returns {IFitEvaluation}
 */
export function evaluateFitRules(draft: IOutfitDraft, profile: StyleProfile): IFitEvaluation {
  const outcomes = fitRules
    .filter(rule => rule.applies(profile))
    .map(rule => rule.evaluate(draft, profile))
    .filter((outcome): outcome is IFitRuleOutcome => outcome !== null);

  const totalDelta = outcomes.reduce((total, outcome) => total + outcome.delta, 0);
  const notes = outcomes.map(outcome => outcome.note);
  const [firstNote] = notes;
  return {
    score: clampScore(neutralFitScore + totalDelta),
    reason: firstNote ?? noPreferencesReason,
    notes,
  };
}
