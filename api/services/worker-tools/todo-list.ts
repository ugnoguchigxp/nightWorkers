import * as repo from '../../modules/nightworkers/nightworkers.repository';
import { getTodoWorkflowSettings } from '../../modules/queue/queue-management.service';
import { buildStandardImplementationTodoList, type ImplementationTodoInput } from '../todo-runtime';
import type { WorkerToolResult } from './types';

export type TodoToolName = 'todo_list';

export type TodoListOperation = 'list' | 'replace' | 'start' | 'done' | 'block' | 'fail';
export type TodoListReplaceReason =
  | 'initial_plan'
  | 'scope_changed'
  | 'estimate_changed'
  | 'newly_required_work'
  | 'blocked_replan';

export type TodoListPayloadTodo = {
  id: string;
  seq: number;
  title: string;
  description?: string | null;
  taskType: string;
  status: string;
  procedureId?: string | null;
  dependsOn?: Array<string | number> | null;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
};

export type TodoActionDiagnostics = {
  errorCode?: string;
  attemptedAction?: {
    action: TodoToolName;
    operation?: TodoListOperation;
    seq?: number;
    todoListReplaceReason?: TodoListReplaceReason;
  };
  currentSnapshot?: {
    runningCount: number;
    runningSeqs: number[];
    pendingSeqs: number[];
  };
};

export type TodoActionTransition = {
  previousCurrentSeq?: number | null;
  nextCurrentSeq?: number | null;
  completedSeq?: number | null;
};

export type TodoActionPayload = {
  runId: string;
  taskId: string;
  action: TodoToolName;
  operation?: TodoListOperation;
  todos: TodoListPayloadTodo[];
  currentTodo?: TodoListPayloadTodo | null;
  nextTodo?: TodoListPayloadTodo | null;
  transition?: TodoActionTransition;
  diagnostics?: TodoActionDiagnostics;
};

type TodoMutationContext = {
  runId: string;
  taskId: string;
  todos: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>;
};

export async function todoListTool(input: {
  runId: string;
  operation: TodoListOperation;
  seq?: number;
  todos?: ImplementationTodoInput[];
  startFirst?: boolean;
  todoListReplaceReason?: TodoListReplaceReason;
}): Promise<WorkerToolResult<TodoActionPayload>> {
  if (input.operation === 'list') {
    return withTodoMutationContext('todo_list', input.runId, input.operation, {}, async (context) =>
      okTodoAction('todo_list', input.operation, context.runId, context.taskId, context.todos)
    );
  }

  if (input.operation === 'replace') {
    return withTodoMutationContext(
      'todo_list',
      input.runId,
      input.operation,
      { todoListReplaceReason: input.todoListReplaceReason },
      async ({ runId, taskId, todos: currentTodos }) => {
        const reasonValidation = validateTodoListReplaceReason({
          currentTodos,
          todoListReplaceReason: input.todoListReplaceReason,
        });
        if (!reasonValidation.ok) {
          return failedTodoAction(
            { runId, taskId, todos: currentTodos },
            'todo_list',
            input.operation,
            reasonValidation.errorCode,
            { todoListReplaceReason: input.todoListReplaceReason }
          );
        }
        const workflowSettings = await getTodoWorkflowSettings();
        const todos = buildStandardImplementationTodoList({
          todos: input.todos ?? [],
          startFirst: input.startFirst,
          includeKnowledgeCapture: workflowSettings.requireRegisterCandidatePrompt,
        });
        const created = await repo.replaceTaskRunTodosForRun(runId, todos);
        return okTodoAction('todo_list', input.operation, runId, taskId, created, {
          transition: {
            previousCurrentSeq: null,
            nextCurrentSeq: created.find((todo) => todo.status === 'running')?.seq ?? null,
          },
        });
      }
    );
  }

  if (input.operation === 'start') {
    return startTodo({
      runId: input.runId,
      action: 'todo_list',
      operation: input.operation,
      seq: input.seq,
    });
  }

  if (input.operation === 'done') {
    return completeTodo({
      runId: input.runId,
      action: 'todo_list',
      operation: input.operation,
      seq: input.seq,
      status: 'passed',
      startNext: true,
    });
  }

  if (input.operation === 'block') {
    return completeTodo({
      runId: input.runId,
      action: 'todo_list',
      operation: input.operation,
      seq: input.seq,
      status: 'needs_human',
      startNext: false,
    });
  }

  if (input.operation === 'fail') {
    return completeTodo({
      runId: input.runId,
      action: 'todo_list',
      operation: input.operation,
      seq: input.seq,
      status: 'failed',
      startNext: false,
    });
  }

  return failedTodoActionResult(
    new Date().toISOString(),
    'todo_list',
    input.operation,
    input.runId,
    '',
    'INVALID_TOOL_ARGS'
  );
}

async function startTodo(input: {
  runId: string;
  action: TodoToolName;
  operation: TodoListOperation;
  seq?: number;
}): Promise<WorkerToolResult<TodoActionPayload>> {
  return withTodoMutationContext(
    input.action,
    input.runId,
    input.operation,
    { seq: input.seq },
    async (context) => {
      if (typeof input.seq !== 'number' || !Number.isInteger(input.seq) || input.seq < 1) {
        return failedTodoAction(context, input.action, input.operation, 'INVALID_TOOL_ARGS', {
          seq: input.seq,
        });
      }

      const target = context.todos.find((todo) => todo.seq === input.seq);
      if (!target) {
        return failedTodoAction(context, input.action, input.operation, 'TODO_SEQ_NOT_FOUND', {
          seq: input.seq,
        });
      }
      if (!['pending', 'running'].includes(target.status)) {
        return failedTodoAction(context, input.action, input.operation, 'TODO_NOT_STARTABLE', {
          seq: input.seq,
        });
      }
      const earlierOpenTodo = context.todos.find(
        (todo) => todo.seq < target.seq && ['pending', 'running'].includes(todo.status)
      );
      if (earlierOpenTodo) {
        return failedTodoAction(context, input.action, input.operation, 'PREVIOUS_TODO_OPEN', {
          seq: input.seq,
        });
      }

      const now = new Date();
      for (const candidate of context.todos) {
        if (candidate.id === target.id) {
          await repo.updateTaskRunTodo(
            candidate.id,
            { status: 'running', startedAt: now, completedAt: null },
            { notifyTaskId: context.taskId, notifyRunId: context.runId }
          );
        } else if (candidate.status === 'running') {
          await repo.updateTaskRunTodo(
            candidate.id,
            { status: 'pending', completedAt: null },
            { notifyTaskId: context.taskId, notifyRunId: context.runId }
          );
        }
      }

      const updated = await repo.listTaskRunTodosForRun(context.runId);
      return okTodoAction(input.action, input.operation, context.runId, context.taskId, updated, {
        transition: {
          previousCurrentSeq: currentSeqOrNull(context.todos),
          nextCurrentSeq: input.seq,
        },
      });
    }
  );
}

async function completeTodo(input: {
  runId: string;
  action: TodoToolName;
  operation: TodoListOperation;
  seq?: number;
  status: 'passed' | 'failed' | 'needs_human';
  startNext: boolean;
}): Promise<WorkerToolResult<TodoActionPayload>> {
  return withTodoMutationContext(
    input.action,
    input.runId,
    input.operation,
    { seq: input.seq },
    async (context) => {
      const currentValidation = resolveTargetTodo(context.todos, input.seq);
      if (!currentValidation.ok) {
        const idempotentPassedTodo =
          input.status === 'passed' && input.seq !== undefined
            ? context.todos.find((todo) => todo.seq === input.seq && todo.status === 'passed')
            : null;
        if (idempotentPassedTodo) {
          return okTodoAction(
            input.action,
            input.operation,
            context.runId,
            context.taskId,
            context.todos,
            {
              transition: {
                previousCurrentSeq: currentSeqOrNull(context.todos),
                completedSeq: idempotentPassedTodo.seq,
                nextCurrentSeq: currentSeqOrNull(context.todos),
              },
            }
          );
        }
        return failedTodoAction(
          context,
          input.action,
          input.operation,
          currentValidation.errorCode,
          {
            seq: input.seq,
          }
        );
      }

      const current = currentValidation.todo;
      const now = new Date();
      await repo.updateTaskRunTodo(
        current.id,
        {
          status: input.status,
          completedAt: now,
          startedAt: current.startedAt ? new Date(String(current.startedAt)) : now,
        },
        { notifyTaskId: context.taskId, notifyRunId: context.runId }
      );

      let nextSeq: number | null = null;
      let updated = await repo.listTaskRunTodosForRun(context.runId);
      if (input.startNext) {
        const nextTodo = updated.find(
          (todo) => todo.status === 'pending' && todo.seq > current.seq
        );
        if (nextTodo && !isFinalCloseoutTodo(nextTodo)) {
          const started = await repo.startTaskRunTodoIfStillPendingAndNoEarlierOpen(
            {
              id: nextTodo.id,
              runId: context.runId,
              afterSeq: current.seq,
              startedAt: new Date(),
            },
            { notifyTaskId: context.taskId, notifyRunId: context.runId }
          );
          nextSeq = started?.seq ?? null;
          updated = await repo.listTaskRunTodosForRun(context.runId);
        }
      }

      return okTodoAction(input.action, input.operation, context.runId, context.taskId, updated, {
        transition: {
          previousCurrentSeq: current.seq,
          completedSeq: current.seq,
          nextCurrentSeq: nextSeq,
        },
      });
    }
  );
}

async function withRunContext(
  action: TodoToolName,
  rawRunId: string,
  operation: TodoListOperation,
  attemptedAction: {
    seq?: number;
    todoListReplaceReason?: TodoListReplaceReason;
  },
  fn: (context: { runId: string; taskId: string }) => Promise<WorkerToolResult<TodoActionPayload>>
) {
  const runId = String(rawRunId || '').trim();
  const startedAt = new Date().toISOString();
  if (!runId) {
    return failedTodoActionResult(
      startedAt,
      action,
      operation,
      '',
      '',
      'INVALID_TOOL_ARGS',
      [],
      attemptedAction
    );
  }
  try {
    const run = await repo.getTaskRun(runId);
    if (!run) {
      return failedTodoActionResult(
        startedAt,
        action,
        operation,
        runId,
        '',
        'RUN_NOT_FOUND',
        [],
        attemptedAction
      );
    }
    return await fn({ runId, taskId: run.taskId });
  } catch (error) {
    return {
      ok: false,
      toolName: action,
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: {
        runId,
        taskId: '',
        action,
        operation,
        todos: [],
        diagnostics: {
          errorCode: 'TODO_ACTION_FAILED',
        },
      },
      error: {
        code: 'TODO_ACTION_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function withTodoMutationContext(
  action: TodoToolName,
  runId: string,
  operation: TodoListOperation,
  attemptedAction: {
    seq?: number;
    todoListReplaceReason?: TodoListReplaceReason;
  },
  fn: (context: TodoMutationContext) => Promise<WorkerToolResult<TodoActionPayload>>
) {
  return withRunContext(action, runId, operation, attemptedAction, async (base) => {
    const todos = await repo.listTaskRunTodosForRun(base.runId);
    return fn({ ...base, todos });
  });
}

function okTodoAction(
  action: TodoToolName,
  operation: TodoListOperation,
  runId: string,
  taskId: string,
  todos: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>,
  options: {
    transition?: TodoActionTransition;
  } = {}
): WorkerToolResult<TodoActionPayload> {
  const currentTodo = todos.find((todo) => todo.status === 'running') ?? null;
  const nextTodo = todos.find((todo) => todo.status === 'pending') ?? null;
  return {
    ok: true,
    toolName: action,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    payload: {
      runId,
      taskId,
      action,
      operation,
      todos: todos.map(toPayloadTodo),
      currentTodo: currentTodo ? toPayloadTodo(currentTodo) : null,
      nextTodo: nextTodo ? toPayloadTodo(nextTodo) : null,
      transition: options.transition,
    },
  };
}

function failedTodoAction(
  context: TodoMutationContext,
  action: TodoToolName,
  operation: TodoListOperation,
  errorCode: string,
  attemptedAction: {
    seq?: number;
    todoListReplaceReason?: TodoListReplaceReason;
  }
): WorkerToolResult<TodoActionPayload> {
  return failedTodoActionResult(
    new Date().toISOString(),
    action,
    operation,
    context.runId,
    context.taskId,
    errorCode,
    context.todos,
    attemptedAction
  );
}

function failedTodoActionResult(
  startedAt: string,
  action: TodoToolName,
  operation: TodoListOperation,
  runId: string,
  taskId: string,
  errorCode: string,
  todos: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>> = [],
  attemptedAction: {
    seq?: number;
    todoListReplaceReason?: TodoListReplaceReason;
  } = {}
): WorkerToolResult<TodoActionPayload> {
  const runningTodos = todos.filter((todo) => todo.status === 'running');
  return {
    ok: false,
    toolName: action,
    startedAt,
    finishedAt: new Date().toISOString(),
    payload: {
      runId,
      taskId,
      action,
      operation,
      todos: todos.map(toPayloadTodo),
      currentTodo: runningTodos.length === 1 ? toPayloadTodo(runningTodos[0]) : null,
      nextTodo: null,
      diagnostics: {
        errorCode,
        attemptedAction: { action, operation, ...attemptedAction },
        currentSnapshot: {
          runningCount: runningTodos.length,
          runningSeqs: runningTodos.map((todo) => todo.seq),
          pendingSeqs: todos.filter((todo) => todo.status === 'pending').map((todo) => todo.seq),
        },
      },
    },
    error: {
      code: errorCode,
      message: buildErrorMessage(action, errorCode),
    },
  };
}

function buildErrorMessage(action: TodoToolName, errorCode: string) {
  if (errorCode === 'INVALID_TOOL_ARGS') return `${action} requires valid arguments.`;
  if (errorCode === 'RUN_NOT_FOUND') return 'Run context not found.';
  if (errorCode === 'CURRENT_TODO_MISSING') return 'No running Todo exists for the current run.';
  if (errorCode === 'CURRENT_TODO_NOT_UNIQUE')
    return 'Multiple running Todos exist; current Todo is not unique.';
  if (errorCode === 'TODO_SEQ_NOT_FOUND') return 'Requested Todo seq was not found.';
  if (errorCode === 'TODO_NOT_STARTABLE')
    return 'Requested Todo is already closed and cannot be started.';
  if (errorCode === 'PREVIOUS_TODO_OPEN')
    return 'Previous Todo is still pending or running; close it before starting a later Todo.';
  if (errorCode === 'TODO_LIST_REPLACE_REASON_REQUIRED')
    return 'todo_list operation=replace is structural replanning. A running Todo exists, so provide todoListReplaceReason. If the current Todo is complete, use todo_list operation=done seq=<current>.';
  if (errorCode === 'INVALID_TODO_LIST_REPLACE_REASON')
    return 'todoListReplaceReason must be one of initial_plan, scope_changed, estimate_changed, newly_required_work, or blocked_replan.';
  return `${action} failed.`;
}

function validateTodoListReplaceReason(input: {
  currentTodos: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>;
  todoListReplaceReason?: TodoListReplaceReason;
}): { ok: true } | { ok: false; errorCode: string } {
  if (
    input.todoListReplaceReason !== undefined &&
    !isTodoListReplaceReason(input.todoListReplaceReason)
  ) {
    return { ok: false, errorCode: 'INVALID_TODO_LIST_REPLACE_REASON' };
  }

  const hasRunningTodo = input.currentTodos.some((todo) => todo.status === 'running');
  if (hasRunningTodo && !input.todoListReplaceReason) {
    return { ok: false, errorCode: 'TODO_LIST_REPLACE_REASON_REQUIRED' };
  }

  return { ok: true };
}

function isTodoListReplaceReason(value: unknown): value is TodoListReplaceReason {
  return (
    value === 'initial_plan' ||
    value === 'scope_changed' ||
    value === 'estimate_changed' ||
    value === 'newly_required_work' ||
    value === 'blocked_replan'
  );
}

function resolveCurrentTodo(todos: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>) {
  const runningTodos = todos.filter((todo) => todo.status === 'running');
  if (runningTodos.length === 0) {
    return { ok: false as const, errorCode: 'CURRENT_TODO_MISSING' };
  }
  if (runningTodos.length > 1) {
    return { ok: false as const, errorCode: 'CURRENT_TODO_NOT_UNIQUE' };
  }
  return { ok: true as const, todo: runningTodos[0] };
}

function resolveTargetTodo(
  todos: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>,
  seq?: number
) {
  if (seq === undefined) return resolveCurrentTodo(todos);
  if (!Number.isInteger(seq) || seq < 1) {
    return { ok: false as const, errorCode: 'INVALID_TOOL_ARGS' };
  }
  const todo = todos.find((candidate) => candidate.seq === seq);
  if (!todo) return { ok: false as const, errorCode: 'TODO_SEQ_NOT_FOUND' };
  if (todo.status !== 'running') return { ok: false as const, errorCode: 'CURRENT_TODO_MISSING' };
  return { ok: true as const, todo };
}

function currentSeqOrNull(todos: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>) {
  const current = todos.find((todo) => todo.status === 'running');
  return current?.seq ?? null;
}

function isFinalCloseoutTodo(
  todo: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>[number]
) {
  return (
    (todo.taskType === 'knowledge_capture' &&
      todo.procedureId === 'contextstill.register_candidates') ||
    (todo.taskType === 'completion_report' && todo.procedureId === 'final_completion_report') ||
    todo.procedureId === 'contextstill_closeout'
  );
}

function toPayloadTodo(
  todo: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>[number]
): TodoListPayloadTodo {
  return {
    id: todo.id,
    seq: todo.seq,
    title: todo.title,
    description: todo.description,
    taskType: todo.taskType,
    status: todo.status,
    procedureId: todo.procedureId,
    dependsOn: todo.dependsOn,
    startedAt: todo.startedAt,
    completedAt: todo.completedAt,
  };
}
