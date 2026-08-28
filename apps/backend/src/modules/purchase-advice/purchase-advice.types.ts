import type { AiJob } from '@prisma/client';
import type { GarmentRowWithRelations } from '../garments/garments.service';
import type {
  Garment,
  GarmentSlot,
  GarmentType,
  PurchaseAdvice,
  PurchaseAlternative,
  PurchaseGarmentRef,
  PurchaseMeasurement,
  PurchaseVerdict,
  PurchaseVerdictReason,
  StyleProfile,
} from '@closetai/shared-types';
import type { IGarmentImpact } from '../wardrobe-gaps/coverage/measure';
import type { IAdvicePromptGap, IAdvicePromptGarment } from './llm/advice.prompt.v2';
import type { IAdviceImage, IAdviceResult } from './llm/advice.types';

/**
 * Tipos de "¿me lo compro?". Como el motor y la cobertura, la capa de decisión es
 * **código puro** sobre los DTO de `shared-types`: no conoce Prisma ni Nest, así
 * que un caso golden se escribe con objetos literales.
 */

/**
 * Una brecha `OPEN` del clóset. Lleva lo justo para cruzarla con la candidata
 * —tipo, slot y color— y además lo que hace falta para **ofrecerla como
 * alternativa**: qué prenda es, cuánto desbloquea y en qué puesto la dejó la
 * Fase 5.
 */
export interface IOpenGapRef {
  id: string;
  garmentTypeId: string;
  slot: GarmentSlot;
  colorHex: string;
  colorName: string;
  formality: number;
  description: string;
  priority: number;
  unlockedOutfitsEstimate: number;
}

export interface IPurchaseEvaluationInput {
  candidate: Garment;
  closet: readonly Garment[];
  profile: StyleProfile;
  catalog: readonly GarmentType[];
  openGaps: readonly IOpenGapRef[];
  now: Date;
}

/** Lo que produce la evaluación determinista, antes de que nadie la redacte. */
export interface IPurchaseEvaluation {
  verdict: PurchaseVerdict;
  verdictReason: PurchaseVerdictReason;
  impact: IGarmentImpact | null;
  matchedGapId: string | null;
  duplicateGarmentIds: string[];
  newlyCoveredScenarioLabels: string[];
  bestOutfitScenarioLabel: string | null;
  note: string | null;
}

/** Contexto que consultan las reglas del veredicto. */
export interface IVerdictContext {
  candidate: Garment;
  profile: StyleProfile;
  impact: IGarmentImpact;
  duplicateGarmentIds: readonly string[];
  matchedGapId: string | null;
}

/** Todo lo que hace falta para guardar un veredicto redactado. */
export interface IAdvicePersistContext {
  job: AiJob;
  signature: string;
  measurement: PurchaseMeasurement;
  llmResult: IAdviceResult;
  pairedGarmentIds: string[];
  alternative: PurchaseAlternative | null;
}

/** Prendas nombrables dentro de la respuesta, ya resueltas contra el clóset. */
export interface IResolvedRefs {
  paired: PurchaseGarmentRef[];
  duplicates: PurchaseGarmentRef[];
}

/** Lo que produce una medición completa, antes de decidir si se paga la redacción. */
export interface IMeasurementContext {
  candidate: Garment;
  candidateRow: GarmentRowWithRelations;
  evaluation: IPurchaseEvaluation;
  measurement: PurchaseMeasurement;
  closetById: Map<string, Garment>;
  openGaps: readonly IOpenGapRef[];
  signature: string;
}

/** Prendas propias numeradas para el prompt, con el mapa que las resuelve. */
export interface IPromptGarments {
  garments: IAdvicePromptGarment[];
  byShortId: Map<string, Garment>;
}

/** Brechas abiertas numeradas para el prompt, con el mapa que las resuelve. */
export interface IPromptGaps {
  gaps: IAdvicePromptGap[];
  byShortId: Map<string, IOpenGapRef>;
}

/** Todo lo que se le enseña al modelo, ya numerado y leído de almacenamiento. */
export interface IAdviceCallParts {
  pairedGarments: readonly IAdvicePromptGarment[];
  openGaps: readonly IAdvicePromptGap[];
  images: readonly IAdviceImage[];
}

/** Cuerpo de la respuesta antes de añadirle los metadatos fijos. */
export interface IRespondParts {
  measurement: PurchaseMeasurement;
  advice: PurchaseAdvice | null;
  costUsd?: number;
  reused?: boolean;
}
