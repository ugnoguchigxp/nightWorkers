import * as repo from '../../../modules/nightworkers/nightworkers.repository';
import { type McpToolSummary, mcpClientManager } from '../../mcp/mcp-client-manager';
import type { ProviderToolCall } from '../../structured-llm/tool-calls';
import { executeWorkerTool } from '../../worker-tools/dispatcher';
import { type TodoListOperation, todoListTool } from '../../worker-tools/todo-list';
import type { WorkerToolResult } from '../../worker-tools/types';
import type { AgentRunContext, AgentRuntimeSink } from '../types';
import type { NativeApiToolResult } from './native-api-tool-history';
import { getNativeApiToolRegistration } from './native-api-tool-registry';

export type NativeApiDispatchState = {
  readFiles: string[];
  specificationRead: boolean;
};

export type NativeApiDispatchResult =
  | {
      kind: 'continue';
      toolResult: NativeApiToolResult;
      state: NativeApiDispatchState;
    }
  | {
      kind: 'final';
      toolResult: NativeApiToolResult;
      finalReport: string;
      summary: string;
      state: NativeApiDispatchState;
    };

export async function dispatchNativeApiToolCall(input: {
  toolCall: ProviderToolCall;
  context: AgentRunContext;
  sink: AgentRuntimeSink;
  state: NativeApiDispatchState;
}): Promise<NativeApiDispatchResult> {
  const registration = getNativeApiToolRegistration(input.toolCall.name);
  if (!registration) {
    return continueWith(
      failedToolResult('UNKNOWN_TOOL', `Unknown tool: ${input.toolCall.name}`),
      input.state
    );
  }

  if (registration.kind === 'terminal') {
    return finalizeAnswer(input);
  }

  if (registration.kind === 'todo_control') {
    return continueWith(await dispatchTodoTool(input), input.state);
  }

  if (registration.kind === 'context_still') {
    return continueWith(await dispatchContextCompile(input), input.state);
  }

  const workerToolName = registration.workerToolName;
  if (!workerToolName) {
    return continueWith(
      failedToolResult('TOOL_NOT_DISPATCHABLE', `${input.toolCall.name} is not dispatchable.`),
      input.state
    );
  }

  await input.sink.emit({
    type: 'tool_call_started',
    message: `[NativeApiRunner] ${workerToolName} started.`,
    payload: {
      callId: input.toolCall.id,
      toolName: workerToolName,
      arguments: input.toolCall.arguments,
    },
  });
  const dispatch = await executeWorkerTool({
    toolName: workerToolName,
    args: input.toolCall.arguments,
    repoRoot: input.context.repoRoot,
    taskId: input.context.taskId,
    safetyPolicy: input.context.safetyPolicy,
    readFiles: input.state.readFiles,
  });
  const result = projectWorkerResult(dispatch.result);
  await input.sink.emit({
    type: 'tool_call_finished',
    message: `[NativeApiRunner] ${workerToolName} ${dispatch.result.ok ? 'finished' : 'failed'}.`,
    payload: {
      callId: input.toolCall.id,
      toolName: workerToolName,
      ok: dispatch.result.ok,
      result: dispatch.result.payload,
      error: dispatch.result.error,
    },
  });
  const nextState = {
    ...input.state,
    readFiles: dispatch.readFilesChanged ?? input.state.readFiles,
    specificationRead:
      input.state.specificationRead ||
      (workerToolName === 'read_current_specification' && dispatch.result.ok),
  };
  return continueWith(result, nextState);
}

async function dispatchTodoTool(input: {
  toolCall: ProviderToolCall;
  context: AgentRunContext;
  sink: AgentRuntimeSink;
  state: NativeApiDispatchState;
}) {
  const operation = input.toolCall.arguments.operation;
  if (!isTodoMutationOperation(operation)) {
    return failedToolResult(
      'INVALID_TOOL_ARGS',
      'todo_list operation must be one of replace/start/done/block/fail.'
    );
  }
  const result = await todoListTool({
    runId: input.context.runId,
    operation,
    seq:
      typeof input.toolCall.arguments.seq === 'number' ? input.toolCall.arguments.seq : undefined,
    todos: Array.isArray(input.toolCall.arguments.todos)
      ? (input.toolCall.arguments.todos as never)
      : undefined,
    startFirst:
      typeof input.toolCall.arguments.startFirst === 'boolean'
        ? input.toolCall.arguments.startFirst
        : undefined,
  });
  return projectWorkerResult(result);
}

async function dispatchContextCompile(input: {
  toolCall: ProviderToolCall;
  context: AgentRunContext;
  sink: AgentRuntimeSink;
  state: NativeApiDispatchState;
}) {
  const goal = input.toolCall.arguments.goal;
  if (typeof goal !== 'string' || goal.trim().length === 0) {
    return failedToolResult('INVALID_TOOL_ARGS', 'context_compile requires a non-empty goal.');
  }
  if (!input.state.specificationRead) {
    return failedToolResult(
      'SPECIFICATION_REQUIRED',
      'context_compile is blocked until read_current_specification has succeeded.'
    );
  }
  const tool = await resolveContextStillTool('context_compile');
  if (!tool) {
    return failedToolResult('MCP_TOOL_UNAVAILABLE', 'contextStill context_compile is unavailable.');
  }
  const result = await executeWorkerTool({
    toolName: 'mcp_call_tool',
    args: {
      serverId: tool.serverId,
      toolName: 'context_compile',
      arguments: input.toolCall.arguments,
    },
    repoRoot: input.context.repoRoot,
    taskId: input.context.taskId,
    safetyPolicy: input.context.safetyPolicy,
    readFiles: input.state.readFiles,
  });
  return projectWorkerResult(result.result);
}

async function finalizeAnswer(input: {
  toolCall: ProviderToolCall;
  context: AgentRunContext;
  sink: AgentRuntimeSink;
  state: NativeApiDispatchState;
}): Promise<NativeApiDispatchResult> {
  const openTodos = (await repo.listTaskRunTodosForRun(input.context.runId)).filter((todo) =>
    ['pending', 'running'].includes(todo.status)
  );
  if (openTodos.length > 0) {
    return continueWith(
      failedToolResult(
        'OPEN_TODOS_REMAIN',
        `finalize_answer is blocked because open Todos remain: ${openTodos.map((todo) => todo.seq).join(', ')}`
      ),
      input.state
    );
  }
  const finalReport =
    typeof input.toolCall.arguments.finalReport === 'string'
      ? input.toolCall.arguments.finalReport.trim()
      : '';
  if (!finalReport) {
    return continueWith(
      failedToolResult('INVALID_TOOL_ARGS', 'finalize_answer requires finalReport.'),
      input.state
    );
  }
  const summary =
    typeof input.toolCall.arguments.summary === 'string' && input.toolCall.arguments.summary.trim()
      ? input.toolCall.arguments.summary.trim()
      : firstLine(finalReport);
  return {
    kind: 'final',
    finalReport,
    summary,
    toolResult: {
      ok: true,
      content: JSON.stringify({ ok: true, summary, finalReport }),
      payload: { summary, finalReport },
    },
    state: input.state,
  };
}

function projectWorkerResult(result: WorkerToolResult<unknown>): NativeApiToolResult {
  return {
    ok: result.ok,
    content: JSON.stringify({
      ok: result.ok,
      toolName: result.toolName,
      payload: result.payload,
      error: result.error,
    }),
    payload: result.payload,
    ...(result.error
      ? {
          error: {
            code: result.error.code,
            message: result.error.message,
          },
        }
      : {}),
  };
}

function continueWith(
  toolResult: NativeApiToolResult,
  state: NativeApiDispatchState
): NativeApiDispatchResult {
  return { kind: 'continue', toolResult, state };
}

function failedToolResult(code: string, message: string): NativeApiToolResult {
  return {
    ok: false,
    content: JSON.stringify({ ok: false, error: { code, message } }),
    error: { code, message },
  };
}

function isTodoMutationOperation(value: unknown): value is Exclude<TodoListOperation, 'list'> {
  return (
    value === 'replace' ||
    value === 'start' ||
    value === 'done' ||
    value === 'block' ||
    value === 'fail'
  );
}

async function resolveContextStillTool(toolName: 'context_compile') {
  const tools = await mcpClientManager.listAvailableTools();
  return (
    tools.find((tool) => tool.name === toolName && isContextStillTool(tool)) ??
    tools.find((tool) => tool.name === toolName) ??
    null
  );
}

function isContextStillTool(tool: McpToolSummary) {
  const serverName = tool.serverName.toLowerCase();
  const prefix = tool.toolPrefix.toLowerCase();
  return (
    serverName === 'context-still' ||
    serverName === 'contextstill' ||
    prefix === 'context_still' ||
    prefix === 'contextstill'
  );
}

function firstLine(value: string) {
  return (
    value
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() || value.trim()
  );
}
