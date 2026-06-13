import { logEvent } from '../../lib/logger';
import * as repo from '../../modules/nightworkers/nightworkers.repository';
import { classifyCodexCommand } from './codex-event-mapper';
import type { AgentRuntimeEvent, AgentRuntimeSink, CodexContractWarningSeverity } from './types';

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
  runtime_warning: { actor: 'system', severity: 'warning', canonicalType: 'system.warning' },
  runtime_error: { actor: 'system', severity: 'error', canonicalType: 'system.error' },
};

const AUTO_CLOSE_PROCEDURE_BY_TOOL_NAME: Record<string, string> = {
  'context-still.initial_instructions': 'contextstill.initial_instructions',
  'context-still.context_compile': 'contextstill.context_compile',
  'context-still.register_candidates': 'contextstill.register_candidates',
};

const QUALITY_GATE_VERIFY_PROCEDURE_ID = 'quality_gate_verify';
const KNOWLEDGE_REGISTRATION_PROCEDURE_ID = 'contextstill.register_candidates';
const FINAL_COMPLETION_REPORT_PROCEDURE_ID = 'final_completion_report';

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
          severity: resolveEventSeverity(event, mapped),
          actor: mapped.actor,
          message: event.message.slice(0, 1000),
          data: (event.payload as Record<string, unknown>) || {},
        });
        await maybeAutoCloseGateTodo(taskRunId, event);
        await maybeAutoCloseCompletionReportTodo(taskRunId, event);
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

function resolveEventSeverity(event: AgentRuntimeEvent, mapped: EventMapping) {
  if (event.type !== 'runtime_warning') return mapped.severity;
  const severity = event.payload?.severity;
  if (isContractWarningSeverity(severity)) return severity;
  return mapped.severity;
}

function isContractWarningSeverity(value: unknown): value is CodexContractWarningSeverity {
  return value === 'info' || value === 'warning' || value === 'error';
}

async function maybeAutoCloseGateTodo(taskRunId: string, event: AgentRuntimeEvent) {
  if (event.type !== 'tool_call_finished') return;
  const payload =
    event.payload && typeof event.payload === 'object'
      ? (event.payload as Record<string, unknown>)
      : null;
  if (!payload || isFailedToolCompletion(payload)) return;
  const procedureId = resolveAutoCloseProcedureId(payload);
  if (!procedureId) return;

  const [run, todos] = await Promise.all([
    repo.getTaskRun(taskRunId),
    repo.listTaskRunTodosForRun(taskRunId),
  ]);
  if (!run) return;
  const currentTodo =
    procedureId === KNOWLEDGE_REGISTRATION_PROCEDURE_ID
      ? todos.find(
          (todo) => ['pending', 'running'].includes(todo.status) && todo.procedureId === procedureId
        )
      : todos.find((todo) => todo.status === 'running' && todo.procedureId === procedureId);
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

  if (procedureId !== KNOWLEDGE_REGISTRATION_PROCEDURE_ID) {
    await autoAdvanceNextTodo(taskRunId, run, currentTodo.seq, now);
  }
}

async function maybeAutoCloseCompletionReportTodo(taskRunId: string, event: AgentRuntimeEvent) {
  if (event.type !== 'model_response_finished') return;
  const payload =
    event.payload && typeof event.payload === 'object'
      ? (event.payload as Record<string, unknown>)
      : null;
  if (!payload || typeof payload.text !== 'string' || payload.text.trim().length === 0) return;

  const [run, todos] = await Promise.all([
    repo.getTaskRun(taskRunId),
    repo.listTaskRunTodosForRun(taskRunId),
  ]);
  if (!run) return;
  const completionTodo = todos.find(
    (todo) =>
      ['pending', 'running'].includes(todo.status) &&
      todo.procedureId === FINAL_COMPLETION_REPORT_PROCEDURE_ID
  );
  if (!completionTodo) return;
  const earlierOpenTodo = todos.find(
    (todo) =>
      todo.seq < completionTodo.seq &&
      ['pending', 'running'].includes(todo.status) &&
      todo.id !== completionTodo.id
  );
  if (earlierOpenTodo) return;

  const now = new Date();
  await repo.updateTaskRunTodo(
    completionTodo.id,
    {
      status: 'passed',
      completedAt: now,
      startedAt: completionTodo.startedAt ? new Date(String(completionTodo.startedAt)) : now,
    },
    { notifyTaskId: run.taskId, notifyRunId: run.id }
  );
}

async function autoAdvanceNextTodo(
  taskRunId: string,
  run: { id: string; taskId: string },
  afterSeq: number,
  now: Date
) {
  const refreshedTodos = await repo.listTaskRunTodosForRun(taskRunId);
  const nextTodo = refreshedTodos
    .filter((todo) => todo.status === 'pending' && todo.seq > afterSeq)
    .sort((a, b) => a.seq - b.seq)[0];
  if (!nextTodo) return;
  if (isFinalCloseoutTodo(nextTodo)) return;

  await repo.startTaskRunTodoIfStillPendingAndNoEarlierOpen(
    {
      id: nextTodo.id,
      runId: taskRunId,
      afterSeq,
      startedAt: now,
    },
    { notifyTaskId: run.taskId, notifyRunId: run.id }
  );
}

function resolveAutoCloseProcedureId(payload: Record<string, unknown>) {
  const toolName = resolveToolName(payload);
  if (toolName && AUTO_CLOSE_PROCEDURE_BY_TOOL_NAME[toolName]) {
    return AUTO_CLOSE_PROCEDURE_BY_TOOL_NAME[toolName];
  }
  if (isSuccessfulBroadVerificationCommand(payload, toolName)) {
    return QUALITY_GATE_VERIFY_PROCEDURE_ID;
  }
  return null;
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
  return (
    payload.status === 'failed' || payload.status === 'error' || payload.status === 'cancelled'
  );
}

function isSuccessfulBroadVerificationCommand(
  payload: Record<string, unknown>,
  toolName: string | null
) {
  if (toolName !== 'command_execution' && toolName !== 'nightworkers.run_verification') {
    return false;
  }
  if (typeof payload.exitCode === 'number' && payload.exitCode !== 0) return false;
  if (typeof payload.exit_code === 'number' && payload.exit_code !== 0) return false;

  const command =
    typeof payload.command === 'string'
      ? payload.command
      : typeof payload.name === 'string'
        ? payload.name
        : '';
  if (!command) return false;
  return classifyCodexCommand(command) === 'broad_verification';
}

function isFinalCloseoutTodo(todo: { taskType?: string | null; procedureId?: string | null }) {
  return (
    todo.procedureId === KNOWLEDGE_REGISTRATION_PROCEDURE_ID ||
    todo.procedureId === FINAL_COMPLETION_REPORT_PROCEDURE_ID ||
    todo.taskType === 'knowledge_capture' ||
    todo.taskType === 'completion_report'
  );
}
