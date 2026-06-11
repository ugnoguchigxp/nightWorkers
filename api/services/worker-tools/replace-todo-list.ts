import * as repo from '../../modules/nightworkers/nightworkers.repository';
import { buildStandardImplementationTodoList, type ImplementationTodoInput } from '../todo-runtime';
import type { WorkerToolResult } from './types';

export type ReplaceTodoListPayload = {
  runId: string;
  taskId: string;
  todos: Array<{
    id: string;
    seq: number;
    title: string;
    description?: string | null;
    taskType: string;
    status: string;
    procedureId?: string | null;
    dependsOn?: Array<string | number> | null;
    startedAt?: Date | string | null;
  }>;
};

export async function replaceTodoListTool(input: {
  runId: string;
  todos?: ImplementationTodoInput[];
  startFirst?: boolean;
}): Promise<WorkerToolResult<ReplaceTodoListPayload>> {
  const startedAt = new Date().toISOString();
  const runId = String(input.runId || '').trim();
  if (!runId) {
    return failedReplaceTodoList(startedAt, 'INVALID_TOOL_ARGS', 'runId is required.');
  }

  try {
    const run = await repo.getTaskRun(runId);
    if (!run) {
      return failedReplaceTodoList(startedAt, 'RUN_NOT_FOUND', `Run context not found: ${runId}`);
    }
    const todos = buildStandardImplementationTodoList({
      todos: input.todos ?? [],
      startFirst: input.startFirst,
    });
    const created = await repo.replaceTaskRunTodosForRun(runId, todos);
    return {
      ok: true,
      toolName: 'replace_todo_list',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: {
        runId,
        taskId: run.taskId,
        todos: created.map((todo) => ({
          id: todo.id,
          seq: todo.seq,
          title: todo.title,
          description: todo.description,
          taskType: todo.taskType,
          status: todo.status,
          procedureId: todo.procedureId,
          dependsOn: todo.dependsOn,
          startedAt: todo.startedAt,
        })),
      },
    };
  } catch (error) {
    return failedReplaceTodoList(
      startedAt,
      'REPLACE_TODO_LIST_FAILED',
      error instanceof Error ? error.message : String(error)
    );
  }
}

function failedReplaceTodoList(
  startedAt: string,
  code: string,
  message: string
): WorkerToolResult<ReplaceTodoListPayload> {
  return {
    ok: false,
    toolName: 'replace_todo_list',
    startedAt,
    finishedAt: new Date().toISOString(),
    payload: {
      runId: '',
      taskId: '',
      todos: [],
    },
    error: { code, message },
  };
}
