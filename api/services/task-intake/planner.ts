import { z } from 'zod';
import type {
  GenerateTaskIntakePlan,
  TaskIntakePlan,
  TaskIntakePlannerInput,
  TaskIntakeRawPlan,
  TaskIntakeRawTodo,
  TaskIntakeTodo,
  TaskType,
} from './types';
import { taskTypes } from './types';

const DEFAULT_MAX_TODOS = 8;
const MAX_TITLE_CHARS = 80;
const rawTodoSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().optional().nullable(),
  taskType: z.enum(taskTypes).optional(),
  dependsOn: z.array(z.union([z.number().int().positive(), z.string()])).optional(),
  status: z.enum(['pending', 'needs_human']).optional(),
  statusReason: z.string().optional().nullable(),
});

const rawPlanSchema = z.object({
  todos: z.array(rawTodoSchema).min(1),
});

export async function planTaskIntake(
  input: TaskIntakePlannerInput,
  options: { generatePlan?: GenerateTaskIntakePlan } = {}
): Promise<TaskIntakePlan> {
  const maxTodos = normalizeMaxTodos(input.maxTodos);
  if (options.generatePlan) {
    try {
      const generated = await options.generatePlan({ ...input, maxTodos });
      const parsed = parseGeneratedPlan(generated);
      const normalized = normalizeRawPlan(parsed, input, maxTodos, 'llm');
      if (normalized) return normalized;
    } catch {
      return fallbackPlan(input, ['intake_generator_failed']);
    }
    return fallbackPlan(input, ['intake_generator_invalid']);
  }

  return heuristicPlan(input, maxTodos);
}

function parseGeneratedPlan(raw: TaskIntakeRawPlan | string | null | undefined): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    const candidate = extractJsonCandidate(raw);
    if (!candidate) return null;
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }
}

function normalizeRawPlan(
  raw: unknown,
  input: TaskIntakePlannerInput,
  maxTodos: number,
  source: TaskIntakePlan['source']
): TaskIntakePlan | null {
  const parsed = rawPlanSchema.safeParse(raw);
  if (!parsed.success) return null;
  const warnings: string[] = [];
  const rawTodos = parsed.data.todos.slice(0, maxTodos);
  if (parsed.data.todos.length > maxTodos) warnings.push('todo_count_compressed');

  const todos = rawTodos.map((todo, index) => normalizeRawTodo(todo, index + 1));
  if (todos.length === 0) return fallbackPlan(input, ['intake_empty'], source);
  return { todos, source, warnings };
}

function normalizeRawTodo(raw: z.infer<typeof rawTodoSchema>, seq: number): TaskIntakeTodo {
  const title = normalizeTitle(raw.title);
  const status = raw.status === 'needs_human' ? 'needs_human' : 'pending';
  const dependsOn = normalizeDependsOn(raw.dependsOn, seq);
  return {
    seq,
    title,
    description: normalizeDescription(raw.description),
    taskType: raw.taskType || inferTaskType(`${raw.title}\n${raw.description || ''}`),
    status,
    dependsOn,
    statusReason:
      status === 'needs_human' ? raw.statusReason || 'Needs human clarification.' : null,
  };
}

function heuristicPlan(input: TaskIntakePlannerInput, maxTodos: number): TaskIntakePlan {
  const prompt = input.latestUserMessage.trim();
  if (isAmbiguousPrompt(prompt)) {
    return {
      todos: [
        {
          seq: 1,
          title: normalizeTitle(prompt || input.taskTitle || 'Clarify request'),
          description: prompt || input.taskDescription || null,
          taskType: 'investigation',
          status: 'needs_human',
          dependsOn: [],
          statusReason: 'Request is too ambiguous to split safely.',
        },
      ],
      source: 'fallback',
      warnings: ['ambiguous_request'],
    };
  }

  const items = splitPromptIntoTodoCandidates(prompt);
  const warnings: string[] = [];
  const selected = items.slice(0, maxTodos);
  if (items.length > maxTodos) warnings.push('todo_count_compressed');
  const todos =
    selected.length > 0
      ? selected.map((item, index) => ({
          seq: index + 1,
          title: normalizeTitle(item),
          description: item,
          taskType: inferTaskType(item),
          status: 'pending' as const,
          dependsOn: index === 0 ? [] : [index],
          statusReason: null,
        }))
      : fallbackPlan(input, [], 'heuristic').todos;

  return { todos, source: 'heuristic', warnings };
}

function fallbackPlan(
  input: TaskIntakePlannerInput,
  warnings: string[],
  source: TaskIntakePlan['source'] = 'fallback'
): TaskIntakePlan {
  const content = input.latestUserMessage.trim() || input.taskDescription || input.taskTitle;
  return {
    todos: [
      {
        seq: 1,
        title: normalizeTitle(content || 'Run requested task'),
        description: content || null,
        taskType: inferTaskType(content || ''),
        status: 'pending',
        dependsOn: [],
        statusReason: null,
      },
    ],
    source,
    warnings,
  };
}

function splitPromptIntoTodoCandidates(prompt: string): string[] {
  const lines = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const listItems = lines
    .map((line) =>
      line
        .replace(/^[-*]\s+/, '')
        .replace(/^\d+[.)]\s+/, '')
        .trim()
    )
    .filter((line, index) => line !== lines[index] || /^[-*]\s+|^\d+[.)]\s+/.test(lines[index]));
  if (listItems.length > 1) return listItems;

  const sentenceItems = prompt
    .split(/(?:。|\n|;|；)/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 8);
  if (sentenceItems.length > 1) return sentenceItems;

  return prompt ? [prompt] : [];
}

function inferTaskType(text: string): TaskType {
  const lower = text.toLowerCase();
  if (/(test|spec|vitest|playwright|検証.*追加|テスト)/.test(lower)) return 'test_change';
  if (/(doc|readme|spec\/|仕様|文書|ドキュメント|計画)/.test(lower)) return 'documentation';
  if (/(review|レビュー|確認して|見て)/.test(lower)) return 'review';
  if (/(verify|検証|動作確認|確認)/.test(lower)) return 'verification';
  if (/(調査|investigate|調べ|原因)/.test(lower)) return 'investigation';
  return 'code_change';
}

function normalizeTitle(value: string): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= MAX_TITLE_CHARS) return oneLine;
  return `${oneLine.slice(0, MAX_TITLE_CHARS - 3).trim()}...`;
}

function normalizeDescription(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeDependsOn(value: TaskIntakeRawTodo['dependsOn'], seq: number): number[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((item) => (typeof item === 'number' ? item : Number.parseInt(String(item), 10)))
    .filter((item) => Number.isInteger(item) && item > 0 && item < seq);
  return Array.from(new Set(normalized));
}

function normalizeMaxTodos(value: number | undefined): number {
  if (!Number.isInteger(value) || !value) return DEFAULT_MAX_TODOS;
  return Math.min(Math.max(value, 1), DEFAULT_MAX_TODOS);
}

function isAmbiguousPrompt(prompt: string): boolean {
  const normalized = prompt.replace(/\s+/g, '');
  if (normalized.length < 8) return true;
  return /^(よろしく|お願いします|いい感じに|なんとかして|改善して)$/.test(normalized);
}

function extractJsonCandidate(raw: string): string | null {
  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i) || raw.match(/```\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) return raw.slice(first, last + 1).trim();
  return null;
}
