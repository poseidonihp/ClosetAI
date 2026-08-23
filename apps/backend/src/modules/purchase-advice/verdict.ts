import type { PurchaseVerdict, PurchaseVerdictReason } from '@closetai/shared-types';
import { matchesAvoidedColor } from '../stylist/engine/garment-rules';
import { minScoreGainPoints } from '../wardrobe-gaps/coverage/coverage.constants';
import type { IVerdictContext } from './purchase-advice.types';

/**
 * El veredicto. **Lo decide el código, no el modelo**, con reglas declarativas y
 * la primera que acierta.
 */

export interface IVerdictDecision {
  verdict: PurchaseVerdict;
  reason: PurchaseVerdictReason;
}

interface IVerdictRule extends IVerdictDecision {
  matches: (context: IVerdictContext) => boolean;
}

const verdictRules: readonly IVerdictRule[] = [
  {
    verdict: 'NOT_RECOMMENDED',
    reason: 'AVOIDED_COLOR',
    matches: context =>
      matchesAvoidedColor(
        context.candidate.primaryColorName,
        context.candidate.primaryColorHex,
        context.profile.avoidedColors,
      ),
  },
  {
    verdict: 'NOT_RECOMMENDED',
    reason: 'AVOIDED_TYPE',
    matches: context =>
      context.profile.avoidedGarmentTypeIds.includes(context.candidate.garmentTypeId),
  },
  {
    verdict: 'RECOMMENDED',
    reason: 'MATCHES_GAP',
    matches: context => context.matchedGapId !== null,
  },
  {
    verdict: 'RECOMMENDED',
    reason: 'COVERS_SCENARIO',
    matches: context => context.impact.newlyCoveredScenarioIds.length > 0,
  },
  {
    verdict: 'RECOMMENDED',
    reason: 'UNLOCKS_OUTFITS',
    matches: context => context.impact.unlockedOutfitsEstimate > 0,
  },
  {
    verdict: 'RECOMMENDED',
    reason: 'IMPROVES_SCORE',
    matches: context => context.impact.scoreGain >= minScoreGainPoints,
  },
  {
    verdict: 'NOT_RECOMMENDED',
    reason: 'DUPLICATE',
    matches: context => context.duplicateGarmentIds.length > 0,
  },
  {
    verdict: 'CONDITIONAL',
    reason: 'NO_IMPACT',
    matches: () => true,
  },
];

/** Sale cuando `verdictRules` no puede fallar, pero el tipo no lo sabe. */
const fallbackDecision: IVerdictDecision = { verdict: 'CONDITIONAL', reason: 'NO_IMPACT' };

/**
 * Decide el veredicto con la primera regla que acierta.
 * @param {IVerdictContext} context - Prenda, perfil y lo que midió el motor.
 * @returns {IVerdictDecision}
 */
export function decideVerdict(context: IVerdictContext): IVerdictDecision {
  const rule = verdictRules.find(candidate => candidate.matches(context));
  return rule ? { verdict: rule.verdict, reason: rule.reason } : fallbackDecision;
}
