import { describe, expect, it } from 'vitest';
import { costUsdFromUsage, fallbackPricing, pricingFor } from './openai-pricing';

/**
 * El costo que se guarda en `AiJob` y en `AiUsageLog` sale de aquí, así que un
 * error en esta cuenta se traduce en un presupuesto que no corta cuando debería.
 */

const knownModel = 'gpt-5.6-luna';
const unknownModel = 'modelo-que-no-existe';

describe('costUsdFromUsage', () => {
  it('cobra entrada y salida a la tarifa del modelo', () => {
    // 1M de entrada a 0,20 USD + 1M de salida a 1,20 USD.
    const cost = costUsdFromUsage(knownModel, {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cachedInputTokens: 0,
    });

    expect(cost).toBeCloseTo(1.4, 6);
  });

  it('cobra los tokens cacheados a su tarifa y no dos veces', () => {
    // 1M de entrada de los que 800k venían de caché: 200k frescos + 800k cacheados.
    const cost = costUsdFromUsage(knownModel, {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 800_000,
    });

    expect(cost).toBeCloseTo(0.2 * 0.2 + 0.8 * 0.02, 6);
  });

  it('no cobra nada cuando no se consumió nada', () => {
    const cost = costUsdFromUsage(knownModel, {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
    });

    expect(cost).toBe(0);
  });

  it('un modelo desconocido se cobra a la tarifa más cara que conocemos', () => {
    const cost = costUsdFromUsage(unknownModel, {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 0,
    });

    expect(pricingFor(unknownModel)).toBeNull();
    expect(cost).toBeCloseTo(fallbackPricing.inputUsdPerMTok, 6);
  });

  it('un recuento de caché mayor que la entrada no produce un costo negativo', () => {
    const cost = costUsdFromUsage(knownModel, {
      inputTokens: 100,
      outputTokens: 0,
      cachedInputTokens: 500,
    });

    expect(cost).toBeGreaterThanOrEqual(0);
  });
});
