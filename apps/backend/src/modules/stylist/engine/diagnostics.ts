import {
  enumLabels,
  formalityLabel,
  type ExcludedGarment,
  type Garment,
  type GarmentSlot,
  type LookDiagnostics,
} from '@closetai/shared-types';
import { formalityGapWorthMentioning, formalityWindowByStyleTag } from './engine.constants';
import type { IEngineInput, IScoredOutfit } from './engine.types';
import { formatDecimal } from './score-utils';

/**
 * Diagnóstico cuando el motor no puede dar lo que se pidió.
 */

export interface IDiagnosticsInput {
  input: IEngineInput;
  eligible: readonly Garment[];
  excluded: readonly ExcludedGarment[];
  scored: readonly IScoredOutfit[];
  truncated: boolean;
}

const emptyClosetNote =
  'Con las prendas disponibles no se puede armar un look completo. Un look necesita parte de arriba, parte de abajo y calzado, o una prenda entera con calzado.';

/**
 * Construye el diagnóstico de una generación.
 * @param {IDiagnosticsInput} context - Resultado completo de la generación.
 * @returns {LookDiagnostics}
 */
export function buildDiagnostics(context: IDiagnosticsInput): LookDiagnostics {
  const missingSlots = findMissingSlots(context.eligible);
  const hints = [
    ...describeMustInclude(context),
    ...missingSlots.map(slot => describeMissingSlot(slot, context)),
    ...describeFormalityCeiling(context),
  ];

  return {
    note: buildNote(context, missingSlots),
    eligibleCount: context.eligible.length,
    excludedCount: context.excluded.length,
    truncated: context.truncated,
    missingSlots,
    hints,
  };
}

/**
 * Slots obligatorios sin ninguna prenda disponible. Con una prenda entera la
 * base ya está cubierta: no hace falta ni parte de arriba ni de abajo.
 * @param {readonly Garment[]} eligible - Prendas que pasaron las reglas duras.
 * @returns {GarmentSlot[]}
 */
export function findMissingSlots(eligible: readonly Garment[]): GarmentSlot[] {
  const has = (slot: GarmentSlot): boolean => eligible.some(garment => garment.slot === slot);
  const missing: GarmentSlot[] = [];

  if (!has('FULL_BODY')) {
    if (!has('TOP')) {
      missing.push('TOP');
    }
    if (!has('BOTTOM')) {
      missing.push('BOTTOM');
    }
  }
  if (!has('FOOTWEAR')) {
    missing.push('FOOTWEAR');
  }
  return missing;
}

/**
 * Nota principal: qué pasó, en una frase.
 * @param {IDiagnosticsInput} context - Resultado completo de la generación.
 * @param {readonly GarmentSlot[]} missingSlots - Slots obligatorios sin prendas.
 * @returns {string | null}
 */
function buildNote(
  context: IDiagnosticsInput,
  missingSlots: readonly GarmentSlot[],
): string | null {
  if (context.scored.length > 0) {
    return null;
  }
  const [mustIncludeIssue] = describeMustInclude(context);
  if (mustIncludeIssue) {
    return mustIncludeIssue;
  }
  if (missingSlots.length > 0) {
    const labels = missingSlots.map(slot => enumLabels.garmentSlot[slot].toLowerCase());
    return `No hay ninguna prenda disponible para: ${labels.join(', ')}. ${emptyClosetNote}`;
  }
  return emptyClosetNote;
}

/**
 * Explica qué falta en un slot y cuántas prendas suyas se quedaron fuera.
 * @param {GarmentSlot} slot - Slot obligatorio sin prendas.
 * @param {IDiagnosticsInput} context - Resultado completo de la generación.
 * @returns {string}
 */
function describeMissingSlot(slot: GarmentSlot, context: IDiagnosticsInput): string {
  const label = enumLabels.garmentSlot[slot].toLowerCase();
  const excludedInSlot = context.input.garments.filter(
    garment =>
      garment.slot === slot && context.excluded.some(entry => entry.garmentId === garment.id),
  );
  if (excludedInSlot.length === 0) {
    return `No tienes ninguna prenda de tipo ${label} en el clóset.`;
  }
  return `Tienes ${excludedInSlot.length} prenda(s) de tipo ${label}, pero ninguna entró en esta petición.`;
}

/**
 * Aviso cuando la prenda que se pidió incluir no puede entrar: porque no está en
 * el clóset del usuario o porque una regla dura la dejó fuera.
 * @param {IDiagnosticsInput} context - Resultado completo de la generación.
 * @returns {string[]}
 */
function describeMustInclude(context: IDiagnosticsInput): string[] {
  const mustIncludeId = context.input.request.mustIncludeGarmentId;
  if (mustIncludeId === null) {
    return [];
  }
  const known = context.input.garments.some(garment => garment.id === mustIncludeId);
  if (!known) {
    return ['La prenda que pediste incluir no está en tu clóset.'];
  }
  const excluded = context.excluded.find(entry => entry.garmentId === mustIncludeId);
  if (!excluded) {
    return [];
  }
  return [`"${excluded.name}" no puede entrar en este look. ${excluded.reason}`];
}

/**
 * Aviso cuando ninguna combinación alcanza la ventana de formalidad del estilo
 * pedido, nombrando el techo real del clóset en lugar de sugerir una prenda que
 * no existe.
 * @param {IDiagnosticsInput} context - Resultado completo de la generación.
 * @returns {string[]}
 */
function describeFormalityCeiling(context: IDiagnosticsInput): string[] {
  const [best] = context.scored;
  if (!best || best.formalityGap < formalityGapWorthMentioning) {
    return [];
  }
  const { styleTag } = context.input.request;
  const window = formalityWindowByStyleTag[styleTag];
  const styleLabel = enumLabels.styleArchetype[styleTag].toLowerCase();
  const ceiling = describeMostFormal(context.eligible, 'FOOTWEAR');
  const gapText = `Ninguna combinación llega a la ventana de ${styleLabel} (${window.min}–${window.max}); la mejor se queda en ${formatDecimal(best.averageFormality)}.`;
  return ceiling ? [`${gapText} ${ceiling}`] : [gapText];
}

/**
 * Describe la prenda más formal disponible de un slot.
 * @param {readonly Garment[]} eligible - Prendas que pasaron las reglas duras.
 * @param {GarmentSlot} slot - Slot que interesa.
 * @returns {string | null}
 */
function describeMostFormal(eligible: readonly Garment[], slot: GarmentSlot): string | null {
  const inSlot = eligible.filter(garment => garment.slot === slot);
  const mostFormal = inSlot.reduce<Garment | null>(
    (best, garment) => (best === null || garment.formality > best.formality ? garment : best),
    null,
  );
  if (!mostFormal) {
    return null;
  }
  const slotLabel = enumLabels.garmentSlot[slot].toLowerCase();
  return `Tu ${slotLabel} más formal es "${mostFormal.name}" (${formalityLabel(mostFormal.formality).toLowerCase()}).`;
}
