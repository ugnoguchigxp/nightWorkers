import { describe, expect, it } from 'vitest';
import { calculateUsageCost, seedCodexPricingRows } from '../api/services/pricing';

describe('LLM pricing calculation', () => {
  it('separates uncached and cached input tokens without double counting', () => {
    const result = calculateUsageCost({
      inputTokens: 1000,
      cachedInputTokens: 400,
      outputTokens: 500,
      reasoningOutputTokens: null,
      pricing: {
        id: 'pricing-test',
        createdAt: new Date(),
        updatedAt: new Date(),
        provider: 'openai',
        model: 'priced-model',
        currencyCode: 'USD',
        inputPer1m: 10,
        cachedInputPer1m: 1,
        outputPer1m: 20,
        reasoningOutputPer1m: null,
        sourceUrl: null,
        sourceLabel: null,
        effectiveFrom: new Date(0),
        fetchedAt: new Date(),
        manualOverride: true,
        enabled: true,
      },
    });

    expect(result.inputCost).toBeCloseTo(0.006);
    expect(result.cachedInputCost).toBeCloseTo(0.0004);
    expect(result.outputCost).toBeCloseTo(0.01);
    expect(result.totalCost).toBeCloseTo(0.0164);
  });

  it('seeds official Codex credit pricing rows', async () => {
    const rows = await seedCodexPricingRows();

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'codex',
          model: 'gpt-5.4-mini',
          currencyCode: 'CREDITS',
          inputPer1m: 18.75,
          cachedInputPer1m: 1.875,
          outputPer1m: 113,
        }),
        expect.objectContaining({
          provider: 'codex',
          model: 'gpt-5.3-codex',
          currencyCode: 'CREDITS',
          inputPer1m: 43.75,
          cachedInputPer1m: 4.375,
          outputPer1m: 350,
        }),
      ])
    );
  });
});
