import type { MockBlueprint } from '../../../shared/schemas/mock-blueprint.schema';
import { mockBlueprintSchema } from '../../../shared/schemas/mock-blueprint.schema';
import {
  buildMockBlueprintSectionCatalog,
  buildMockBlueprintStructuredOutputJsonSchema,
  buildMockBlueprintSystemPrompt,
  buildMockBlueprintUserPrompt,
  MOCK_BLUEPRINT_PROMPT_VERSION,
  mockBlueprintPromptDiagnostics,
} from '../structured-generation/prompts/mock-blueprint';
import { callStructuredJsonLLM, type SupervisorLlmDebugEvent } from '../structured-llm';
import {
  type JsonFixWrapperResult,
  jsonFixWrapper,
  parseRepairedJsonWithSchema,
} from '../structured-llm/json';

export type GeneratedMockBlueprintDraft = {
  mockBlueprint: MockBlueprint;
  generation: {
    source: 'llm';
    promptVersion: typeof MOCK_BLUEPRINT_PROMPT_VERSION;
    rawOutput?: string;
    jsonRepair?: {
      repaired: boolean;
      repairKind: JsonFixWrapperResult['repairKind'];
    };
    promptDiagnostics: MockBlueprintPromptDiagnostics;
  };
};

export type MockBlueprintPromptDiagnostics = ReturnType<typeof mockBlueprintPromptDiagnostics>;

export class MockBlueprintDraftGenerationError extends Error {
  rawOutput?: string;
  promptDiagnostics: MockBlueprintPromptDiagnostics;

  constructor(
    message: string,
    input: { rawOutput?: string; promptDiagnostics: MockBlueprintPromptDiagnostics }
  ) {
    super(message);
    this.name = 'MockBlueprintDraftGenerationError';
    this.rawOutput = input.rawOutput;
    this.promptDiagnostics = input.promptDiagnostics;
  }
}

export async function generatePlanModeMockBlueprintDraft(input: {
  taskId: string;
  title: string;
  prompt: string;
  description?: string | null;
  objective?: string | null;
  questionnaireMarkdown?: string | null;
  featurePlanSummary?: string | null;
  emitEvent?: (event: SupervisorLlmDebugEvent) => Promise<void> | void;
}): Promise<GeneratedMockBlueprintDraft> {
  const schema = buildMockBlueprintStructuredOutputJsonSchema();
  const systemPrompt = buildMockBlueprintSystemPrompt({
    sectionCatalog: buildMockBlueprintSectionCatalog(),
    jsonSchema: schema,
  });
  const userPrompt = buildMockBlueprintUserPrompt({
    task: {
      id: input.taskId,
      title: input.title,
      description: input.description,
      objective: input.objective,
    },
    questionnaireMarkdown: input.questionnaireMarkdown,
    featurePlanSummary: input.featurePlanSummary,
    prompt: input.prompt,
  });
  const promptDiagnostics = mockBlueprintPromptDiagnostics({
    systemPrompt,
    userPrompt,
    schema,
  });
  const rawOutput = await callStructuredJsonLLM(systemPrompt, userPrompt, {
    schemaName: 'mock_blueprint',
    schema,
    emitEvent: input.emitEvent,
    taskId: input.taskId,
    runId: null,
    role: 'plan',
    allowRawOutputOnJsonParseFailure: true,
  });

  const parsed = parseMockBlueprintJsonOutput(rawOutput);
  if (!parsed.ok) {
    throw new MockBlueprintDraftGenerationError(
      parsed.reason === 'schema'
        ? `Mock Blueprint LLM output failed schema validation: ${parsed.message}`
        : 'Mock Blueprint LLM output did not contain valid JSON.',
      { rawOutput, promptDiagnostics }
    );
  }

  return {
    mockBlueprint: parsed.value,
    generation: {
      source: 'llm',
      promptVersion: MOCK_BLUEPRINT_PROMPT_VERSION,
      rawOutput,
      jsonRepair: {
        repaired: parsed.repaired,
        repairKind: parsed.repairKind,
      },
      promptDiagnostics,
    },
  };
}

function parseMockBlueprintJsonOutput(rawOutput: string):
  | {
      ok: true;
      value: MockBlueprint;
      sourceText: string;
      repaired: boolean;
      repairKind: JsonFixWrapperResult['repairKind'];
    }
  | { ok: false; reason: 'parse' | 'schema'; message: string; rawOutput: string } {
  const parsed = parseRepairedJsonWithSchema(rawOutput, mockBlueprintSchema);
  if (parsed.ok) return parsed;

  const jsonFix = jsonFixWrapper(rawOutput);
  if (!jsonFix) {
    const balancedPrefix = firstBalancedJsonObject(rawOutput);
    if (!balancedPrefix) {
      return {
        ok: false,
        reason: 'parse',
        message: 'LLM output did not contain repairable JSON.',
        rawOutput,
      };
    }
    const prefixParsed = parseNormalizedMockBlueprintCandidate(balancedPrefix);
    if (prefixParsed.ok) {
      return {
        ok: true,
        value: prefixParsed.value,
        sourceText: balancedPrefix,
        repaired: true,
        repairKind: 'balanced_json',
      };
    }
    return prefixParsed.error;
  }

  const normalized = normalizeMockBlueprintCandidate(jsonFix.parsedJson);
  const normalizedParsed = mockBlueprintSchema.safeParse(normalized);
  if (normalizedParsed.success) {
    return {
      ok: true,
      value: normalizedParsed.data,
      sourceText: jsonFix.sourceText,
      repaired: true,
      repairKind: jsonFix.repairKind,
    };
  }

  return {
    ok: false,
    reason: 'schema',
    message: normalizedParsed.error.issues
      .slice(0, 6)
      .map((issue) => `${issue.path.join('.') || '$'}:${issue.message}`)
      .join(', '),
    rawOutput,
  };
}

function parseNormalizedMockBlueprintCandidate(sourceText: string):
  | { ok: true; value: MockBlueprint }
  | {
      ok: false;
      error: { ok: false; reason: 'parse' | 'schema'; message: string; rawOutput: string };
    } {
  try {
    const normalized = normalizeMockBlueprintCandidate(JSON.parse(sourceText));
    const parsed = mockBlueprintSchema.safeParse(normalized);
    if (parsed.success) return { ok: true, value: parsed.data };
    return {
      ok: false,
      error: {
        ok: false,
        reason: 'schema',
        message: parsed.error.issues
          .slice(0, 6)
          .map((issue) => `${issue.path.join('.') || '$'}:${issue.message}`)
          .join(', '),
        rawOutput: sourceText,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        ok: false,
        reason: 'parse',
        message: error instanceof Error ? error.message : String(error),
        rawOutput: sourceText,
      },
    };
  }
}

function normalizeMockBlueprintCandidate(candidate: unknown): unknown {
  if (Array.isArray(candidate)) {
    return normalizeMockBlueprintCandidate(
      candidate.find(
        (item) => isRecord(item) && String(item.artifactKind || '') === 'mock_blueprint'
      ) ?? candidate[0]
    );
  }
  if (!isRecord(candidate)) return candidate;
  const blueprint = { ...candidate };
  if (Array.isArray(blueprint.screens)) {
    blueprint.screens = normalizeMockBlueprintScreens(blueprint.screens);
  }
  if (!Array.isArray(blueprint.generationNotes)) blueprint.generationNotes = [];
  return blueprint;
}

function normalizeMockBlueprintScreens(screens: unknown[]): unknown[] {
  const normalizedScreens: Record<string, unknown>[] = [];
  for (const screen of screens) {
    if (looksLikeMockBlueprintSection(screen) && normalizedScreens.length > 0) {
      const previous = normalizedScreens[normalizedScreens.length - 1];
      const sections = Array.isArray(previous.sections) ? previous.sections : [];
      previous.sections = [...sections, normalizeMockBlueprintSection(screen)];
      continue;
    }
    const normalized = normalizeMockBlueprintScreen(screen);
    if (isRecord(normalized)) normalizedScreens.push(normalized);
  }
  return normalizedScreens;
}

function normalizeMockBlueprintScreen(screen: unknown): unknown {
  if (!isRecord(screen)) return screen;
  const screenRecord = { ...screen };
  if (Array.isArray(screenRecord.sections)) {
    screenRecord.sections = screenRecord.sections.map(normalizeMockBlueprintSection);
  }
  return screenRecord;
}

function normalizeMockBlueprintSection(section: unknown): unknown {
  if (!isRecord(section)) return section;
  const sectionRecord = { ...section };
  sectionRecord.copy = normalizeMockBlueprintCopy(sectionRecord.copy);
  sectionRecord.dataset = normalizeMockBlueprintDataset(sectionRecord.dataset);
  return sectionRecord;
}

function looksLikeMockBlueprintSection(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && typeof value.componentName === 'string' && isRecord(value.dataset);
}

function normalizeMockBlueprintCopy(copy: unknown): unknown {
  if (!isRecord(copy)) return copy;
  return {
    title: stringValue(copy.title, 'Untitled'),
    description: nullableString(copy.description),
    primaryActionLabel: nullableString(copy.primaryActionLabel),
    secondaryActionLabel: nullableString(copy.secondaryActionLabel),
    emptyStateTitle: nullableString(copy.emptyStateTitle),
    emptyStateDescription: nullableString(copy.emptyStateDescription),
  };
}

function normalizeMockBlueprintDataset(dataset: unknown): unknown {
  if (!isRecord(dataset) || typeof dataset.kind !== 'string') return dataset;
  switch (dataset.kind) {
    case 'navigation':
      return {
        kind: 'navigation',
        items: arrayOfRecords(dataset.items).map((item) => ({
          label: stringValue(item.label || item.title || item.name, 'Item'),
          ...(typeof item.href === 'string' ? { href: item.href } : {}),
          ...(typeof item.active === 'boolean' ? { active: item.active } : {}),
        })),
      };
    case 'table':
      return {
        kind: 'table',
        columns: arrayOfRecords(dataset.columns).map((column, index) => ({
          key: stableMockKey(column.key || column.name || `column_${index + 1}`),
          label: stringValue(column.label || column.name || column.key, `Column ${index + 1}`),
        })),
        rows: Array.isArray(dataset.rows) ? dataset.rows.map(normalizeTableRow) : [],
      };
    case 'form':
      return {
        kind: 'form',
        fields: arrayOfRecords(dataset.fields).map((field, index) => ({
          name: stableMockKey(field.name || field.key || `field_${index + 1}`),
          label: stringValue(field.label || field.name || field.key, `Field ${index + 1}`),
          type: normalizeFieldType(field.type),
          ...(typeof field.placeholder === 'string' ? { placeholder: field.placeholder } : {}),
          ...(Array.isArray(field.options) ? { options: field.options.map(String) } : {}),
        })),
        submitLabel: stringValue(dataset.submitLabel || dataset.primaryActionLabel, 'Submit'),
      };
    case 'cards':
      return {
        kind: 'cards',
        cards: arrayOfRecords(dataset.cards || dataset.items).map((card) => ({
          title: stringValue(card.title || card.label || card.name, 'Card'),
          description: stringValue(
            card.description || card.summary || card.body || card.content,
            'No description.'
          ),
          ...(typeof card.meta === 'string' ? { meta: card.meta } : {}),
          ...(typeof card.actionLabel === 'string' ? { actionLabel: card.actionLabel } : {}),
        })),
      };
    case 'kanban':
      return {
        kind: 'kanban',
        columns: arrayOfRecords(dataset.columns).map((column, index) => ({
          id: stableMockKey(column.id || column.key || `column_${index + 1}`),
          title: stringValue(column.title || column.label || column.name, `Column ${index + 1}`),
          cards: arrayOfRecords(column.cards || column.items).map((card) => ({
            title: stringValue(card.title || card.label || card.name, 'Card'),
            description: stringValue(card.description || card.summary || card.body, 'No details.'),
            ...(typeof card.meta === 'string' ? { meta: card.meta } : {}),
          })),
        })),
      };
    case 'timeline':
      return {
        kind: 'timeline',
        items: arrayOfRecords(dataset.items).map((item) => ({
          title: stringValue(item.title || item.label || item.name, 'Event'),
          description: stringValue(
            item.description || item.summary || item.body || item.content,
            'No details.'
          ),
          ...(typeof item.timestamp === 'string' ? { timestamp: item.timestamp } : {}),
        })),
      };
    case 'article':
      return {
        kind: 'article',
        title: stringValue(dataset.title || dataset.label, 'Article'),
        body: stringValue(dataset.body || dataset.content || dataset.description, 'No body.'),
        ...(articleMeta(dataset).length > 0 ? { meta: articleMeta(dataset) } : {}),
      };
    case 'metrics':
      return {
        kind: 'metrics',
        metrics: arrayOfRecords(dataset.metrics || dataset.items).map((metric) => ({
          label: stringValue(metric.label || metric.title || metric.name, 'Metric'),
          value: scalarValue(metric.value ?? metric.count ?? metric.total, '0'),
          ...(typeof metric.trend === 'string' ? { trend: metric.trend } : {}),
        })),
      };
    case 'media':
      return {
        kind: 'media',
        items: arrayOfRecords(dataset.items || dataset.cards).map((item) => ({
          title: stringValue(item.title || item.label || item.name, 'Media'),
          description: stringValue(item.description || item.summary || item.caption, 'No details.'),
          ...(typeof item.mediaLabel === 'string' ? { mediaLabel: item.mediaLabel } : {}),
        })),
      };
    case 'map':
      return {
        kind: 'map',
        points: arrayOfRecords(dataset.points || dataset.items).map((point) => ({
          label: stringValue(point.label || point.title || point.name, 'Point'),
          description: stringValue(point.description || point.summary || point.body, 'No details.'),
          ...(typeof point.region === 'string' ? { region: point.region } : {}),
        })),
      };
    case 'code':
      return {
        kind: 'code',
        files: arrayOfRecords(dataset.files || dataset.items).map((file) => ({
          path: stringValue(file.path || file.title || file.name, 'file.txt'),
          language: stringValue(file.language || file.lang, 'text'),
          excerpt: stringValue(file.excerpt || file.body || file.content, 'No excerpt.'),
        })),
      };
    case 'chat':
      return {
        kind: 'chat',
        messages: arrayOfRecords(dataset.messages || dataset.items).map((message) => ({
          author: stringValue(message.author || message.name || message.role, 'User'),
          body: stringValue(message.body || message.content || message.description, 'No message.'),
          ...(typeof message.state === 'string' ? { state: message.state } : {}),
        })),
      };
    case 'generic':
      return {
        kind: 'generic',
        items: arrayOfRecords(dataset.items || dataset.cards).map((item) => ({
          title: stringValue(item.title || item.label || item.name, 'Item'),
          description: stringValue(item.description || item.summary || item.body, 'No details.'),
        })),
      };
    default:
      return dataset;
  }
}

function normalizeTableRow(row: unknown) {
  if (!isRecord(row)) return {};
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, scalarValue(value, '')])
  );
}

function articleMeta(dataset: Record<string, unknown>) {
  const meta = arrayOfRecords(dataset.meta).map((item) => ({
    label: stringValue(item.label || item.title || item.name, 'Meta'),
    value: stringValue(item.value || item.description || item.body, ''),
  }));
  if (typeof dataset.author === 'string') meta.push({ label: 'author', value: dataset.author });
  if (typeof dataset.publishedAt === 'string') {
    meta.push({ label: 'publishedAt', value: dataset.publishedAt });
  }
  return meta.filter((item) => item.value);
}

function normalizeFieldType(value: unknown) {
  return ['text', 'textarea', 'select', 'checkbox', 'date', 'number'].includes(String(value))
    ? String(value)
    : 'text';
}

function stableMockKey(value: unknown) {
  const key = String(value || 'item')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(key) ? key : `item_${key || '1'}`;
}

function scalarValue(value: unknown, fallback: string) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return fallback;
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function nullableString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function firstBalancedJsonObject(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('{')) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return trimmed.slice(0, index + 1);
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
