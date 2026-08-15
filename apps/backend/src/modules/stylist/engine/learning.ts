import {
  colorFamilyFromHex,
  colorFamilyLabels,
  enumLabels,
  type ColorFamily,
  type FitPreference,
  type Garment,
  type GarmentSlot,
  type OutfitRejectedReason,
} from '@closetai/shared-types';
import { isNeutralColor } from './color-harmony';
import {
  alreadyGeneratedPenalty,
  likedGarmentBonus,
  maxRejectedGarmentPenalty,
  neutralPreferenceScore,
  rejectedColorPenalty,
  rejectedFitPenalty,
  rejectedFormalityPenalty,
  rejectedGarmentPenalty,
  rejectedSetPenalty,
} from './engine.constants';
import { coreGarments, draftKey, garmentSetKey, type IOutfitDraft } from './outfit-draft';
import { average, clampScore } from './score-utils';

/**
 * El bucle de aprendizaje dentro de la Capa 1.
 */

/** Un look que el usuario rechazó, tal como lo necesita el motor. */
export interface IRejectedOutfit {
  garmentIds: readonly string[];
  reason: OutfitRejectedReason | null;
}

/**
 * Historial de valoraciones del usuario. Va como entrada del motor y no como una
 * consulta interna: la Capa 1 sigue siendo código puro y sus tests siguen
 * escribiéndose con objetos literales.
 */
export interface IStyleFeedback {
  rejected: readonly IRejectedOutfit[];
  likedGarmentIds: readonly string[];
  generatedKeys: readonly string[];
}

export interface IPreferenceResult {
  score: number;
  reason: string;
}

/** Historial vacío: el caso de un usuario que todavía no ha valorado nada. */
export const emptyFeedback: IStyleFeedback = {
  rejected: [],
  likedGarmentIds: [],
  generatedKeys: [],
};

const noFeedbackReason = 'Todavía no has valorado ningún look: nada penalizado por historial.';

/** Slots que forman el núcleo de un look. Es contra ellos que se compara. */
const coreSlots = new Set<GarmentSlot>(['TOP', 'BOTTOM', 'FULL_BODY', 'FOOTWEAR']);

interface IPreferenceOutcome {
  delta: number;
  reason: string;
}

/** Lo que las reglas necesitan saber del conjunto que se está puntuando. */
interface IPreferenceContext {
  key: string;
  core: readonly Garment[];
  averageFormality: number;
  fits: ReadonlySet<FitPreference>;
  chromaticFamilies: ReadonlySet<ColorFamily>;
  feedback: IStyleFeedback;
  garmentsById: ReadonlyMap<string, Garment>;
}

interface IPreferenceRule {
  code: string;
  evaluate: (context: IPreferenceContext) => IPreferenceOutcome | null;
}

/**
 * Familias con tono propio de un conjunto de prendas. Los neutros no cuentan: una
 * camiseta blanca no es la razón por la que alguien rechaza una combinación.
 * @param {readonly Garment[]} garments - Prendas a mirar.
 * @returns {Set<ColorFamily>}
 */
function chromaticFamiliesOf(garments: readonly Garment[]): Set<ColorFamily> {
  return new Set(
    garments
      .filter(garment => !isNeutralColor(garment.primaryColorHex))
      .map(garment => colorFamilyFromHex(garment.primaryColorHex))
      .filter((family): family is ColorFamily => family !== null),
  );
}

/**
 * Núcleo de un conjunto de prendas: base y calzado. Se compara núcleo con núcleo
 * porque es donde viven la formalidad, el color y el corte del look; si no, un
 * reloj cambiaría la media contra la que se compara.
 * @param {readonly Garment[]} garments - Prendas del look.
 * @returns {Garment[]}
 */
function coreOf(garments: readonly Garment[]): Garment[] {
  return garments.filter(garment => coreSlots.has(garment.slot));
}

/**
 * Resuelve el núcleo de los rechazos con un motivo concreto contra el clóset
 * actual. Las prendas que ya no existen se ignoran: no hay nada que comparar con
 * una prenda borrada.
 * @param {IPreferenceContext} context - Conjunto que se está puntuando.
 * @param {OutfitRejectedReason} reason - Motivo que interesa.
 * @returns {Garment[][]}
 */
function rejectionsBecause(context: IPreferenceContext, reason: OutfitRejectedReason): Garment[][] {
  return context.feedback.rejected
    .filter(rejected => rejected.reason === reason)
    .map(rejected =>
      coreOf(
        rejected.garmentIds
          .map(garmentId => context.garmentsById.get(garmentId))
          .filter((garment): garment is Garment => garment !== undefined),
      ),
    )
    .filter(garments => garments.length > 0);
}

const preferenceRules: readonly IPreferenceRule[] = [
  {
    code: 'rejected-set',
    evaluate: context => {
      const match = context.feedback.rejected.find(
        rejected => garmentSetKey(rejected.garmentIds) === context.key,
      );
      if (!match) {
        return null;
      }
      const because = match.reason
        ? ` (${enumLabels.outfitRejectedReason[match.reason].toLowerCase()})`
        : '';
      return { delta: -rejectedSetPenalty, reason: `Rechazaste este mismo conjunto${because}.` };
    },
  },
  {
    code: 'already-generated',
    evaluate: context => {
      if (!context.feedback.generatedKeys.includes(context.key)) {
        return null;
      }
      return {
        delta: -alreadyGeneratedPenalty,
        reason: 'Ya te había propuesto este conjunto antes.',
      };
    },
  },
  {
    code: 'rejected-color',
    evaluate: context => {
      if (context.chromaticFamilies.size === 0) {
        return null;
      }
      const repeatsPalette = rejectionsBecause(context, 'COLOR').some(garments => {
        const rejectedFamilies = chromaticFamiliesOf(garments);
        return [...context.chromaticFamilies].every(family => rejectedFamilies.has(family));
      });
      if (!repeatsPalette) {
        return null;
      }
      const labels = [...context.chromaticFamilies]
        .map(family => colorFamilyLabels[family].toLowerCase())
        .join(' y ');
      return {
        delta: -rejectedColorPenalty,
        reason: `Rechazaste por color una combinación de ${labels}.`,
      };
    },
  },
  {
    code: 'rejected-formality',
    evaluate: context => {
      const tooFormal = rejectionsBecause(context, 'TOO_FORMAL');
      const tooCasual = rejectionsBecause(context, 'TOO_CASUAL');
      const formalityOf = (garments: readonly Garment[]): number =>
        average(garments.map(garment => garment.formality));

      if (tooFormal.some(garments => context.averageFormality >= formalityOf(garments))) {
        return {
          delta: -rejectedFormalityPenalty,
          reason: 'Rechazaste por demasiado formal un conjunto de esta formalidad o menor.',
        };
      }
      if (tooCasual.some(garments => context.averageFormality <= formalityOf(garments))) {
        return {
          delta: -rejectedFormalityPenalty,
          reason: 'Rechazaste por demasiado casual un conjunto de esta formalidad o mayor.',
        };
      }
      return null;
    },
  },
  {
    code: 'rejected-fit',
    evaluate: context => {
      if (context.fits.size === 0) {
        return null;
      }
      const repeatsFits = rejectionsBecause(context, 'UNCOMFORTABLE').some(garments => {
        const rejectedFits = new Set(garments.map(garment => garment.fit));
        return [...context.fits].every(fit => rejectedFits.has(fit));
      });
      if (!repeatsFits) {
        return null;
      }
      const labels = [...context.fits]
        .map(fit => enumLabels.fitPreference[fit].toLowerCase())
        .join(' y ');
      return {
        delta: -rejectedFitPenalty,
        reason: `Marcaste como incómodo un conjunto con el mismo corte (${labels}).`,
      };
    },
  },
  {
    code: 'rejected-garment',
    evaluate: context => {
      const suspect = new Set(
        context.feedback.rejected
          .filter(rejected => rejected.reason !== 'GARMENT_UNAVAILABLE')
          .flatMap(rejected => rejected.garmentIds),
      );
      const repeated = context.core.filter(garment => suspect.has(garment.id));
      if (repeated.length === 0) {
        return null;
      }
      const penalty = Math.min(repeated.length * rejectedGarmentPenalty, maxRejectedGarmentPenalty);
      const names = repeated.map(garment => garment.name).join(', ');
      return { delta: -penalty, reason: `Ya rechazaste looks con ${names}.` };
    },
  },
  {
    code: 'liked-garment',
    evaluate: context => {
      const liked = new Set(context.feedback.likedGarmentIds);
      const matching = context.core.filter(garment => liked.has(garment.id));
      if (matching.length === 0) {
        return null;
      }
      const ratio = matching.length / context.core.length;
      const names = matching.map(garment => garment.name).join(', ');
      return {
        delta: ratio * likedGarmentBonus,
        reason: `Guardaste o usaste looks con ${names}.`,
      };
    },
  },
];

/**
 * Puntúa un conjunto según lo que el usuario decidió sobre los looks anteriores.
 * @param {IOutfitDraft} draft - Conjunto candidato.
 * @param {IStyleFeedback} feedback - Historial de valoraciones del usuario.
 * @param {readonly Garment[]} closet - Clóset con el que resolver los rechazos.
 * @returns {IPreferenceResult}
 */
export function scorePreference(
  draft: IOutfitDraft,
  feedback: IStyleFeedback,
  closet: readonly Garment[],
): IPreferenceResult {
  const hasHistory =
    feedback.rejected.length > 0 ||
    feedback.likedGarmentIds.length > 0 ||
    feedback.generatedKeys.length > 0;
  if (!hasHistory) {
    return { score: neutralPreferenceScore, reason: noFeedbackReason };
  }

  const core = coreGarments(draft);
  const context: IPreferenceContext = {
    core,
    feedback,
    key: draftKey(draft),
    averageFormality: average(core.map(garment => garment.formality)),
    fits: new Set(core.map(garment => garment.fit)),
    chromaticFamilies: chromaticFamiliesOf(core),
    garmentsById: new Map(closet.map(garment => [garment.id, garment])),
  };

  const outcomes = preferenceRules
    .map(rule => rule.evaluate(context))
    .filter((outcome): outcome is IPreferenceOutcome => outcome !== null);
  if (outcomes.length === 0) {
    return {
      score: neutralPreferenceScore,
      reason: 'Nada de este conjunto choca con lo que has valorado antes.',
    };
  }

  const totalDelta = outcomes.reduce((total, outcome) => total + outcome.delta, 0);
  const [strongest] = [...outcomes].sort(
    (first, second) => Math.abs(second.delta) - Math.abs(first.delta),
  );
  return {
    score: clampScore(neutralPreferenceScore + totalDelta),
    reason: strongest?.reason ?? noFeedbackReason,
  };
}
