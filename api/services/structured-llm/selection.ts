import type { StructuredLlmModelTarget, StructuredLlmThinkingDepth } from './settings';

export function normalizeStructuredLlmModelTarget(value: unknown): StructuredLlmModelTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const providerEndpointId =
    typeof record.providerEndpointId === 'string' ? record.providerEndpointId.trim() : '';
  const model = typeof record.model === 'string' ? record.model.trim() : '';
  if (!providerEndpointId || !model) return null;
  const thinkingDepth = normalizeThinkingDepth(record.thinkingDepth);
  return {
    providerEndpointId,
    model,
    ...(thinkingDepth ? { thinkingDepth } : {}),
  };
}

function normalizeThinkingDepth(value: unknown): Exclude<StructuredLlmThinkingDepth, ''> | null {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'very_high') {
    return value;
  }
  return null;
}
