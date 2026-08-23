import type { AiJob } from '@prisma/client';
import type {
  Garment,
  GarmentSlot,
  GarmentType,
  PurchaseAdvice,
  PurchaseGarmentRef,
  PurchaseMeasurement,
  PurchaseVerdict,
  PurchaseVerdictReason,
  StyleProfile,
} from '@closetai/shared-types';
import type { IGarmentImpact } from '../wardrobe-gaps/coverage/measure';
import type { IAdvicePromptGarment } from './llm/advice.prompt.v1';
import type { IAdviceResult } from './llm/advice.types';

/**
 * Tipos de "¿me lo compro?". Como el motor y la cobertura, la capa de decisión es
 * **código puro** sobre los DTO de `shared-types`: no conoce Prisma ni Nest, así
 * que un caso golden se escribe con objetos literales.
 */

/** Una brecha `OPEN` del clóset, con lo justo para cruzarla con la candidata. */
export interface IOpenGapRef {
  id: string;
  garmentTypeId: string;
  slot: GarmentSlot;
  colorHex: string;
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
}

/** Prendas nombrables dentro de la respuesta, ya resueltas contra el clóset. */
export interface IResolvedRefs {
  paired: PurchaseGarmentRef[];
  duplicates: PurchaseGarmentRef[];
}

/** Lo que produce una medición completa, antes de decidir si se paga la redacción. */
export interface IMeasurementContext {
  candidate: Garment;
  evaluation: IPurchaseEvaluation;
  measurement: PurchaseMeasurement;
  closetById: Map<string, Garment>;
  signature: string;
}

/** Prendas propias numeradas para el prompt, con el mapa que las resuelve. */
export interface IPromptGarments {
  garments: IAdvicePromptGarment[];
  byShortId: Map<string, Garment>;
}

/** Cuerpo de la respuesta antes de añadirle los metadatos fijos. */
export interface IRespondParts {
  measurement: PurchaseMeasurement;
  advice: PurchaseAdvice | null;
  costUsd?: number;
  reused?: boolean;
}
