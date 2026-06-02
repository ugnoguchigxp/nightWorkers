import type { InspectStructureOutput, JsonParseDiagnostic, JsonShapeEntry } from './types';

export function inspectJsonShape(input: {
  filePath: string;
  content: string;
  maxPaths: number;
  previewPrimitives: boolean;
}): InspectStructureOutput {
  try {
    const parsed = JSON.parse(input.content) as unknown;
    const entries: JsonShapeEntry[] = [];
    const maxPaths = normalizeMaxPaths(input.maxPaths);
    const state = { truncated: false };
    collectJsonShape(parsed, '$', entries, {
      maxPaths,
      previewPrimitives: input.previewPrimitives,
      state,
    });
    return {
      kind: 'json',
      filePath: input.filePath,
      paths: entries,
      truncated: state.truncated,
    };
  } catch (err: any) {
    return {
      kind: 'json',
      filePath: input.filePath,
      paths: [],
      parseError: locateJsonError(input.content, err.message || String(err)),
      truncated: false,
    };
  }
}

function collectJsonShape(
  value: unknown,
  currentPath: string,
  entries: JsonShapeEntry[],
  options: { maxPaths: number; previewPrimitives: boolean; state: { truncated: boolean } }
): void {
  if (entries.length >= options.maxPaths) {
    options.state.truncated = true;
    return;
  }

  const valueType = jsonType(value);
  if (Array.isArray(value)) {
    entries.push({
      path: currentPath,
      type: 'array',
      length: value.length,
      itemTypes: [...new Set(value.slice(0, 20).map(jsonType))],
    });
    value.slice(0, 5).forEach((item, index) => {
      collectJsonShape(item, `${currentPath}[${index}]`, entries, options);
    });
    return;
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    entries.push({ path: currentPath, type: 'object', keys: keys.length });
    for (const key of keys) {
      if (entries.length >= options.maxPaths) {
        options.state.truncated = true;
        return;
      }
      collectJsonShape(
        (value as Record<string, unknown>)[key],
        `${currentPath}.${escapeJsonPathKey(key)}`,
        entries,
        options
      );
    }
    return;
  }

  const entry: JsonShapeEntry = {
    path: currentPath,
    type: valueType,
  };
  if (options.previewPrimitives) {
    entry.preview = value as JsonShapeEntry['preview'];
  }
  entries.push(entry);
}

function normalizeMaxPaths(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 200;
  return Math.min(Math.floor(value), 1_000);
}

function jsonType(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function escapeJsonPathKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

function locateJsonError(content: string, message: string): JsonParseDiagnostic {
  const positionMatch = /position (\d+)/i.exec(message);
  const diagnostic: JsonParseDiagnostic = { message };
  if (!positionMatch) return diagnostic;

  const position = Number(positionMatch[1]);
  const before = content.slice(0, position);
  const lines = before.split(/\r?\n/);
  diagnostic.line = lines.length;
  diagnostic.column = lines[lines.length - 1].length + 1;
  return diagnostic;
}
