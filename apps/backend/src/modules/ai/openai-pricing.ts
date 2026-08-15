/**
 * Precios de los modelos que usamos, en USD por millón de tokens.
 */

export interface IModelPricing {
  inputUsdPerMTok: number;
  cachedInputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

const tokensPerMillion = 1_000_000;

const pricingByModel: Record<string, IModelPricing> = {
  'gpt-5.6-luna': { inputUsdPerMTok: 0.2, cachedInputUsdPerMTok: 0.02, outputUsdPerMTok: 1.2 },
  'gpt-5.6-terra': { inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.2, outputUsdPerMTok: 12 },
  'gpt-5.6-sol': { inputUsdPerMTok: 5, cachedInputUsdPerMTok: 0.5, outputUsdPerMTok: 30 },
};

/**
 * Tarifa para un modelo desconocido. Se toma la del modelo más caro que
 * conocemos para que la reserva de presupuesto nunca se quede corta.
 */
export const fallbackPricing: IModelPricing = {
  inputUsdPerMTok: 5,
  cachedInputUsdPerMTok: 0.5,
  outputUsdPerMTok: 30,
};

/** Consumo devuelto por el proveedor, ya normalizado. */
export interface ITokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

/**
 * Devuelve la tarifa de un modelo, o null si no está en la tabla.
 * @param {string} model - Identificador del modelo.
 * @returns {IModelPricing | null}
 */
export function pricingFor(model: string): IModelPricing | null {
  return pricingByModel[model] ?? null;
}

/**
 * Calcula el costo en USD a partir del consumo real.
 * @param {string} model - Identificador del modelo.
 * @param {ITokenUsage} usage - Consumo reportado por el proveedor.
 * @returns {number}
 */
export function costUsdFromUsage(model: string, usage: ITokenUsage): number {
  const pricing = pricingFor(model) ?? fallbackPricing;
  const freshInputTokens = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const inputUsd = (freshInputTokens * pricing.inputUsdPerMTok) / tokensPerMillion;
  const cachedUsd = (usage.cachedInputTokens * pricing.cachedInputUsdPerMTok) / tokensPerMillion;
  const outputUsd = (usage.outputTokens * pricing.outputUsdPerMTok) / tokensPerMillion;
  return inputUsd + cachedUsd + outputUsd;
}

/**
 * Estimación previa a la llamada, con la que se reserva presupuesto.
 * @param {string} model - Identificador del modelo.
 * @param {ITokenUsage} expectedUsage - Consumo que se espera gastar.
 * @returns {number}
 */
export function estimateCostUsd(model: string, expectedUsage: ITokenUsage): number {
  return costUsdFromUsage(model, expectedUsage);
}
