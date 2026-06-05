import { describe, expect, it } from 'vitest';
import { normalizeProviderUsage } from '../api/services/llm-usage';

describe('LLM usage normalization', () => {
  it('normalizes OpenAI chat usage fields', () => {
    const usage = normalizeProviderUsage({
      provider: 'openai',
      rawUsage: {
        prompt_tokens: 123,
        completion_tokens: 45,
        total_tokens: 168,
        prompt_tokens_details: { cached_tokens: 20 },
        completion_tokens_details: { reasoning_tokens: 7 },
      },
      fallback: {
        systemPrompt: 'system',
        userPrompt: 'user',
        responseText: 'response',
      },
    });

    expect(usage).toMatchObject({
      inputTokens: 123,
      outputTokens: 45,
      totalTokens: 168,
      cachedInputTokens: 20,
      reasoningOutputTokens: 7,
      mode: 'measured',
    });
  });

  it('falls back to estimated usage when provider usage is missing', () => {
    const usage = normalizeProviderUsage({
      provider: 'fixture',
      rawUsage: null,
      fallback: {
        systemPrompt: 'system prompt',
        userPrompt: 'user prompt',
        responseText: 'assistant response',
      },
    });

    expect(usage.mode).toBe('estimated');
    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.outputTokens).toBeGreaterThan(0);
    expect(usage.totalTokens).toBe((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0));
  });
});
