import * as repo from '../../../modules/nightworkers/nightworkers.repository';
import { type McpToolSummary, mcpClientManager } from '../../mcp/mcp-client-manager';
import { executeWorkerTool } from '../../worker-tools/dispatcher';
import { type TodoActionPayload, todoListTool } from '../../worker-tools/todo-list';
import type { WorkerToolResult } from '../../worker-tools/types';
import type { AgentRunContext, AgentRuntimeResult, AgentRuntimeSink } from '../types';
import { readNativeApiExecutionMode } from './native-api-mode';
import type { NativeApiSessionStore } from './native-api-session-store';
import type { NativeApiDispatchState } from './native-api-tool-dispatcher';
import type { NativeApiHistoryItem, NativeApiToolResult } from './native-api-tool-history';

type StartupPhase =
  | 'startup_specification'
  | 'startup_initial_instructions'
  | 'startup_context_compile'
  | 'startup_todo_alignment';

type StartupGateResult = {
  historyItem: NativeApiHistoryItem;
  toolResult: NativeApiToolResult;
};

export type NativeApiStartupResult =
  | {
      ok: true;
      history: NativeApiHistoryItem[];
      state: NativeApiDispatchState;
    }
  | {
      ok: false;
      result: AgentRuntimeResult;
      history: NativeApiHistoryItem[];
      state: NativeApiDispatchState;
    };

export type NativeApiStartupControllerLike = Pick<NativeApiStartupController, 'runStartup'>;

export class NativeApiStartupController {
  constructor(
    private readonly input: {
      store: NativeApiSessionStore;
      executeTool?: typeof executeWorkerTool;
      listAvailableMcpTools?: () => Promise<McpToolSummary[]>;
      mutateTodos?: typeof todoListTool;
    }
  ) {}

  async runStartup(input: {
    context: AgentRunContext;
    sink: AgentRuntimeSink;
    history: NativeApiHistoryItem[];
    state: NativeApiDispatchState;
    signal?: AbortSignal;
  }): Promise<NativeApiStartupResult> {
    let history = input.history;
    let state = input.state;
    const turn = await this.input.store.createTurn({
      runId: input.context.runId,
      taskId: input.context.taskId,
      turnIndex: 0,
      history,
      provider: 'runtime_gate',
      model: null,
    });

    await input.sink.emit({
      type: 'turn_started',
      message: '[NativeApiRunner] startup gates started.',
      payload: {
        runtime: 'native_api_runner',
        phase: 'startup',
        turnId: turn.id,
        turnIndex: 0,
      },
    });

    const fail = async (
      gateHistory: NativeApiHistoryItem[],
      gateState: NativeApiDispatchState,
      summary: string,
      finalReport: string,
      error?: unknown
    ): Promise<NativeApiStartupResult> => {
      await this.input.store.finishTurn({
        turnId: turn.id,
        status: input.signal?.aborted ? 'cancelled' : 'failed',
        history: gateHistory,
        error,
      });
      return {
        ok: false,
        history: gateHistory,
        state: gateState,
        result: {
          terminalState: input.signal?.aborted ? 'cancelled' : 'needs_human',
          summary,
          finalReport,
          stoppedBy: input.signal?.aborted ? 'cancelled' : 'tool_failure',
          riskLevel: 'high',
        },
      };
    };

    if (input.signal?.aborted) {
      return fail(
        history,
        state,
        'Native API startup was cancelled.',
        'Native API startup was cancelled.'
      );
    }

    const specification = await this.runSpecificationGate({
      context: input.context,
      sink: input.sink,
      turnId: turn.id,
      state,
    });
    history = [...history, specification.historyItem];
    state = { ...state, specificationRead: specification.toolResult.ok };

    if (!specification.toolResult.ok) {
      return fail(
        history,
        state,
        'Native API startup failed while reading the current specification.',
        specification.toolResult.error?.message ||
          'Draft specification was not found or could not be read.',
        specification.toolResult.error
      );
    }

    const initialInstructions = await this.runMcpGate({
      phase: 'startup_initial_instructions',
      mcpTool: 'initial_instructions',
      modelToolName: 'context-still.initial_instructions',
      arguments: {},
      context: input.context,
      sink: input.sink,
      turnId: turn.id,
      state,
    });
    history = [...history, initialInstructions.historyItem];
    state = { ...state, initialInstructionsCompleted: initialInstructions.toolResult.ok };

    if (!initialInstructions.toolResult.ok) {
      return fail(
        history,
        state,
        'Native API startup failed while running contextStill initial_instructions.',
        initialInstructions.toolResult.error?.message ||
          'contextStill initial_instructions failed before provider turn.',
        initialInstructions.toolResult.error
      );
    }
    await this.completeProcedureTodo(input.context.runId, 'contextstill.initial_instructions');
    const workTodo = await this.resolveStartupWorkTodo(input.context.runId);

    const contextCompileArgs = buildContextCompileArguments(
      input.context,
      specification.toolResult.payload,
      workTodo
    );
    const contextCompile = await this.runMcpGate({
      phase: 'startup_context_compile',
      mcpTool: 'context_compile',
      modelToolName: 'context-still.context_compile',
      arguments: contextCompileArgs,
      context: input.context,
      sink: input.sink,
      turnId: turn.id,
      state,
    });
    history = [...history, contextCompile.historyItem];
    state = { ...state, contextCompiled: contextCompile.toolResult.ok };

    if (!contextCompile.toolResult.ok) {
      return fail(
        history,
        state,
        'Native API startup failed while running contextStill context_compile.',
        contextCompile.toolResult.error?.message ||
          'contextStill context_compile failed before provider turn.',
        contextCompile.toolResult.error
      );
    }
    await this.completeProcedureTodo(input.context.runId, 'contextstill.context_compile');

    const alignment = await this.alignTodos({
      context: input.context,
      sink: input.sink,
      turnId: turn.id,
      state,
    });
    history = [...history, alignment.historyItem];
    state = {
      ...state,
      todoAligned: alignment.toolResult.ok,
      startupCompleted: alignment.toolResult.ok,
    };

    if (!alignment.toolResult.ok) {
      return fail(
        history,
        state,
        'Native API startup Todo alignment failed.',
        alignment.toolResult.error?.message || 'Todo alignment failed before provider turn.',
        alignment.toolResult.error
      );
    }

    await this.input.store.finishTurn({
      turnId: turn.id,
      status: 'completed',
      history,
    });
    return { ok: true, history, state };
  }

  private async runSpecificationGate(input: {
    context: AgentRunContext;
    sink: AgentRuntimeSink;
    turnId: string;
    state: NativeApiDispatchState;
  }): Promise<StartupGateResult> {
    const args = { phase: 'startup_specification' };
    const result = await this.runRuntimeToolGate({
      phase: 'startup_specification',
      toolName: 'read_current_specification',
      workerToolName: 'read_current_specification',
      arguments: args,
      executeArgs: {},
      context: input.context,
      sink: input.sink,
      turnId: input.turnId,
      state: input.state,
      validateResult: (toolResult) => {
        const payload = toRecord(toolResult.payload);
        if (
          toolResult.ok &&
          payload.found === true &&
          typeof payload.content === 'string' &&
          payload.content.trim().length > 0
        ) {
          return toolResult;
        }
        return failedToolResult(
          'SPECIFICATION_NOT_FOUND',
          'Draft specification was not found or was empty.',
          toolResult.payload
        );
      },
    });
    const payload = toRecord(result.toolResult.payload);
    if (!result.toolResult.ok) return result;
    return {
      ...result,
      historyItem: {
        type: 'user',
        source: 'runtime',
        content: renderSpecificationHistory(payload),
      },
    };
  }

  private async runMcpGate(input: {
    phase: StartupPhase;
    mcpTool: 'initial_instructions' | 'context_compile';
    modelToolName: 'context-still.initial_instructions' | 'context-still.context_compile';
    arguments: Record<string, unknown>;
    context: AgentRunContext;
    sink: AgentRuntimeSink;
    turnId: string;
    state: NativeApiDispatchState;
  }): Promise<StartupGateResult> {
    const tool = await this.resolveContextStillTool(input.mcpTool);
    if (!tool) {
      const result = await this.runFailedRuntimeGate({
        phase: input.phase,
        toolName: input.modelToolName,
        arguments: input.arguments,
        context: input.context,
        sink: input.sink,
        turnId: input.turnId,
        error: failedToolResult(
          'MCP_TOOL_UNAVAILABLE',
          `contextStill ${input.mcpTool} is unavailable.`
        ),
        eventPayload: {
          mcpTool: input.mcpTool,
        },
      });
      return {
        ...result,
        historyItem: {
          type: 'user',
          source: 'runtime',
          content: `[Startup ${input.mcpTool}]\nMCP tool unavailable.`,
        },
      };
    }
    const result = await this.runRuntimeToolGate({
      phase: input.phase,
      toolName: input.modelToolName,
      workerToolName: 'mcp_call_tool',
      arguments: {
        serverId: tool.serverId,
        toolName: input.mcpTool,
        arguments: input.arguments,
      },
      executeArgs: {
        serverId: tool.serverId,
        toolName: input.mcpTool,
        arguments: input.arguments,
      },
      context: input.context,
      sink: input.sink,
      turnId: input.turnId,
      state: input.state,
      eventPayload: {
        mcpServer: tool.serverName,
        mcpTool: input.mcpTool,
        serverId: tool.serverId,
      },
    });
    return {
      ...result,
      historyItem: {
        type: 'user',
        source: 'runtime',
        content:
          input.mcpTool === 'context_compile'
            ? renderContextCompileHistory(input.arguments, result.toolResult)
            : renderInitialInstructionsHistory(result.toolResult),
      },
    };
  }

  private async runRuntimeToolGate(input: {
    phase: StartupPhase;
    toolName: string;
    workerToolName: Parameters<typeof executeWorkerTool>[0]['toolName'];
    arguments: Record<string, unknown>;
    executeArgs: Record<string, unknown>;
    context: AgentRunContext;
    sink: AgentRuntimeSink;
    turnId: string;
    state: NativeApiDispatchState;
    eventPayload?: Record<string, unknown>;
    validateResult?: (result: NativeApiToolResult) => NativeApiToolResult;
  }): Promise<StartupGateResult> {
    const toolCall = {
      id: `runtime-gate-${input.phase}-${crypto.randomUUID()}`,
      name: input.toolName,
      arguments: {
        ...input.arguments,
        phase: input.phase,
      },
    };
    const record = await this.input.store.recordToolCallPending({
      runId: input.context.runId,
      taskId: input.context.taskId,
      turnId: input.turnId,
      toolCall,
      todoSeq: input.context.currentTodo?.seq ?? null,
      source: 'runtime_gate',
    });

    await this.input.store.markToolCallRunning({ id: record.id });
    await input.sink.emit({
      type: 'tool_call_started',
      message: `[NativeApiRunner] ${input.toolName} startup gate started.`,
      payload: {
        callId: toolCall.id,
        toolName: input.toolName,
        phase: input.phase,
        arguments: input.arguments,
        ...input.eventPayload,
      },
    });

    const dispatch = await this.executeTool({
      toolName: input.workerToolName,
      args: input.executeArgs,
      repoRoot: input.context.repoRoot,
      taskId: input.context.taskId,
      safetyPolicy: input.context.safetyPolicy,
      readFiles: input.state.readFiles,
    });
    const toolResult = input.validateResult
      ? input.validateResult(projectWorkerResult(dispatch.result))
      : projectWorkerResult(dispatch.result);
    await this.input.store.finishToolCall({
      id: record.id,
      status: toolResult.ok ? 'completed' : 'failed',
      result: toolResult,
      error: toolResult.error,
      modelVisibleOutput: toolResult.content,
    });
    await input.sink.emit({
      type: 'tool_call_finished',
      message: `[NativeApiRunner] ${input.toolName} startup gate ${
        toolResult.ok ? 'finished' : 'failed'
      }.`,
      payload: {
        callId: toolCall.id,
        toolName: input.toolName,
        phase: input.phase,
        status: toolResult.ok ? 'completed' : 'failed',
        ok: toolResult.ok,
        result: dispatch.result.payload,
        error: toolResult.error ?? dispatch.result.error,
        ...input.eventPayload,
      },
    });

    return {
      historyItem: {
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: input.toolName,
        result: toolResult,
      },
      toolResult,
    };
  }

  private async runFailedRuntimeGate(input: {
    phase: StartupPhase;
    toolName: string;
    arguments: Record<string, unknown>;
    context: AgentRunContext;
    sink: AgentRuntimeSink;
    turnId: string;
    error: NativeApiToolResult;
    eventPayload?: Record<string, unknown>;
  }): Promise<StartupGateResult> {
    const toolCall = {
      id: `runtime-gate-${input.phase}-${crypto.randomUUID()}`,
      name: input.toolName,
      arguments: {
        ...input.arguments,
        phase: input.phase,
      },
    };
    const record = await this.input.store.recordToolCallPending({
      runId: input.context.runId,
      taskId: input.context.taskId,
      turnId: input.turnId,
      toolCall,
      todoSeq: input.context.currentTodo?.seq ?? null,
      source: 'runtime_gate',
    });
    await this.input.store.markToolCallRunning({ id: record.id });
    await input.sink.emit({
      type: 'tool_call_started',
      message: `[NativeApiRunner] ${input.toolName} startup gate started.`,
      payload: {
        callId: toolCall.id,
        toolName: input.toolName,
        phase: input.phase,
        arguments: input.arguments,
        ...input.eventPayload,
      },
    });
    await this.input.store.finishToolCall({
      id: record.id,
      status: 'failed',
      result: input.error,
      error: input.error.error,
      modelVisibleOutput: input.error.content,
    });
    await input.sink.emit({
      type: 'tool_call_finished',
      message: `[NativeApiRunner] ${input.toolName} startup gate failed.`,
      payload: {
        callId: toolCall.id,
        toolName: input.toolName,
        phase: input.phase,
        status: 'failed',
        ok: false,
        error: input.error.error,
        ...input.eventPayload,
      },
    });
    return {
      historyItem: {
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: input.toolName,
        result: input.error,
      },
      toolResult: input.error,
    };
  }

  private async alignTodos(input: {
    context: AgentRunContext;
    sink: AgentRuntimeSink;
    turnId: string;
    state: NativeApiDispatchState;
  }): Promise<StartupGateResult> {
    const toolCall = {
      id: `runtime-gate-startup_todo_alignment-${crypto.randomUUID()}`,
      name: 'todo_list',
      arguments: { operation: 'start', phase: 'startup_todo_alignment' },
    };
    const record = await this.input.store.recordToolCallPending({
      runId: input.context.runId,
      taskId: input.context.taskId,
      turnId: input.turnId,
      toolCall,
      source: 'runtime_gate',
    });
    await this.input.store.markToolCallRunning({ id: record.id });
    await input.sink.emit({
      type: 'tool_call_started',
      message: '[NativeApiRunner] startup Todo alignment started.',
      payload: {
        callId: toolCall.id,
        toolName: 'todo_list',
        operation: 'startup_alignment',
        phase: 'startup_todo_alignment',
      },
    });

    const toolResult = await this.alignTodoState(input.context.runId);
    await this.input.store.finishToolCall({
      id: record.id,
      status: toolResult.ok ? 'completed' : 'failed',
      result: toolResult,
      error: toolResult.error,
      modelVisibleOutput: toolResult.content,
    });
    await input.sink.emit({
      type: 'tool_call_finished',
      message: `[NativeApiRunner] startup Todo alignment ${toolResult.ok ? 'finished' : 'failed'}.`,
      payload: {
        callId: toolCall.id,
        toolName: 'todo_list',
        operation: 'startup_alignment',
        phase: 'startup_todo_alignment',
        status: toolResult.ok ? 'completed' : 'failed',
        ok: toolResult.ok,
        result: toolResult.payload,
        error: toolResult.error,
      },
    });
    return {
      historyItem: {
        type: 'user',
        source: 'runtime',
        content: renderTodoAlignmentHistory(toolResult),
      },
      toolResult,
    };
  }

  private async alignTodoState(runId: string): Promise<NativeApiToolResult> {
    const todos = await repo.listTaskRunTodosForRun(runId);
    const openStartupGate = todos.find(
      (todo) =>
        ['pending', 'running'].includes(todo.status) &&
        (todo.procedureId === 'contextstill.initial_instructions' ||
          todo.procedureId === 'contextstill.context_compile')
    );
    if (openStartupGate) {
      return failedToolResult(
        'STARTUP_TODO_GATE_OPEN',
        `Startup Todo remains open after runtime gates: seq=${openStartupGate.seq} procedureId=${openStartupGate.procedureId}`
      );
    }

    const runningTodos = todos.filter((todo) => todo.status === 'running');
    if (runningTodos.length > 1) {
      return failedToolResult(
        'CURRENT_TODO_NOT_UNIQUE',
        `Multiple running Todos exist after startup gates: ${runningTodos.map((todo) => todo.seq).join(', ')}`
      );
    }
    if (runningTodos.length === 1) {
      return successfulTodoAlignment(todos, null);
    }

    const nextOpen = todos
      .filter((todo) => todo.status === 'pending' && !isFinalCloseoutTodo(todo))
      .sort((a, b) => a.seq - b.seq)[0];
    if (!nextOpen) {
      return successfulTodoAlignment(todos, null);
    }
    const result = await this.mutateTodos({
      runId,
      operation: 'start',
      seq: nextOpen.seq,
    });
    if (!result.ok) return projectWorkerResult(result);
    const refreshed = await repo.listTaskRunTodosForRun(runId);
    return successfulTodoAlignment(refreshed, result.payload);
  }

  private async completeProcedureTodo(runId: string, procedureId: string) {
    const todos = await repo.listTaskRunTodosForRun(runId);
    const target = todos
      .filter((todo) => todo.procedureId === procedureId)
      .sort((a, b) => a.seq - b.seq)[0];
    if (!target || target.status === 'passed') return;
    if (target.status === 'pending') {
      const started = await this.mutateTodos({ runId, operation: 'start', seq: target.seq });
      if (!started.ok) return;
    }
    await this.mutateTodos({ runId, operation: 'done', seq: target.seq });
  }

  private async resolveStartupWorkTodo(runId: string) {
    const todos = await repo.listTaskRunTodosForRun(runId);
    return resolveStartupWorkTodo(todos);
  }

  private executeTool(input: Parameters<typeof executeWorkerTool>[0]) {
    return (this.input.executeTool ?? executeWorkerTool)(input);
  }

  private mutateTodos(input: Parameters<typeof todoListTool>[0]) {
    return (this.input.mutateTodos ?? todoListTool)(input);
  }

  private async resolveContextStillTool(toolName: 'initial_instructions' | 'context_compile') {
    const tools = await (
      this.input.listAvailableMcpTools ?? (() => mcpClientManager.listAvailableTools())
    )();
    return (
      tools.find((tool) => tool.name === toolName && isContextStillTool(tool)) ??
      tools.find((tool) => tool.name === toolName) ??
      null
    );
  }
}

function buildContextCompileArguments(
  context: AgentRunContext,
  specification: unknown,
  workTodo: StartupWorkTodo | null
) {
  const spec = toRecord(specification);
  const title = typeof spec.title === 'string' && spec.title.trim() ? spec.title.trim() : null;
  const digest = typeof spec.digest === 'string' && spec.digest.trim() ? spec.digest.trim() : null;
  const specContent =
    typeof spec.content === 'string' && spec.content.trim() ? summarizeText(spec.content, 240) : null;
  const request = summarizeText(context.latestUserMessage || context.compiledPrompt, 280);
  const executionMode = readNativeApiExecutionMode(context);
  const goalParts = [
    `ユーザー依頼「${request}」に対応する。`,
    workTodo
      ? `実作業 Todo #${workTodo.seq}「${workTodo.title}」(${workTodo.taskType}) を現在の作業単位にする。`
      : 'startup gate ではなく、ユーザー依頼と仕様書を現在の作業単位にする。',
    title || digest
      ? `仕様書 ${title ? `「${title}」` : ''}${digest ? ` (${digest})` : ''} を前提にする。`
      : '読了済み仕様書を前提にする。',
    specContent ? `仕様書要点: ${specContent}` : '',
    `executionMode=${executionMode} として、必要な実装・検証・closeout まで進める。`,
  ];
  return {
    goal: goalParts.filter(Boolean).join(' '),
    domains: ['nightWorkers'],
    technologies: ['typescript', 'bun'],
    changeTypes: changeTypesForExecutionMode(executionMode),
  };
}

type StartupWorkTodo = {
  seq: number;
  title: string;
  taskType: string;
  status: string;
  procedureId?: string | null;
};

function resolveStartupWorkTodo(
  todos: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>
): StartupWorkTodo | null {
  return (
    todos
      .filter(
        (todo) =>
          ['pending', 'running'].includes(todo.status) &&
          !isStartupGateTodo(todo) &&
          !isFinalCloseoutTodo(todo)
      )
      .sort(
        (a, b) =>
          startupWorkTodoStatusRank(a.status) - startupWorkTodoStatusRank(b.status) ||
          a.seq - b.seq
      )
      .map((todo) => ({
        seq: todo.seq,
        title: todo.title,
        taskType: todo.taskType,
        status: todo.status,
        procedureId: todo.procedureId,
      }))[0] ?? null
  );
}

function startupWorkTodoStatusRank(status: string) {
  if (status === 'running') return 0;
  if (status === 'pending') return 1;
  return 2;
}

function isStartupGateTodo(todo: { taskType?: string | null; procedureId?: string | null }) {
  return (
    todo.procedureId === 'contextstill.initial_instructions' ||
    todo.procedureId === 'contextstill.context_compile' ||
    todo.taskType === 'initial_instructions' ||
    todo.taskType === 'context_compile'
  );
}

function changeTypesForExecutionMode(mode: ReturnType<typeof readNativeApiExecutionMode>) {
  if (mode === 'review') return ['review', 'verification'];
  if (mode === 'runtime_debug') return ['investigation', 'implementation', 'verification'];
  if (mode === 'planning') return ['planning'];
  if (mode === 'general_answer') return ['investigation'];
  return ['implementation', 'verification'];
}

function summarizeText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
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

function failedToolResult(code: string, message: string, payload?: unknown): NativeApiToolResult {
  return {
    ok: false,
    content: JSON.stringify({ ok: false, error: { code, message }, payload }),
    payload,
    error: { code, message },
  };
}

function successfulTodoAlignment(
  todos: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>,
  transitionPayload: TodoActionPayload | null
): NativeApiToolResult {
  return {
    ok: true,
    content: JSON.stringify({
      ok: true,
      toolName: 'todo_list',
      payload: { todos, transition: transitionPayload?.transition ?? null },
    }),
    payload: { todos, transition: transitionPayload?.transition ?? null },
  };
}

function renderSpecificationHistory(payload: Record<string, unknown>) {
  const title = typeof payload.title === 'string' ? payload.title : 'Specification';
  const digest = typeof payload.digest === 'string' ? payload.digest : 'none';
  const content = typeof payload.content === 'string' ? payload.content : '';
  return [
    '[Startup Specification]',
    `title=${title}`,
    `digest=${digest}`,
    '',
    content.slice(0, 4000),
  ].join('\n');
}

function renderInitialInstructionsHistory(result: NativeApiToolResult) {
  return [
    '[Startup Initial Instructions]',
    result.ok
      ? 'contextStill initial_instructions completed.'
      : 'contextStill initial_instructions failed.',
    summarizePayload(result.payload),
  ]
    .filter(Boolean)
    .join('\n');
}

function renderContextCompileHistory(args: Record<string, unknown>, result: NativeApiToolResult) {
  return [
    '[Startup Context Pack]',
    `goal=${typeof args.goal === 'string' ? args.goal : ''}`,
    result.ok ? 'contextStill context_compile completed.' : 'contextStill context_compile failed.',
    summarizePayload(result.payload),
  ]
    .filter(Boolean)
    .join('\n');
}

function renderTodoAlignmentHistory(result: NativeApiToolResult) {
  return [
    '[Startup Todo Alignment]',
    result.ok ? 'Todo alignment completed.' : 'Todo alignment failed.',
    summarizePayload(result.payload),
  ]
    .filter(Boolean)
    .join('\n');
}

function summarizePayload(payload: unknown) {
  if (payload === undefined || payload === null) return '';
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return text.length > 2000 ? `${text.slice(0, 2000)}...` : text;
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

function isFinalCloseoutTodo(todo: { taskType?: string | null; procedureId?: string | null }) {
  return (
    (todo.taskType === 'knowledge_capture' &&
      todo.procedureId === 'contextstill.register_candidates') ||
    (todo.taskType === 'completion_report' && todo.procedureId === 'final_completion_report') ||
    todo.procedureId === 'contextstill_closeout'
  );
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
