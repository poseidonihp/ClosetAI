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

/**
 * Tarifa de un modelo de imagen. Se separa de la de texto porque son tres
 * precios distintos y no dos: el texto del prompt, los tokens de las imágenes que
 * entran y los tokens de la imagen que sale, que es lo que domina el costo.
 */
export interface IImageModelPricing {
  inputTextUsdPerMTok: number;
  inputImageUsdPerMTok: number;
  outputImageUsdPerMTok: number;
}

/**
 * Precios confirmados contra la tabla de OpenAI el 20 de agosto de 2026, al
 * implementar la Fase 6. Están atados al id del modelo y no al entorno: cambiar
 * `OPENAI_IMAGE_MODEL` sin añadir aquí su tarifa dejaría el costo mal calculado
 * en silencio.
 */
const imagePricingByModel: Record<string, IImageModelPricing> = {
  'gpt-image-2': {
    inputTextUsdPerMTok: 5,
    inputImageUsdPerMTok: 8,
    outputImageUsdPerMTok: 30,
  },
  'gpt-image-1.5': {
    inputTextUsdPerMTok: 5,
    inputImageUsdPerMTok: 8,
    outputImageUsdPerMTok: 32,
  },
  'chatgpt-image-latest': {
    inputTextUsdPerMTok: 5,
    inputImageUsdPerMTok: 8,
    outputImageUsdPerMTok: 32,
  },
  'gpt-image-1': {
    inputTextUsdPerMTok: 5,
    inputImageUsdPerMTok: 10,
    outputImageUsdPerMTok: 40,
  },
  'gpt-image-1-mini': {
    inputTextUsdPerMTok: 2,
    inputImageUsdPerMTok: 2.5,
    outputImageUsdPerMTok: 8,
  },
};

/**
 * Tarifa de un modelo de imagen desconocido: la del más caro que conocemos, para
 * que la reserva de presupuesto nunca se quede corta.
 */
export const fallbackImagePricing: IImageModelPricing = {
  inputTextUsdPerMTok: 5,
  inputImageUsdPerMTok: 10,
  outputImageUsdPerMTok: 40,
};

/** Consumo de una generación de imagen, ya normalizado. */
export interface IImageTokenUsage {
  inputTextTokens: number;
  inputImageTokens: number;
  outputImageTokens: number;
}

/**
 * Devuelve la tarifa de un modelo de imagen, o null si no está en la tabla.
 * @param {string} model - Identificador del modelo.
 * @returns {IImageModelPricing | null}
 */
export function imagePricingFor(model: string): IImageModelPricing | null {
  return imagePricingByModel[model] ?? null;
}

/**
 * Calcula el costo en USD de una generación de imagen a partir del consumo real.
 * @param {string} model - Identificador del modelo.
 * @param {IImageTokenUsage} usage - Consumo reportado por el proveedor.
 * @returns {number}
 */
export function imageCostUsdFromUsage(model: string, usage: IImageTokenUsage): number {
  const pricing = imagePricingFor(model) ?? fallbackImagePricing;
  const textUsd = (usage.inputTextTokens * pricing.inputTextUsdPerMTok) / tokensPerMillion;
  const inputImageUsd = (usage.inputImageTokens * pricing.inputImageUsdPerMTok) / tokensPerMillion;
  const outputUsd = (usage.outputImageTokens * pricing.outputImageUsdPerMTok) / tokensPerMillion;
  return textUsd + inputImageUsd + outputUsd;
}
