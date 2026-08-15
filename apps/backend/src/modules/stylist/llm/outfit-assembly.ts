import type { Garment, LookScoreLine, ReferenceBrands } from '@closetai/shared-types';
import type { IEngineInput } from '../engine/engine.types';
import { buildDraft, draftKey, garmentIds, type IOutfitDraft } from '../engine/outfit-draft';
import { scoreOutfit } from '../engine/outfit-scoring';
import type { StylistDraft, StylistLookDraft } from './stylist.contract';

/**
 * Validación y ensamblado de lo que devuelve el estilista.
 */

export interface IAssemblyContext {
  input: IEngineInput;
  garmentsByShortId: ReadonlyMap<string, Garment>;
}

/** Narrativa que el modelo aporta y que el servidor no recalcula. */
export interface IOutfitNarrative {
  title: string;
  oneLiner: string;
  description: string;
  occasions: StylistLookDraft['occasions'];
  styleNotes: string[];
  fitNotes: string[];
  referenceBrands: ReferenceBrands;
  qualityNote: string | null;
}

/** Un look ya validado: narrativa del modelo, datos del motor. */
export interface IAssembledOutfit {
  draft: IOutfitDraft;
  garmentIds: string[];
  candidateId: string;
  engineScore: number;
  scoreBreakdown: LookScoreLine[];
  whyByGarmentId: Map<string, string>;
  narrative: IOutfitNarrative;
}

export interface IAssemblyResult {
  accepted: IAssembledOutfit[];
  discarded: string[];
}

const unknownGarmentReason = 'citaba una prenda que no estaba entre las disponibles';
const duplicateGarmentReason = 'repetía la misma prenda dos veces';
const duplicateOutfitReason = 'era el mismo conjunto que otro look de esta tanda';
const missingMustIncludeReason = 'no incluía la prenda que pediste usar';

/**
 * Valida los looks del modelo y los convierte en conjuntos listos para guardar.
 * @param {StylistDraft} draft - Respuesta del modelo, ya validada contra su esquema.
 * @param {IAssemblyContext} context - Clóset, petición y mapa de ids cortos.
 * @returns {IAssemblyResult}
 */
export function assembleOutfits(draft: StylistDraft, context: IAssemblyContext): IAssemblyResult {
  const accepted: IAssembledOutfit[] = [];
  const discarded: string[] = [];
  const seen = new Set<string>();

  // El tope de la petición se cuenta sobre los looks **aceptados**, no sobre los que
  // llegaron. Recortar antes de validar hacía que un primer look inválido dejara la
  // tanda vacía teniendo detrás otros que sí valían: con un solo look pedido, eso es
  // pagar la llamada para no recibir nada.
  for (const [index, look] of draft.looks.entries()) {
    if (accepted.length < context.input.request.limit) {
      const outcome = assembleOne(look, context, seen);
      if (outcome.outfit) {
        seen.add(outcome.outfit.candidateId);
        accepted.push(outcome.outfit);
      } else {
        discarded.push(describeDiscard(index, outcome.reason ?? 'no se pudo validar'));
      }
    }
  }

  return { accepted, discarded };
}

/**
 * Redacta el motivo de un descarte citando qué look fue.
 * @param {number} index - Posición del look en la respuesta del modelo.
 * @param {string} reason - Motivo del descarte.
 * @returns {string}
 */
function describeDiscard(index: number, reason: string): string {
  return `Se descartó la propuesta ${index + 1}: ${reason}.`;
}

/** Un look validado, o el motivo por el que no lo está. */
interface IAssemblyOutcome {
  outfit: IAssembledOutfit | null;
  reason: string | null;
}

/**
 * Valida un único look del modelo.
 * @param {StylistLookDraft} look - Look tal como lo redactó el modelo.
 * @param {IAssemblyContext} context - Clóset, petición y mapa de ids cortos.
 * @param {ReadonlySet<string>} seen - Conjuntos ya aceptados en esta tanda.
 * @returns {IAssemblyOutcome}
 */
function assembleOne(
  look: StylistLookDraft,
  context: IAssemblyContext,
  seen: ReadonlySet<string>,
): IAssemblyOutcome {
  const resolved = resolveGarments(look, context);
  if (resolved.reason !== null) {
    return { outfit: null, reason: resolved.reason };
  }

  const validation = buildDraft(resolved.garments);
  if (!validation.draft) {
    return { outfit: null, reason: (validation.error ?? '').replace(/\.$/, '') };
  }

  const candidateId = draftKey(validation.draft);
  if (seen.has(candidateId)) {
    return { outfit: null, reason: duplicateOutfitReason };
  }

  const mustIncludeId = context.input.request.mustIncludeGarmentId;
  if (mustIncludeId !== null && !resolved.garments.some(garment => garment.id === mustIncludeId)) {
    return { outfit: null, reason: missingMustIncludeReason };
  }

  const scored = scoreOutfit(validation.draft, context.input);
  return {
    reason: null,
    outfit: {
      candidateId,
      draft: validation.draft,
      garmentIds: garmentIds(validation.draft),
      engineScore: scored.engineScore,
      scoreBreakdown: scored.breakdown,
      whyByGarmentId: new Map(
        look.items.map(item => [context.garmentsByShortId.get(item.garmentId)?.id ?? '', item.why]),
      ),
      narrative: toNarrative(look, scored.fitNotes),
    },
  };
}

/** Prendas resueltas de un look, o el motivo por el que no se pudieron resolver. */
interface IResolvedGarments {
  garments: Garment[];
  reason: string | null;
}

/**
 * Resuelve los ids cortos del look contra el clóset. Un id desconocido o una
 * prenda repetida invalidan el look completo: no se "arregla" quitando la prenda,
 * porque el conjunto que el modelo explicó ya no sería ése.
 * @param {StylistLookDraft} look - Look tal como lo redactó el modelo.
 * @param {IAssemblyContext} context - Clóset y mapa de ids cortos.
 * @returns {IResolvedGarments}
 */
function resolveGarments(look: StylistLookDraft, context: IAssemblyContext): IResolvedGarments {
  const garments: Garment[] = [];
  const usedIds = new Set<string>();

  for (const item of look.items) {
    const garment = context.garmentsByShortId.get(item.garmentId);
    if (!garment) {
      return { garments: [], reason: unknownGarmentReason };
    }
    if (usedIds.has(garment.id)) {
      return { garments: [], reason: duplicateGarmentReason };
    }
    usedIds.add(garment.id);
    garments.push(garment);
  }
  return { garments, reason: null };
}

/**
 * Recoge la narrativa del modelo. Las notas de ajuste caen a las que calculó
 * `fit-rules.ts` si el modelo no devolvió ninguna: el bloque de ajuste de la ficha
 * se apoya en datos del perfil, y dejarlo vacío perdería información que ya existe.
 * @param {StylistLookDraft} look - Look tal como lo redactó el modelo.
 * @param {readonly string[]} engineFitNotes - Notas de ajuste del motor para este conjunto.
 * @returns {IOutfitNarrative}
 */
function toNarrative(look: StylistLookDraft, engineFitNotes: readonly string[]): IOutfitNarrative {
  return {
    title: look.title,
    oneLiner: look.oneLiner,
    description: look.description,
    occasions: look.occasions,
    styleNotes: [...look.styleNotes],
    fitNotes: look.fitNotes.length > 0 ? [...look.fitNotes] : [...engineFitNotes],
    referenceBrands: {
      luxury: [...look.referenceBrands.luxury],
      affordable: [...look.referenceBrands.affordable],
    },
    qualityNote: look.qualityNote,
  };
}
