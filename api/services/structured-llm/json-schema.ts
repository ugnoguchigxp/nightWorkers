export function normalizeStructuredOutputJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeStructuredOutputJsonSchema(item));
  if (!value || typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    if (key === '$schema' || key === 'default') continue;
    normalized[key] = normalizeStructuredOutputJsonSchema(child);
  }

  if (normalized.type === 'object' && isRecord(normalized.properties)) {
    normalized.required = Object.keys(normalized.properties);
    normalized.additionalProperties = false;
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
