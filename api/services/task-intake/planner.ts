import { z } from 'zod';
import type {
  GenerateTaskIntakePlan,
  TaskIntakePlan,
  TaskIntakePlannerInput,
  TaskIntakeRawPlan,
  TaskIntakeRawTodo,
  TaskIntakeTodo,
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

  return fallbackPlan(input, ['intake_generator_required']);
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
  const hasExplicitTaskType = Boolean(raw.taskType);
  const status = raw.status === 'needs_human' || !hasExplicitTaskType ? 'needs_human' : 'pending';
  const dependsOn = normalizeDependsOn(raw.dependsOn, seq);
  return {
    seq,
    title,
    description: normalizeDescription(raw.description),
    taskType: raw.taskType || 'investigation',
    status,
    dependsOn,
    statusReason:
      status === 'needs_human'
        ? raw.statusReason ||
          (hasExplicitTaskType
            ? 'Needs human clarification.'
            : 'Generated todo is missing an explicit taskType.')
        : null,
  };
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
        taskType: 'investigation',
        status: 'needs_human',
        dependsOn: [],
        statusReason: 'Task intake requires an explicit generated plan.',
      },
    ],
    source,
    warnings,
  };
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

function extractJsonCandidate(raw: string): string | null {
  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i) || raw.match(/```\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) return raw.slice(first, last + 1).trim();
  return null;
}
