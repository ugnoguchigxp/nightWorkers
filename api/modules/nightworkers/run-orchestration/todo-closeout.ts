import type { AgentRuntimeResult } from '../../../services/agent-runtime/types';
import { digestText } from '../../../services/text-digest';
import { evaluateTodoCompletionGate } from '../../../services/todo-runtime';
import * as repo from '../nightworkers.repository';

export function listOpenTodos<TTodo extends { status: string }>(todos: TTodo[]) {
  return todos.filter((todo) => todo.status === 'pending' || todo.status === 'running');
}

export async function markRunningTodosNeedsHuman(input: {
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
    procedureSnapshot?: unknown;
  }>;
  runtimeResult: AgentRuntimeResult;
  outcomeStatus: string;
}) {
  const runningTodos = input.todos.filter((todo) => todo.status === 'running');
  if (runningTodos.length === 0) return;
  const completedAt = new Date();
  const statusReason = input.runtimeResult.finalReport || input.runtimeResult.summary;
  await Promise.all(
    runningTodos.map((todo) =>
      repo.updateTaskRunTodo(
        todo.id,
        {
          status: 'needs_human',
          statusReason: statusReason || 'Runtime stopped and requires human review.',
          completionGateResult: evaluateTodoCompletionGate({
            todo,
            runtimeResult: input.runtimeResult,
            outcomeStatus: input.outcomeStatus,
          }),
          completedAt,
        },
        { notifyTaskId: input.taskId, notifyRunId: input.runId }
      )
    )
  );
}

export async function closePendingTodosForNeedsHumanRun(input: {
  runId: string;
  taskId: string;
  todos: Array<{
    id: string;
    seq: number;
    title: string;
    taskType: string;
    status: string;
    procedureId?: string | null;
    startedAt?: unknown;
  }>;
  evidence: string;
}) {
  const pendingTodos = input.todos.filter((todo) => todo.status === 'pending');
  if (pendingTodos.length === 0) return;

  const completedAt = new Date();
  await Promise.all(
    pendingTodos.map(async (todo) => {
      const reason = `Run requires human review before this Todo could start: ${input.evidence}`;
      const completionGateResult = {
        version: 1,
        todoId: todo.id,
        todoSeq: todo.seq,
        procedureId: todo.procedureId ?? null,
        status: 'needs_human',
        passed: false,
        reason,
        checks: [
          {
            id: 'run_needs_human',
            passed: false,
            evidence: input.evidence,
          },
        ],
        evidence: {
          terminalState: 'needs_human',
          riskLevel: 'medium',
          summaryDigest: digestText(reason),
        },
      };
      await repo.updateTaskRunTodo(
        todo.id,
        {
          status: 'needs_human',
          statusReason: reason,
          completionGateResult,
          completedAt,
          startedAt: todo.startedAt ? new Date(String(todo.startedAt)) : completedAt,
        },
        { notifyTaskId: input.taskId, notifyRunId: input.runId }
      );
      await repo.createRunEvent({
        version: 1,
        runId: input.runId,
        taskId: input.taskId,
        timestamp: completedAt.toISOString(),
        type: 'turn.finished',
        severity: 'warning',
        actor: 'system',
        message: `Todo #${todo.seq} needs attention because the run stopped: ${todo.title}`,
        data: {
          todoId: todo.id,
          todoSeq: todo.seq,
          todoTitle: todo.title,
          taskType: todo.taskType,
          procedureId: todo.procedureId ?? null,
          completionGateResult,
        },
      });
    })
  );
}

export async function closeOpenTodosForCancelledRun(input: {
  runId: string;
  taskId: string;
  todos: Array<{
    id: string;
    seq: number;
    title: string;
    taskType: string;
    status: string;
    procedureId?: string | null;
    startedAt?: unknown;
  }>;
  evidence?: string;
}) {
  const openTodos = listOpenTodos(input.todos);
  if (openTodos.length === 0) return;

  const completedAt = new Date();
  await Promise.all(
    openTodos.map(async (todo) => {
      const status = todo.status === 'running' ? 'failed' : 'skipped';
      const reason =
        status === 'failed'
          ? 'Run was cancelled while this Todo was active.'
          : 'Skipped because the run was cancelled before this Todo started.';
      const completionGateResult = {
        version: 1,
        todoId: todo.id,
        todoSeq: todo.seq,
        procedureId: todo.procedureId ?? null,
        status,
        passed: false,
        reason,
        checks: [
          {
            id: 'run_cancelled',
            passed: false,
            evidence: input.evidence || 'cancelled',
          },
        ],
        evidence: {
          terminalState: 'cancelled',
          stoppedBy: 'cancelled',
          riskLevel: 'medium',
          summaryDigest: digestText(reason),
        },
      };
      await repo.updateTaskRunTodo(
        todo.id,
        {
          status,
          statusReason: reason,
          completionGateResult,
          completedAt,
          startedAt: todo.startedAt ? new Date(String(todo.startedAt)) : completedAt,
        },
        { notifyTaskId: input.taskId, notifyRunId: input.runId }
      );
      await repo.createRunEvent({
        version: 1,
        runId: input.runId,
        taskId: input.taskId,
        timestamp: new Date().toISOString(),
        type: 'turn.finished',
        severity: status === 'failed' ? 'warning' : 'info',
        actor: 'system',
        message: `Todo #${todo.seq} ${status} because the run was cancelled: ${todo.title}`,
        data: {
          todoId: todo.id,
          todoSeq: todo.seq,
          todoTitle: todo.title,
          taskType: todo.taskType,
          procedureId: todo.procedureId ?? null,
          completionGateResult,
        },
      });
    })
  );
}

export async function closeOpenTodosForFailedRun(input: {
  runId: string;
  taskId: string;
  todos: Array<{
    id: string;
    seq: number;
    title: string;
    taskType: string;
    status: string;
    procedureId?: string | null;
    startedAt?: unknown;
  }>;
  evidence: string;
  terminalReason?: string | null;
  stoppedBy?: string | null;
}) {
  const openTodos = listOpenTodos(input.todos);
  if (openTodos.length === 0) return;

  const completedAt = new Date();
  await Promise.all(
    openTodos.map(async (todo) => {
      const status =
        todo.status === 'running' || isContextStillMcpGateTodo(todo) ? 'failed' : 'skipped';
      const reason =
        status === 'failed'
          ? todo.status === 'running'
            ? `Runtime failed while this Todo was active: ${input.evidence}`
            : `Runtime failed before this required contextStill MCP gate could run: ${input.evidence}`
          : `Skipped because the runtime failed before this Todo started: ${input.evidence}`;
      const statusReason = input.terminalReason || reason;
      const completionGateResult = {
        version: 1,
        todoId: todo.id,
        todoSeq: todo.seq,
        procedureId: todo.procedureId ?? null,
        status,
        passed: false,
        reason,
        checks: [
          {
            id: 'run_failed',
            passed: false,
            evidence: input.evidence,
          },
        ],
        evidence: {
          terminalState: 'failed',
          stoppedBy: input.stoppedBy || 'llm_error',
          terminalReason: input.terminalReason ?? null,
          riskLevel: 'high',
          summaryDigest: digestText(reason),
        },
      };
      await repo.updateTaskRunTodo(
        todo.id,
        {
          status,
          statusReason,
          completionGateResult,
          completedAt,
          startedAt: todo.startedAt ? new Date(String(todo.startedAt)) : completedAt,
        },
        { notifyTaskId: input.taskId, notifyRunId: input.runId }
      );
      await repo.createRunEvent({
        version: 1,
        runId: input.runId,
        taskId: input.taskId,
        timestamp: completedAt.toISOString(),
        type: 'turn.finished',
        severity: status === 'failed' ? 'error' : 'warning',
        actor: 'system',
        message: `Todo #${todo.seq} ${status} because the runtime failed: ${todo.title}`,
        data: {
          todoId: todo.id,
          todoSeq: todo.seq,
          todoTitle: todo.title,
          taskType: todo.taskType,
          procedureId: todo.procedureId ?? null,
          completionGateResult,
        },
      });
    })
  );
}

function isContextStillMcpGateTodo(todo: { procedureId?: string | null }) {
  return todo.procedureId?.startsWith('contextstill.') === true;
}

export function isPlanningOnlyRun<TTodo extends { taskType: string }>(todos: TTodo[]) {
  return todos.length === 0;
}

export function toAgentRuntimeTodoContext(
  todo: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>[number]
) {
  return {
    id: todo.id,
    seq: todo.seq,
    title: todo.title,
    description: todo.description,
    taskType: todo.taskType,
    status: todo.status,
    procedureId: todo.procedureId,
  };
}
