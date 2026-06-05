import { estimateTokens } from '../conversation-context/token-budget';
import type { NormalizedLlmUsage } from './types';

type UsageFallback = {
  systemPrompt: string;
  userPrompt: string;
  responseText: string;
};

export function estimateLlmUsage(input: UsageFallback): NormalizedLlmUsage {
  const inputTokens = estimateTokens([input.systemPrompt, input.userPrompt].join('\n'));
  const outputTokens = estimateTokens(input.responseText);
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens: null,
    reasoningOutputTokens: null,
    totalTokens: inputTokens + outputTokens,
    mode: 'estimated',
  };
}

export function normalizeProviderUsage(input: {
  provider: string;
  rawUsage: unknown;
  fallback: UsageFallback;
}): NormalizedLlmUsage {
  const usage = asRecord(input.rawUsage);
  if (!usage) return estimateLlmUsage(input.fallback);

  const inputTokens = firstNumber(
    usage.input_tokens,
    usage.prompt_tokens,
    usage.inputTokens,
    usage.promptTokens
  );
  const outputTokens = firstNumber(
    usage.output_tokens,
    usage.completion_tokens,
    usage.outputTokens,
    usage.completionTokens
  );
  const totalTokens = firstNumber(usage.total_tokens, usage.totalTokens);
  const cachedInputTokens = firstNumber(
    usage.cached_input_tokens,
    usage.cachedInputTokens,
    asRecord(usage.prompt_tokens_details)?.cached_tokens,
    asRecord(usage.input_tokens_details)?.cached_tokens
  );
  const reasoningOutputTokens = firstNumber(
    usage.reasoning_output_tokens,
    usage.reasoningOutputTokens,
    asRecord(usage.completion_tokens_details)?.reasoning_tokens,
    asRecord(usage.output_tokens_details)?.reasoning_tokens
  );

  if (inputTokens === null && outputTokens === null && totalTokens === null) {
    return estimateLlmUsage(input.fallback);
  }

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningOutputTokens,
    totalTokens:
      totalTokens ??
      (inputTokens !== null || outputTokens !== null
        ? (inputTokens ?? 0) + (outputTokens ?? 0)
        : null),
    mode: 'measured',
    rawUsage: input.rawUsage,
  };
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  }
  return null;
}
