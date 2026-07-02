import * as repo from '../../../modules/nightworkers/nightworkers.repository';
import { type McpToolSummary, mcpClientManager } from '../../mcp/mcp-client-manager';
import {
  type CoverageAutonomyGateResult,
  type CoverageAutonomyState,
  evaluateCoverageAutonomyGate,
  formatCoverageAutonomyFinalReport,
} from '../../quality/coverage-autonomy-gate';
import type { ProviderToolCall } from '../../structured-llm/tool-calls';
import { executeWorkerTool } from '../../worker-tools/dispatcher';
import { type TodoListOperation, todoListTool } from '../../worker-tools/todo-list';
import type { AgentRunContext, AgentRuntimeSink } from '../types';
import { normalizeVerificationCommand, verificationCommandsMatch } from '../verification-command';
import { readNativeApiExecutionMode } from './native-api-mode';
import type { NativeApiToolResult } from './native-api-tool-history';
import {
  getNativeApiToolRegistration,
  isNativeApiToolAllowedForMode,
} from './native-api-tool-registry';
import {
  capNativeApiToolResultContent,
  projectWorkerResultToNativeApiToolResult,
} from './native-api-tool-result-projector';

export type NativeApiDispatchState = {
  readFiles: string[];
  specificationRead: boolean;
  specificationReadFromResumeFallback?: boolean;
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
  coverageAutonomy?: CoverageAutonomyState | null;
  lastCoverageAutonomyGate?: CoverageAutonomyGateResult | null;
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
      coverageAutonomyGate?: CoverageAutonomyGateResult | null;
      state: NativeApiDispatchState;
    };

export async function dispatchNativeApiToolCall(input: {
  toolCall: ProviderToolCall;
  context: AgentRunContext;
  sink: AgentRuntimeSink;
  state: NativeApiDispatchState;
}): Promise<NativeApiDispatchResult> {
  const executionMode = readNativeApiExecutionMode(input.context);
  const registration = getNativeApiToolRegistration(input.toolCall.name);
  if (!registration) {
    return continueWith(
      failedToolResult('UNKNOWN_TOOL', `Unknown tool: ${input.toolCall.name}`),
      input.state
    );
  }
  if (!isNativeApiToolAllowedForMode(input.toolCall.name, executionMode)) {
    return continueWith(
      failedToolResult(
        'TOOL_NOT_ALLOWED_FOR_MODE',
        `${input.toolCall.name} is not allowed in native/API ${executionMode} mode.`
      ),
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
    return dispatchContextStillTool(input);
  }

  if (registration.kind === 'mcp_catalog') {
    return continueWith(await dispatchMcpCatalog(), input.state);
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
  const result = projectWorkerResultToNativeApiToolResult(dispatch.result);
  await input.sink.emit({
    type: 'tool_call_finished',
    message: `[NativeApiRunner] ${workerToolName} ${dispatch.result.ok ? 'finished' : 'failed'}.`,
    payload: {
      callId: input.toolCall.id,
      toolName: workerToolName,
      arguments: input.toolCall.arguments,
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

  if (input.workerToolName === 'mcp_call_tool' && result.ok) {
    const args = toRecord(input.toolCall.arguments);
    nextStateFromContextStillToolResult(nextState, args?.toolName, result.ok);
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
      'todo_list operation must be one of todo_list operation=replace, todo_list operation=start, todo_list operation=done, todo_list operation=block, or todo_list operation=fail.'
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
    todoListReplaceReason:
      typeof input.toolCall.arguments.todoListReplaceReason === 'string'
        ? (input.toolCall.arguments.todoListReplaceReason as never)
        : undefined,
  });
  return projectWorkerResultToNativeApiToolResult(result);
}

async function dispatchMcpCatalog(): Promise<NativeApiToolResult> {
  try {
    const tools = await mcpClientManager.listAvailableTools();
    return capNativeApiToolResultContent({
      ok: true,
      content: JSON.stringify({ ok: true, tools }),
      payload: { tools },
    });
  } catch (error) {
    return failedToolResult(
      'MCP_TOOL_LIST_FAILED',
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function dispatchContextStillTool(input: {
  toolCall: ProviderToolCall;
  context: AgentRunContext;
  sink: AgentRuntimeSink;
  state: NativeApiDispatchState;
}): Promise<NativeApiDispatchResult> {
  const mcpToolName = contextStillMcpToolName(input.toolCall.name);
  if (!mcpToolName) {
    return continueWith(
      failedToolResult('TOOL_NOT_DISPATCHABLE', `${input.toolCall.name} is not dispatchable.`),
      input.state
    );
  }
  const validation = validateContextStillArguments(mcpToolName, input.toolCall.arguments);
  if (validation) {
    return continueWith(failedToolResult(validation.code, validation.message), input.state);
  }
  const prerequisite = validateContextStillPrerequisites(mcpToolName, input.state);
  if (prerequisite) {
    return continueWith(failedToolResult(prerequisite.code, prerequisite.message), input.state);
  }
  const tool = await resolveContextStillTool(mcpToolName);
  if (!tool) {
    return continueWith(
      failedToolResult('MCP_TOOL_UNAVAILABLE', `contextStill ${mcpToolName} is unavailable.`),
      input.state
    );
  }
  await input.sink.emit({
    type: 'tool_call_started',
    message: `[NativeApiRunner] context-still.${mcpToolName} started.`,
    payload: {
      callId: input.toolCall.id,
      toolName: `context-still.${mcpToolName}`,
      mcpTool: mcpToolName,
      mcpServer: tool.serverName,
      serverId: tool.serverId,
      arguments: input.toolCall.arguments,
    },
  });
  const result = await executeWorkerTool({
    toolName: 'mcp_call_tool',
    args: {
      serverId: tool.serverId,
      toolName: mcpToolName,
      arguments: input.toolCall.arguments,
    },
    repoRoot: input.context.repoRoot,
    taskId: input.context.taskId,
    safetyPolicy: input.context.safetyPolicy,
    readFiles: input.state.readFiles,
  });
  const toolResult = projectWorkerResultToNativeApiToolResult(result.result);
  await input.sink.emit({
    type: 'tool_call_finished',
    message: `[NativeApiRunner] context-still.${mcpToolName} ${
      toolResult.ok ? 'finished' : 'failed'
    }.`,
    payload: {
      callId: input.toolCall.id,
      toolName: `context-still.${mcpToolName}`,
      mcpTool: mcpToolName,
      mcpServer: tool.serverName,
      serverId: tool.serverId,
      arguments: input.toolCall.arguments,
      ok: toolResult.ok,
      status: toolResult.ok ? 'completed' : 'failed',
      result: result.result.payload,
      error: toolResult.error ?? result.result.error,
    },
  });
  const nextState: NativeApiDispatchState = { ...input.state };
  nextStateFromContextStillToolResult(nextState, mcpToolName, toolResult.ok);
  return continueWith(toolResult, nextState);
}

async function finalizeAnswer(input: {
  toolCall: ProviderToolCall;
  context: AgentRunContext;
  sink: AgentRuntimeSink;
  state: NativeApiDispatchState;
}): Promise<NativeApiDispatchResult> {
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
  const guard = validateFinalizeGuard(input.state);
  if (guard) {
    return continueWith(failedToolResult(guard.code, guard.message), input.state);
  }

  const openTodos = (await repo.listTaskRunTodosForRun(input.context.runId)).filter((todo) =>
    ['pending', 'running'].includes(todo.status)
  );
  if (openTodos.length > 0 && !openTodos.every(isFinalCompletionReportTodo)) {
    return continueWith(openTodosRemainToolResult(openTodos), input.state);
  }

  const coverageGate = await evaluateCoverageAutonomyGate({
    repoRoot: input.context.repoRoot,
    state: input.state.coverageAutonomy,
    safetyPolicy: input.context.safetyPolicy,
  });
  const stateWithCoverageGate: NativeApiDispatchState = {
    ...input.state,
    coverageAutonomy: coverageGate.nextState,
    lastCoverageAutonomyGate: coverageGate.result,
  };
  await input.sink.emit({
    type: 'verification_finished',
    message: `[NativeApiRunner] coverage autonomy gate ${coverageGate.result.status}.`,
    payload: coverageGate.result,
  });
  if (!coverageGate.result.allowFinalize) {
    return continueWith(
      failedToolResult(
        'COVERAGE_GATE_NOT_MET',
        [
          coverageGate.result.message,
          `attempt=${coverageGate.result.attempt}/${coverageGate.result.maxIterations}`,
          'Continue by adding or repairing focused unit tests. Do not change production logic only to satisfy tests.',
          coverageGate.result.coverage
            ? `failedMetrics=${coverageGate.result.coverage.failedMetrics.join(',')}`
            : null,
        ]
          .filter(Boolean)
          .join('\n'),
        coverageGate.result
      ),
      stateWithCoverageGate
    );
  }

  if (openTodos.length > 0) {
    const now = new Date();
    for (const todo of openTodos) {
      await repo.updateTaskRunTodo(
        todo.id,
        {
          status: 'passed',
          startedAt: todo.startedAt ? new Date(String(todo.startedAt)) : now,
          completedAt: now,
        },
        { notifyTaskId: input.context.taskId, notifyRunId: input.context.runId }
      );
    }

    const remainingOpenTodos = (await repo.listTaskRunTodosForRun(input.context.runId)).filter(
      (todo) => ['pending', 'running'].includes(todo.status)
    );
    if (remainingOpenTodos.length > 0) {
      return continueWith(openTodosRemainToolResult(remainingOpenTodos), stateWithCoverageGate);
    }
  }

  const coverageReport = formatCoverageAutonomyFinalReport(coverageGate.result);
  const finalReportWithCoverage =
    coverageGate.result.status === 'disabled' ? finalReport : `${finalReport}\n\n${coverageReport}`;
  const summary =
    typeof input.toolCall.arguments.summary === 'string' && input.toolCall.arguments.summary.trim()
      ? input.toolCall.arguments.summary.trim()
      : firstLine(finalReportWithCoverage);
  return {
    kind: 'final',
    finalReport: finalReportWithCoverage,
    summary,
    toolResult: {
      ok: true,
      content: JSON.stringify({ ok: true, summary, finalReport: finalReportWithCoverage }),
      payload: { summary, finalReport: finalReportWithCoverage, coverageGate: coverageGate.result },
    },
    coverageAutonomyGate: coverageGate.result,
    state: stateWithCoverageGate,
  };
}

function isFinalCompletionReportTodo(todo: {
  taskType?: string | null;
  procedureId?: string | null;
}) {
  return todo.taskType === 'completion_report' && todo.procedureId === 'final_completion_report';
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

function continueWith(
  toolResult: NativeApiToolResult,
  state: NativeApiDispatchState
): NativeApiDispatchResult {
  return { kind: 'continue', toolResult, state };
}

function failedToolResult(code: string, message: string, payload?: unknown): NativeApiToolResult {
  return capNativeApiToolResultContent({
    ok: false,
    content: JSON.stringify({ ok: false, error: { code, message }, payload }),
    ...(payload !== undefined ? { payload } : {}),
    error: { code, message },
  });
}

function openTodosRemainToolResult(
  openTodos: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>
): NativeApiToolResult {
  const openTodoSummaries = [...openTodos]
    .sort((a, b) => a.seq - b.seq)
    .map((todo) => ({
      seq: todo.seq,
      title: todo.title,
      status: todo.status,
      taskType: todo.taskType,
      procedureId: todo.procedureId ?? null,
    }));
  const running = openTodoSummaries.find((todo) => todo.status === 'running');
  const pending = openTodoSummaries.find((todo) => todo.status === 'pending');
  const nextAction = running
    ? {
        operation: 'done',
        seq: running.seq,
        example: `todo_list operation=done seq=${running.seq}`,
        alternatives: ['block', 'fail'],
      }
    : pending
      ? {
          operation: 'start',
          seq: pending.seq,
          example: `todo_list operation=start seq=${pending.seq}`,
          alternatives: ['block', 'fail'],
        }
      : null;
  const message = [
    `finalize_answer is blocked because open Todos remain: ${openTodoSummaries
      .map((todo) => todo.seq)
      .join(', ')}`,
    nextAction
      ? `Next Todo action hint: call ${nextAction.example}. Use block/fail instead if the Todo cannot be completed.`
      : 'Use todo_list done/block/fail to close the remaining open Todos before finalize_answer.',
  ].join(' ');
  return capNativeApiToolResultContent({
    ok: false,
    content: JSON.stringify({
      ok: false,
      error: { code: 'OPEN_TODOS_REMAIN', message },
      openTodos: openTodoSummaries,
      nextAction,
    }),
    payload: {
      openTodos: openTodoSummaries,
      nextAction,
    },
    error: {
      code: 'OPEN_TODOS_REMAIN',
      message,
      details: {
        openTodos: openTodoSummaries,
        nextAction,
      },
    },
  });
}

function successfulNewContextWindow(): NativeApiToolResult {
  const message = 'A new context window will start without summarizing conversation history.';
  return capNativeApiToolResultContent({
    ok: true,
    content: message,
    payload: {
      newContextWindowRequested: true,
      message,
    },
  });
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

function contextStillMcpToolName(
  toolName: string
):
  | 'initial_instructions'
  | 'context_compile'
  | 'context_decision'
  | 'compile_eval'
  | 'register_candidates'
  | null {
  if (toolName === 'context_initial_instructions') return 'initial_instructions';
  if (toolName === 'context_compile') return 'context_compile';
  if (toolName === 'context_decision') return 'context_decision';
  if (toolName === 'compile_eval') return 'compile_eval';
  if (toolName === 'register_candidates') return 'register_candidates';
  return null;
}

function validateContextStillArguments(
  toolName:
    | 'initial_instructions'
    | 'context_compile'
    | 'context_decision'
    | 'compile_eval'
    | 'register_candidates',
  args: Record<string, unknown>
): { code: string; message: string } | null {
  if (toolName === 'context_compile') {
    const goal = args.goal;
    if (typeof goal !== 'string' || goal.trim().length === 0) {
      return { code: 'INVALID_TOOL_ARGS', message: 'context_compile requires a non-empty goal.' };
    }
  }
  if (toolName === 'context_decision') {
    const decisionPoint = args.decisionPoint;
    if (typeof decisionPoint !== 'string' || decisionPoint.trim().length === 0) {
      return {
        code: 'INVALID_TOOL_ARGS',
        message: 'context_decision requires a non-empty decisionPoint.',
      };
    }
  }
  if (toolName === 'compile_eval') {
    const body = args.body;
    if (typeof body !== 'string' || body.trim().length === 0) {
      return { code: 'INVALID_TOOL_ARGS', message: 'compile_eval requires a non-empty body.' };
    }
    const outcome = args.outcome;
    if (
      outcome !== 'useful' &&
      outcome !== 'partial' &&
      outcome !== 'misleading' &&
      outcome !== 'unused'
    ) {
      return { code: 'INVALID_TOOL_ARGS', message: 'compile_eval requires a valid outcome.' };
    }
    for (const key of [
      'actionability',
      'clarity',
      'coverage',
      'relevance',
      'specificity',
    ] as const) {
      if (!Number.isInteger(args[key])) {
        return { code: 'INVALID_TOOL_ARGS', message: `compile_eval requires integer ${key}.` };
      }
    }
  }
  if (toolName === 'register_candidates' && !Array.isArray(args.items)) {
    return { code: 'INVALID_TOOL_ARGS', message: 'register_candidates requires items array.' };
  }
  return null;
}

function validateContextStillPrerequisites(
  toolName:
    | 'initial_instructions'
    | 'context_compile'
    | 'context_decision'
    | 'compile_eval'
    | 'register_candidates',
  state: NativeApiDispatchState
): { code: string; message: string } | null {
  if (
    (toolName === 'initial_instructions' || toolName === 'context_compile') &&
    !state.specificationRead
  ) {
    return {
      code: 'SPECIFICATION_REQUIRED',
      message:
        'read_current_specification must succeed before contextStill initial_instructions or context_compile so the compiled context is grounded in the current task specification.',
    };
  }
  return null;
}

function nextStateFromContextStillToolResult(
  state: NativeApiDispatchState,
  toolName: unknown,
  ok: boolean
) {
  if (!ok) return;
  if (toolName === 'initial_instructions') state.initialInstructionsCompleted = true;
  if (toolName === 'context_compile') state.contextCompiled = true;
  if (toolName === 'compile_eval') state.compileEvalCompleted = true;
}

async function resolveContextStillTool(
  toolName:
    | 'initial_instructions'
    | 'context_compile'
    | 'context_decision'
    | 'compile_eval'
    | 'register_candidates'
) {
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
