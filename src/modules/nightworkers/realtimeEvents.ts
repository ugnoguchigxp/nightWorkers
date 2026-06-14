import type { RunDetails, TaskEvent, TaskRun, TaskRunTodo, TodoStatus } from './types';

const TERMINAL_TODO_STATUSES = new Set<TodoStatus>(['passed', 'failed', 'skipped', 'needs_human']);
const OPEN_TODO_STATUSES = new Set<TodoStatus>(['pending', 'running']);
const TERMINAL_RUN_STATUSES = new Set([
  'completed',
  'needs_review',
  'needs_human',
  'failed',
  'blocked',
  'timed_out',
  'cancelled',
]);
const ACTIVE_RUN_STATUSES = new Set([
  'running',
  'context_compiling',
  'compiling_context',
  'finalizing',
]);
const OPEN_TODOS_INVALID_TERMINAL_RUN_STATUSES = new Set(['cancelled', 'failed', 'timed_out']);

export function dedupeAndSortRunEvents(events: TaskEvent[]): TaskEvent[] {
  const uniq = new Map<string, TaskEvent>();
  const anonymous: TaskEvent[] = [];
  for (const event of events) {
    if (event?.id) {
      uniq.set(event.id, event);
    } else {
      anonymous.push(event);
    }
  }
  return [...Array.from(uniq.values()), ...anonymous].sort((a, b) => {
    const sa = typeof a.seq === 'number' ? a.seq : Number.MAX_SAFE_INTEGER;
    const sb = typeof b.seq === 'number' ? b.seq : Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return toMs(a.timestamp || a.createdAt) - toMs(b.timestamp || b.createdAt);
  });
}

export function mergeRunEvents(input: {
  latestRunId?: string | null;
  restEvents?: TaskEvent[];
  bufferedEventsByRun: Record<string, TaskEvent[]>;
}): TaskEvent[] {
  const { latestRunId, restEvents = [], bufferedEventsByRun } = input;
  if (!latestRunId) return dedupeAndSortRunEvents(restEvents);
  return dedupeAndSortRunEvents([...restEvents, ...(bufferedEventsByRun[latestRunId] || [])]);
}

export function mergeRealtimeRunDetails(
  previous: RunDetails | null | undefined,
  incomingRun: TaskRun
): RunDetails | null | undefined {
  if (!previous) return previous;
  if (previous.id !== incomingRun.id) return previous;
  if (shouldIgnoreRunUpdate(previous, incomingRun)) return previous;
  return {
    ...previous,
    ...incomingRun,
    todos: resolveRunDetailsTodosForRealtimeMerge(previous.todos, incomingRun),
    events: previous.events,
    reviews: previous.reviews,
  };
}

export function mergeRealtimeRunList(currentRuns: TaskRun[], incomingRun: TaskRun): TaskRun[] {
  const idx = currentRuns.findIndex((run) => run.id === incomingRun.id);
  if (idx < 0) return [incomingRun, ...currentRuns];

  const current = currentRuns[idx];
  if (shouldIgnoreRunUpdate(current, incomingRun)) return currentRuns;

  const next = [...currentRuns];
  next[idx] = {
    ...current,
    ...incomingRun,
    todos: incomingRun.todos ?? current.todos,
    events: current.events,
    reviews: current.reviews,
  };
  return next;
}

export function mergeRealtimeTodoIntoRunDetails(
  previous: RunDetails | null | undefined,
  incomingTodo: TaskRunTodo
): RunDetails | null | undefined {
  if (!previous) return previous;
  if (previous.id !== incomingTodo.runId) return previous;
  return {
    ...previous,
    todos: mergeRealtimeTodo(previous.todos, incomingTodo),
  };
}

export function mergeRealtimeTodo(
  currentTodos: TaskRunTodo[],
  incomingTodo: TaskRunTodo
): TaskRunTodo[] {
  const idx = currentTodos.findIndex((todo) => todo.id === incomingTodo.id);
  if (idx < 0) {
    return sortTodosBySeq([...currentTodos, incomingTodo]);
  }

  const current = currentTodos[idx];
  if (shouldIgnoreTodoUpdate(current, incomingTodo)) return currentTodos;

  const next = [...currentTodos];
  next[idx] = { ...current, ...incomingTodo };
  return sortTodosBySeq(next);
}

export function getRealtimeMessageDedupeKey(message: {
  type?: string;
  taskId?: string;
  seq?: number;
  timestamp?: string;
}): string | null {
  if (!message.type || !message.taskId) return null;
  if (typeof message.seq !== 'number' || !message.timestamp) return null;
  return `${message.taskId}:${message.type}:${message.seq}:${message.timestamp}`;
}

function toMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
  }
  return Number.MAX_SAFE_INTEGER;
}

function sortTodosBySeq(todos: TaskRunTodo[]): TaskRunTodo[] {
  return [...todos].sort((a, b) => a.seq - b.seq);
}

function shouldIgnoreTodoUpdate(current: TaskRunTodo, incoming: TaskRunTodo): boolean {
  const currentIsTerminal = TERMINAL_TODO_STATUSES.has(current.status);
  const incomingIsOpen = OPEN_TODO_STATUSES.has(incoming.status);
  if (currentIsTerminal && incomingIsOpen) return true;

  const currentUpdatedAt = toMs(current.updatedAt);
  const incomingUpdatedAt = toMs(incoming.updatedAt);
  if (
    currentUpdatedAt !== Number.MAX_SAFE_INTEGER &&
    incomingUpdatedAt !== Number.MAX_SAFE_INTEGER &&
    incomingUpdatedAt < currentUpdatedAt
  ) {
    return true;
  }

  return false;
}

function shouldIgnoreRunUpdate(current: TaskRun, incoming: TaskRun): boolean {
  const currentIsTerminal = TERMINAL_RUN_STATUSES.has(current.status);
  const incomingIsActive = ACTIVE_RUN_STATUSES.has(incoming.status);
  if (currentIsTerminal && incomingIsActive) return true;

  const currentUpdatedAt = toMs(current.updatedAt);
  const incomingUpdatedAt = toMs(incoming.updatedAt);
  if (
    currentUpdatedAt !== Number.MAX_SAFE_INTEGER &&
    incomingUpdatedAt !== Number.MAX_SAFE_INTEGER &&
    incomingUpdatedAt < currentUpdatedAt
  ) {
    return true;
  }

  return false;
}

function resolveRunDetailsTodosForRealtimeMerge(
  currentTodos: TaskRunTodo[],
  incomingRun: TaskRun
): TaskRunTodo[] {
  if (incomingRun.todos) return incomingRun.todos;
  if (!OPEN_TODOS_INVALID_TERMINAL_RUN_STATUSES.has(incomingRun.status)) return currentTodos;
  return closeOpenTodosForTerminalRun(currentTodos, incomingRun.status);
}

function closeOpenTodosForTerminalRun(todos: TaskRunTodo[], runStatus: string): TaskRunTodo[] {
  let changed = false;
  const now = new Date().toISOString();
  const next = todos.map((todo) => {
    if (!OPEN_TODO_STATUSES.has(todo.status)) return todo;
    changed = true;
    const nextStatus: TodoStatus = todo.status === 'running' ? 'failed' : 'skipped';
    const statusReason =
      nextStatus === 'failed'
        ? `Run ended with ${runStatus} while this Todo was active.`
        : `Skipped because the run ended with ${runStatus} before this Todo started.`;
    return {
      ...todo,
      status: nextStatus,
      statusReason,
      startedAt: todo.startedAt ?? now,
      completedAt: todo.completedAt ?? now,
      updatedAt: now,
    };
  });
  return changed ? next : todos;
}
