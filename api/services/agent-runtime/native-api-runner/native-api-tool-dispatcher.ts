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
  initialInstructionsCompleted?: boolean;
  contextCompiled?: boolean;
  todoAligned?: boolean;
  startupCompleted?: boolean;
  newContextWindowRequested?: boolean;
  postImport?: NativeApiPostImportState | null;
  importProjectSucceeded?: boolean;
  importProjectFailed?: boolean;
  copyDirectorySucceeded?: boolean;
  manifestReadAfterImport?: boolean;
  successfulVerificationCommands?: string[];
  compileEvalCompleted?: boolean;
};

export type NativeApiPostImportState = {
  toolCallId: string;
  mode: 'template' | 'git';
  templateId?: string | null;
  variant?: string | null;
  manifest?: unknown;
  llmContext?: unknown;
  recommendedVerificationCommands: string[];
  verifiedCommand?: string | null;
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

  if (registration.kind === 'context_window') {
    return continueWith(successfulNewContextWindow(), {
      ...input.state,
      newContextWindowRequested: true,
    });
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
  const nextState = updateDispatchStateAfterWorkerTool({
    state: input.state,
    toolCall: input.toolCall,
    workerToolName,
    dispatch,
  });
  return continueWith(result, nextState);
}

function updateDispatchStateAfterWorkerTool(input: {
  state: NativeApiDispatchState;
  toolCall: ProviderToolCall;
  workerToolName: string;
  dispatch: Awaited<ReturnType<typeof executeWorkerTool>>;
}): NativeApiDispatchState {
  const result = input.dispatch.result;
  const nextState: NativeApiDispatchState = {
    ...input.state,
    readFiles: input.dispatch.readFilesChanged ?? input.state.readFiles,
    specificationRead:
      input.state.specificationRead ||
      (input.workerToolName === 'read_current_specification' && result.ok),
  };

  if (input.workerToolName === 'read_file' && input.state.postImport) {
    const filePath =
      typeof input.toolCall.arguments.filePath === 'string'
        ? input.toolCall.arguments.filePath
        : '';
    if (isProjectManifestPath(filePath)) {
      nextState.manifestReadAfterImport = true;
    }
  }

  if (input.workerToolName === 'import_project' && result.ok) {
    const payload = toRecord(result.payload);
    const postImport = toRecord(payload?.postImport);
    const manifest = postImport?.manifest;
    const mode = payload?.mode === 'git' ? 'git' : 'template';
    nextState.importProjectSucceeded = true;
    nextState.importProjectFailed = false;
    nextState.successfulVerificationCommands = [];
    nextState.postImport = {
      toolCallId: input.toolCall.id,
      mode,
      templateId:
        typeof input.toolCall.arguments.templateId === 'string'
          ? input.toolCall.arguments.templateId
          : typeof input.toolCall.arguments.stack === 'string'
            ? input.toolCall.arguments.stack
            : null,
      variant:
        typeof input.toolCall.arguments.variant === 'string'
          ? input.toolCall.arguments.variant
          : null,
      manifest,
      llmContext: postImport?.llmContext,
      recommendedVerificationCommands: readRecommendedVerificationCommands(manifest),
      verifiedCommand: null,
    };
    nextState.manifestReadAfterImport = Boolean(manifest);
  }

  if (input.workerToolName === 'import_project' && !result.ok) {
    nextState.importProjectFailed = true;
  }

  if (input.workerToolName === 'copy_directory' && result.ok) {
    nextState.copyDirectorySucceeded = true;
  }

  if (input.workerToolName === 'run_verification' && result.ok) {
    const command =
      typeof input.toolCall.arguments.command === 'string'
        ? input.toolCall.arguments.command
        : null;
    const normalizedCommand = normalizeVerificationCommand(command);
    nextState.successfulVerificationCommands = [
      ...(input.state.successfulVerificationCommands ?? []),
      ...(normalizedCommand ? [normalizedCommand] : []),
    ];
    if (nextState.postImport && normalizedCommand) {
      const recommendedCommands = nextState.postImport.recommendedVerificationCommands
        .map((item) => normalizeVerificationCommand(item))
        .filter((item): item is string => item !== null);
      if (
        recommendedCommands.length === 0 ||
        recommendedCommands.some((recommended) =>
          verificationCommandsMatch(normalizedCommand, recommended)
        )
      ) {
        nextState.postImport = {
          ...nextState.postImport,
          verifiedCommand: normalizedCommand,
        };
      }
    }
  }

  return nextState;
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
  const guard = validateFinalizeGuard(input.state);
  if (guard) {
    return continueWith(failedToolResult(guard.code, guard.message), input.state);
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

function validateFinalizeGuard(
  state: NativeApiDispatchState
): { code: string; message: string } | null {
  if (state.importProjectFailed && !state.importProjectSucceeded) {
    return {
      code: 'POST_IMPORT_FAILED',
      message:
        'finalize_answer is blocked because import_project failed. Do not use fallback project import or static implementation paths.',
    };
  }
  const importedProject = state.importProjectSucceeded || state.copyDirectorySucceeded;
  if (!importedProject) return null;
  if (!state.manifestReadAfterImport && !state.postImport?.manifest) {
    return {
      code: 'POST_IMPORT_MANIFEST_REQUIRED',
      message:
        'finalize_answer is blocked after project import until package.json or pyproject.toml is read, or postImport.manifest exists.',
    };
  }
  const recommendedCommands = state.postImport?.recommendedVerificationCommands ?? [];
  if (recommendedCommands.length === 0) return null;
  if (state.postImport?.verifiedCommand) return null;
  const successfulCommands = state.successfulVerificationCommands ?? [];
  if (successfulCommands.length > 0) {
    return {
      code: 'POST_IMPORT_RECOMMENDED_VERIFICATION_MISMATCH',
      message:
        'finalize_answer is blocked because successful post-import verification did not match any recommended verification command.',
    };
  }
  return {
    code: 'POST_IMPORT_VERIFICATION_REQUIRED',
    message:
      'finalize_answer is blocked until at least one recommended post-import verification command succeeds.',
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

function successfulNewContextWindow(): NativeApiToolResult {
  const message = 'A new context window will start without summarizing conversation history.';
  return {
    ok: true,
    content: message,
    payload: {
      newContextWindowRequested: true,
      message,
    },
  };
}

function readRecommendedVerificationCommands(manifest: unknown): string[] {
  const record = toRecord(manifest);
  const commands = Array.isArray(record?.recommendedVerificationCommands)
    ? record.recommendedVerificationCommands
    : [];
  return commands.filter(
    (command): command is string => typeof command === 'string' && command.trim().length > 0
  );
}

function isProjectManifestPath(filePath: string) {
  return /(^|\/)(package\.json|pyproject\.toml)$/.test(filePath.trim());
}

function normalizeVerificationCommand(command: string | null): string | null {
  if (!command) return null;
  const normalized = command.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : null;
}

function verificationCommandsMatch(actual: string | null, recommended: string | null): boolean {
  if (!actual || !recommended) return false;
  if (actual === recommended) return true;
  return verificationCommandEquivalentKey(actual) === verificationCommandEquivalentKey(recommended);
}

function verificationCommandEquivalentKey(command: string): string {
  const parts = command.split(' ');
  const runner = parts[0];
  if (
    (runner === 'bun' || runner === 'pnpm' || runner === 'yarn') &&
    parts[1] === 'run' &&
    parts[2]
  ) {
    return [runner, ...parts.slice(2)].join(' ');
  }
  return command;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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
