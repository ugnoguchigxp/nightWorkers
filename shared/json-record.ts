export type DeepRecord = { [key: string]: DeepRecord } & Record<string, unknown>;

export function isDeepRecord(value: unknown): value is DeepRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function toDeepRecord(value: unknown): DeepRecord {
  return isDeepRecord(value) ? value : ({} as DeepRecord);
}

export function toDeepRecordArray(value: unknown): DeepRecord[] {
  return Array.isArray(value) ? value.filter(isDeepRecord) : [];
}

export function getDeepRecordValue(value: unknown, key: string): unknown {
  return toDeepRecord(value)[key] as unknown;
}

export function getDeepRecordString(value: unknown, key: string): string | null {
  const property = getDeepRecordValue(value, key);
  return typeof property === 'string' ? property : null;
}

export function unknownErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  if (error instanceof Error && error.message) return error.message;
  const message = getDeepRecordString(error, 'message');
  if (message) return message;
  const stringified = String(error);
  return stringified === '[object Object]' ? fallback : stringified;
}
