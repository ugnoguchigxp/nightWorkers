import { logEvent } from '../../lib/logger';
import * as repo from '../../modules/nightworkers/nightworkers.repository';
import type { AgentRuntimeEvent, AgentRuntimeSink } from './types';

type EventMapping = {
  actor: 'runtime' | 'supervisor' | 'worker' | 'system';
  severity: 'debug' | 'info' | 'warning' | 'error' | 'checkpoint';
  canonicalType: import('../run-events/types').RunEventType;
};

const EVENT_MAPPING: Record<AgentRuntimeEvent['type'], EventMapping> = {
  runtime_started: { actor: 'runtime', severity: 'info', canonicalType: 'run.runtime_started' },
  turn_started: { actor: 'supervisor', severity: 'info', canonicalType: 'turn.started' },
  model_response_started: {
    actor: 'supervisor',
    severity: 'info',
    canonicalType: 'model.request_started',
  },
  model_response_delta: {
    actor: 'supervisor',
    severity: 'debug',
    canonicalType: 'model.response_delta',
  },
  model_response_finished: {
    actor: 'supervisor',
    severity: 'info',
    canonicalType: 'model.response_finished',
  },
  model_response_parse_failed: {
    actor: 'supervisor',
    severity: 'error',
    canonicalType: 'model.response_parse_failed',
  },
  model_response_repaired: {
    actor: 'supervisor',
    severity: 'warning',
    canonicalType: 'model.response_repaired',
  },
  model_retry_scheduled: {
    actor: 'supervisor',
    severity: 'warning',
    canonicalType: 'model.retry_scheduled',
  },
  model_retry_started: {
    actor: 'supervisor',
    severity: 'info',
    canonicalType: 'model.retry_started',
  },
  supervisor_decision: {
    actor: 'supervisor',
    severity: 'info',
    canonicalType: 'supervisor.decision',
  },
  tool_call_started: { actor: 'worker', severity: 'info', canonicalType: 'tool.call_started' },
  tool_call_progress: { actor: 'worker', severity: 'info', canonicalType: 'tool.call_progress' },
  tool_call_finished: { actor: 'worker', severity: 'info', canonicalType: 'tool.call_finished' },
  verification_started: {
    actor: 'supervisor',
    severity: 'checkpoint',
    canonicalType: 'verification.started',
  },
  verification_finished: {
    actor: 'supervisor',
    severity: 'checkpoint',
    canonicalType: 'verification.finished',
  },
  diff_collected: { actor: 'worker', severity: 'checkpoint', canonicalType: 'git.diff_collected' },
  runtime_finished: {
    actor: 'runtime',
    severity: 'checkpoint',
    canonicalType: 'run.runtime_finished',
  },
  runtime_error: { actor: 'system', severity: 'error', canonicalType: 'system.error' },
};

const AUTO_CLOSE_PROCEDURE_BY_TOOL_NAME: Record<string, string> = {
  'context-still.initial_instructions': 'contextstill.initial_instructions',
  'context-still.context_compile': 'contextstill.context_compile',
};

export function createLedgerSink(taskRunId: string): AgentRuntimeSink {
  return {
    async emit(event: AgentRuntimeEvent) {
      const mapped = EVENT_MAPPING[event.type];
      try {
        await repo.createRunEvent({
          version: 1,
          runId: taskRunId,
          timestamp: new Date().toISOString(),
          type: mapped.canonicalType,
          severity: mapped.severity,
          actor: mapped.actor,
          message: event.message.slice(0, 1000),
          data: (event.payload as Record<string, unknown>) || {},
        });
        await maybeAutoCloseGateTodo(taskRunId, event);
      } catch (error) {
        logEvent({
          channel: 'agent-runtime',
          level: 'error',
          message: 'failed to persist runtime ledger event',
          meta: {
            runId: taskRunId,
            eventType: event.type,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
        });
      }
    },
  };
}

async function maybeAutoCloseGateTodo(taskRunId: string, event: AgentRuntimeEvent) {
  if (event.type !== 'tool_call_finished') return;
  const payload =
    event.payload && typeof event.payload === 'object'
      ? (event.payload as Record<string, unknown>)
      : null;
  if (!payload || isFailedToolCompletion(payload)) return;
  const toolName = resolveToolName(payload);
  if (!toolName) return;
  const procedureId = AUTO_CLOSE_PROCEDURE_BY_TOOL_NAME[toolName];
  if (!procedureId) return;

  const [run, todos] = await Promise.all([
    repo.getTaskRun(taskRunId),
    repo.listTaskRunTodosForRun(taskRunId),
  ]);
  if (!run) return;
  const currentTodo = todos.find(
    (todo) => todo.status === 'running' && todo.procedureId === procedureId
  );
  if (!currentTodo) return;

  const now = new Date();
  await repo.updateTaskRunTodo(
    currentTodo.id,
    {
      status: 'passed',
      completedAt: now,
      startedAt: currentTodo.startedAt ? new Date(String(currentTodo.startedAt)) : now,
    },
    { notifyTaskId: run.taskId, notifyRunId: run.id }
  );

  const refreshedTodos = await repo.listTaskRunTodosForRun(taskRunId);
  const nextTodo = refreshedTodos.find((todo) => todo.status === 'pending');
  if (!nextTodo) return;
  await repo.updateTaskRunTodo(
    nextTodo.id,
    {
      status: 'running',
      startedAt: now,
      completedAt: null,
    },
    { notifyTaskId: run.taskId, notifyRunId: run.id }
  );
}

function resolveToolName(payload: Record<string, unknown>) {
  if (typeof payload.toolName === 'string' && payload.toolName.length > 0) {
    return payload.toolName;
  }
  if (typeof payload.mcpServer === 'string' && typeof payload.mcpTool === 'string') {
    return `${payload.mcpServer}.${payload.mcpTool}`;
  }
  return null;
}

function isFailedToolCompletion(payload: Record<string, unknown>) {
  return payload.status === 'failed' || payload.status === 'error';
}
