import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import {
  NativeApiRunner,
  type NativeApiToolTurnProvider,
} from '../api/services/agent-runtime/native-api-runner/native-api-runner';
import type { NativeApiSessionStore } from '../api/services/agent-runtime/native-api-runner/native-api-session-store';
import { dispatchNativeApiToolCall } from '../api/services/agent-runtime/native-api-runner/native-api-tool-dispatcher';
import { getNativeApiToolDefinitions } from '../api/services/agent-runtime/native-api-runner/native-api-tool-registry';
import type { AgentRunContext, AgentRuntimeEvent } from '../api/services/agent-runtime/types';
import type { ProviderToolTurnResult } from '../api/services/structured-llm/tool-calls';

vi.mock('../api/modules/nightworkers/nightworkers.repository', () => ({
  getTaskRun: vi.fn(),
  listTaskRunTodosForRun: vi.fn(),
}));

describe('NativeApiRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (repo.getTaskRun as never).mockResolvedValue({ id: 'run-1', status: 'running' });
    (repo.listTaskRunTodosForRun as never).mockResolvedValue([]);
  });

  it('stops with needs_human when the provider returns no native tool calls', async () => {
    const store = createFakeStore();
    const providerTurn = createProvider([
      {
        type: 'supported',
        content: 'I will explain instead of using tools.',
        toolCalls: [],
        usage: usage(),
        model: 'api-model',
      },
    ]);
    const usageRecorder = vi.fn(async () => undefined);
    const runner = new NativeApiRunner({
      store: store.instance,
      startupController: createNoopStartup(),
      providerTurn,
      usageRecorder,
      maxTurns: 1,
    });

    const result = await runner.run(buildContext(), createSink());

    expect(result).toMatchObject({
      terminalState: 'needs_human',
      stoppedBy: 'missing_tool_call',
      riskLevel: 'high',
    });
    expect(result.finalReport).toContain('did not fall back to Codex or SchemaFirst');
    expect(store.turns).toHaveLength(1);
    expect(store.finishedTurns[0]).toMatchObject({ status: 'failed' });
    expect(store.toolCalls).toHaveLength(0);
    expect(usageRecorder).toHaveBeenCalledOnce();
  });

  it('persists provider-native tool lifecycle and completes on finalize_answer', async () => {
    const store = createFakeStore();
    const providerTurn = createProvider([
      {
        type: 'supported',
        content: 'ready to finalize',
        toolCalls: [
          {
            id: 'call-final',
            name: 'finalize_answer',
            arguments: {
              summary: 'done',
              finalReport: 'All requested native/API runner work is complete.',
            },
          },
        ],
        usage: usage(),
        model: 'api-model',
      },
    ]);
    const runner = new NativeApiRunner({
      store: store.instance,
      startupController: createNoopStartup(),
      providerTurn,
      usageRecorder: vi.fn(async () => undefined),
      maxTurns: 1,
    });
    const events: AgentRuntimeEvent[] = [];

    const result = await runner.run(buildContext(), createSink(events));

    expect(result).toMatchObject({
      terminalState: 'completed',
      summary: 'done',
      stoppedBy: 'decision',
    });
    expect(result.finalReport).toBe('All requested native/API runner work is complete.');
    expect(repo.listTaskRunTodosForRun).toHaveBeenCalledWith('run-1');
    expect(store.toolCalls).toEqual([
      expect.objectContaining({
        id: 'tool-1',
        toolName: 'finalize_answer',
        status: 'pending',
      }),
    ]);
    expect(store.runningToolCalls).toEqual(['tool-1']);
    expect(store.finishedToolCalls[0]).toMatchObject({
      id: 'tool-1',
      status: 'completed',
      result: expect.objectContaining({ ok: true }),
    });
    expect(store.finishedTurns[0]).toMatchObject({ status: 'completed' });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'turn_started',
          payload: expect.objectContaining({
            runtime: 'native_api_runner',
            toolCount: expect.any(Number),
          }),
        }),
      ])
    );
  });

  it('passes the resolved runtime route override into provider turns', async () => {
    const store = createFakeStore();
    const providerTurn = createProvider([
      {
        type: 'supported',
        content: 'ready to finalize',
        toolCalls: [
          {
            id: 'call-final',
            name: 'finalize_answer',
            arguments: { finalReport: 'done' },
          },
        ],
        usage: usage(),
        model: 'api-model',
      },
    ]);
    const runner = new NativeApiRunner({
      store: store.instance,
      startupController: createNoopStartup(),
      providerTurn,
      usageRecorder: vi.fn(async () => undefined),
      maxTurns: 1,
    });

    await runner.run(
      buildContext({
        runtimeOptions: {
          llmRouting: {
            override: {
              providerEndpointId: 'local-api',
              model: 'qwen-coder',
              thinkingDepth: 'medium',
            },
          },
        },
      }),
      createSink()
    );

    expect(providerTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          routeOverride: {
            providerEndpointId: 'local-api',
            model: 'qwen-coder',
            thinkingDepth: 'medium',
          },
        }),
      })
    );
  });

  it('starts a fresh provider history after new_context without summarizing prior turns', async () => {
    const store = createFakeStore();
    const providerTurn = createProvider([
      {
        type: 'supported',
        content: 'the current window is too large',
        toolCalls: [{ id: 'call-new-context', name: 'new_context', arguments: {} }],
        usage: usage(),
        model: 'api-model',
      },
      {
        type: 'supported',
        content: 'ready after fresh context',
        toolCalls: [
          {
            id: 'call-final',
            name: 'finalize_answer',
            arguments: { finalReport: 'done after new context' },
          },
        ],
        usage: usage(),
        model: 'api-model',
      },
    ]);
    const events: AgentRuntimeEvent[] = [];
    const runner = new NativeApiRunner({
      store: store.instance,
      startupController: createNoopStartup(),
      providerTurn,
      usageRecorder: vi.fn(async () => undefined),
      maxTurns: 2,
    });

    const result = await runner.run(
      buildContext({
        compiledPrompt: 'raw compiled prompt',
        latestUserMessage: '<USER_REQUEST>\nimplement the requested change\n</USER_REQUEST>',
        contextSnapshot: {
          compiledPrompt: 'raw compiled prompt',
          source: 'fallback',
        },
      }),
      createSink(events)
    );

    expect(result).toMatchObject({
      terminalState: 'completed',
      finalReport: 'done after new context',
    });
    expect(providerTurn).toHaveBeenCalledTimes(2);
    const firstMessages = vi.mocked(providerTurn).mock.calls[0][0].messages;
    const secondMessages = vi.mocked(providerTurn).mock.calls[1][0].messages;
    expect(firstMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: '<USER_REQUEST>\nimplement the requested change\n</USER_REQUEST>',
        }),
      ])
    );
    expect(secondMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: '<USER_REQUEST>\nimplement the requested change\n</USER_REQUEST>',
        }),
      ])
    );
    expect(JSON.stringify(secondMessages)).not.toContain('the current window is too large');
    expect(JSON.stringify(secondMessages)).not.toContain('call-new-context');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool_call_progress',
          payload: expect.objectContaining({
            action: 'context_window_started',
            runtime: 'native_api_runner',
          }),
        }),
      ])
    );
  });

  it('refreshes Todo state from the database before each provider turn', async () => {
    (repo.listTaskRunTodosForRun as never)
      .mockResolvedValueOnce([
        {
          seq: 1,
          title: 'Implement runner',
          taskType: 'implementation',
          status: 'running',
          procedureId: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          seq: 1,
          title: 'Implement runner',
          taskType: 'implementation',
          status: 'passed',
          procedureId: null,
        },
      ])
      .mockResolvedValueOnce([]);
    const store = createFakeStore();
    const providerTurn = createProvider([
      {
        type: 'supported',
        content: 'need another turn',
        toolCalls: [{ id: 'call-unknown', name: 'unknown_tool', arguments: {} }],
        usage: usage(),
        model: 'api-model',
      },
      {
        type: 'supported',
        content: 'finalize',
        toolCalls: [
          {
            id: 'call-final',
            name: 'finalize_answer',
            arguments: { finalReport: 'done' },
          },
        ],
        usage: usage(),
        model: 'api-model',
      },
    ]);
    const runner = new NativeApiRunner({
      store: store.instance,
      startupController: createNoopStartup(),
      providerTurn,
      usageRecorder: vi.fn(async () => undefined),
      maxTurns: 2,
    });

    const result = await runner.run(buildContext(), createSink());

    expect(result.terminalState).toBe('completed');
    expect(providerTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('seq=1 status=passed'),
          }),
        ]),
      })
    );
  });

  it('records dispatcher exceptions as failed tool results instead of leaving running records', async () => {
    (repo.listTaskRunTodosForRun as never)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('database is locked'));
    const store = createFakeStore();
    const providerTurn = createProvider([
      {
        type: 'supported',
        content: 'try finalize',
        toolCalls: [
          {
            id: 'call-final',
            name: 'finalize_answer',
            arguments: { finalReport: 'done' },
          },
        ],
        usage: usage(),
        model: 'api-model',
      },
    ]);
    const runner = new NativeApiRunner({
      store: store.instance,
      startupController: createNoopStartup(),
      providerTurn,
      usageRecorder: vi.fn(async () => undefined),
      maxTurns: 1,
    });

    const result = await runner.run(buildContext(), createSink());

    expect(result).toMatchObject({
      terminalState: 'needs_human',
      stoppedBy: 'budget',
    });
    expect(store.finishedToolCalls[0]).toMatchObject({
      id: 'tool-1',
      status: 'failed',
      error: {
        code: 'TOOL_DISPATCH_EXCEPTION',
        message: 'database is locked',
      },
    });
    expect(store.finishedTurns[0]).toMatchObject({ status: 'completed' });
  });

  it('aborts the active provider turn and does not execute returned tools after stop', async () => {
    const store = createFakeStore();
    let providerStarted!: () => void;
    const providerStartedPromise = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });
    let observedSignal: AbortSignal | undefined;
    const providerTurn = vi.fn(
      async (input: Parameters<NativeApiToolTurnProvider>[0]): Promise<ProviderToolTurnResult> => {
        observedSignal = input.signal;
        providerStarted();
        await new Promise((_resolve, reject) => {
          input.signal?.addEventListener(
            'abort',
            () => reject(new Error('provider request aborted')),
            { once: true }
          );
        });
        throw new Error('unreachable');
      }
    ) as unknown as NativeApiToolTurnProvider;
    const runner = new NativeApiRunner({
      store: store.instance,
      startupController: createNoopStartup(),
      providerTurn,
      usageRecorder: vi.fn(async () => undefined),
      maxTurns: 1,
    });

    const resultPromise = runner.run(buildContext(), createSink());
    await providerStartedPromise;
    await runner.stop('run-1');
    const result = await resultPromise;

    expect(observedSignal?.aborted).toBe(true);
    expect(result).toMatchObject({
      terminalState: 'cancelled',
      stoppedBy: 'cancelled',
    });
    expect(store.toolCalls).toHaveLength(0);
    expect(store.finishedTurns[0]).toMatchObject({ status: 'cancelled' });
  });

  it('does not execute provider-returned tools when run status was cancelled after provider turn', async () => {
    (repo.getTaskRun as never)
      .mockResolvedValueOnce({ id: 'run-1', status: 'running' })
      .mockResolvedValueOnce({ id: 'run-1', status: 'cancelled' });
    const store = createFakeStore();
    const providerTurn = createProvider([
      {
        type: 'supported',
        content: 'attempting to continue after stop',
        toolCalls: [
          {
            id: 'call-final',
            name: 'finalize_answer',
            arguments: { finalReport: 'This should not finalize.' },
          },
        ],
        usage: usage(),
        model: 'api-model',
      },
    ]);
    const runner = new NativeApiRunner({
      store: store.instance,
      startupController: createNoopStartup(),
      providerTurn,
      usageRecorder: vi.fn(async () => undefined),
      maxTurns: 1,
    });

    const result = await runner.run(buildContext(), createSink());

    expect(result).toMatchObject({
      terminalState: 'cancelled',
      stoppedBy: 'cancelled',
    });
    expect(store.toolCalls).toHaveLength(0);
    expect(store.finishedTurns[0]).toMatchObject({ status: 'cancelled' });
    expect(repo.listTaskRunTodosForRun).toHaveBeenCalledOnce();
  });
});

describe('NativeApiRunner tool registry and dispatcher gates', () => {
  it('does not expose todo_list list as a model-visible operation', () => {
    const todoTool = getNativeApiToolDefinitions().find((tool) => tool.name === 'todo_list');

    expect(todoTool?.inputSchema).toMatchObject({
      properties: {
        operation: {
          enum: ['replace', 'start', 'done', 'block', 'fail'],
        },
      },
    });
  });

  it('exposes Codex-style new_context as an empty model-visible tool', () => {
    const newContextTool = getNativeApiToolDefinitions().find(
      (tool) => tool.name === 'new_context'
    );

    expect(newContextTool).toMatchObject({
      name: 'new_context',
      description: 'Start a new context window without summarizing conversation history.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    });
  });

  it('marks the dispatch state when new_context is called', async () => {
    const result = await dispatchNativeApiToolCall({
      toolCall: { id: 'call-new-context', name: 'new_context', arguments: {} },
      context: buildContext(),
      sink: createSink(),
      state: { readFiles: [], specificationRead: true },
    });

    expect(result.kind).toBe('continue');
    expect(result.state).toMatchObject({
      newContextWindowRequested: true,
    });
    expect(result.toolResult).toMatchObject({
      ok: true,
      payload: {
        newContextWindowRequested: true,
      },
    });
  });

  it('rejects empty context_compile input before any MCP dispatch', async () => {
    const result = await dispatchNativeApiToolCall({
      toolCall: { id: 'call-context', name: 'context_compile', arguments: {} },
      context: buildContext(),
      sink: createSink(),
      state: { readFiles: [], specificationRead: true },
    });

    expect(result.kind).toBe('continue');
    expect(result.toolResult).toMatchObject({
      ok: false,
      error: {
        code: 'INVALID_TOOL_ARGS',
      },
    });
  });

  it('blocks context_compile until read_current_specification has succeeded', async () => {
    const result = await dispatchNativeApiToolCall({
      toolCall: {
        id: 'call-context',
        name: 'context_compile',
        arguments: { goal: 'implement native API runner' },
      },
      context: buildContext(),
      sink: createSink(),
      state: { readFiles: [], specificationRead: false },
    });

    expect(result.kind).toBe('continue');
    expect(result.toolResult).toMatchObject({
      ok: false,
      error: {
        code: 'SPECIFICATION_REQUIRED',
      },
    });
  });
});

function createProvider(results: ProviderToolTurnResult[]): NativeApiToolTurnProvider {
  const providerTurn = vi.fn(async () => {
    const result = results.shift();
    if (!result) throw new Error('No provider result queued.');
    return result;
  });
  return providerTurn as unknown as NativeApiToolTurnProvider;
}

function createFakeStore() {
  const turns: Array<Record<string, unknown>> = [];
  const finishedTurns: Array<Record<string, unknown>> = [];
  const toolCalls: Array<Record<string, unknown>> = [];
  const runningToolCalls: string[] = [];
  const finishedToolCalls: Array<Record<string, unknown>> = [];
  const instance = {
    createTurn: vi.fn(async (input) => {
      const turn = {
        ...input,
        id: `turn-${turns.length + 1}`,
      };
      turns.push(turn);
      return turn;
    }),
    finishTurn: vi.fn(async (input) => {
      finishedTurns.push(input);
      return input;
    }),
    recordToolCallPending: vi.fn(async (input) => {
      const record = {
        ...input,
        id: `tool-${toolCalls.length + 1}`,
        toolName: input.toolCall.name,
        status: 'pending',
      };
      toolCalls.push(record);
      return record;
    }),
    markToolCallRunning: vi.fn(async ({ id }) => {
      runningToolCalls.push(id);
      return { id, status: 'running' };
    }),
    finishToolCall: vi.fn(async (input) => {
      finishedToolCalls.push(input);
      return input;
    }),
  } as unknown as NativeApiSessionStore;
  return { instance, turns, finishedTurns, toolCalls, runningToolCalls, finishedToolCalls };
}

function createNoopStartup() {
  return {
    runStartup: vi.fn(async (input) => ({
      ok: true as const,
      history: input.history,
      state: input.state,
    })),
  };
}

function createSink(events: AgentRuntimeEvent[] = []) {
  return {
    emit: vi.fn(async (event: AgentRuntimeEvent) => {
      events.push(event);
    }),
  };
}

function usage() {
  return {
    inputTokens: 10,
    outputTokens: 5,
    cachedInputTokens: null,
    reasoningOutputTokens: null,
    totalTokens: 15,
    mode: 'measured' as const,
  };
}

function buildContext(overrides: Partial<AgentRunContext> = {}): AgentRunContext {
  return {
    runId: 'run-1',
    taskId: 'task-1',
    repositoryId: 'repo-1',
    repoRoot: '/Users/y.noguchi/Code/nightWorkers',
    compiledPrompt: 'implement the requested change',
    latestUserMessage: 'implement the requested change',
    timeoutSeconds: 60,
    contextSnapshot: {
      compiledPrompt: 'implement the requested change',
      source: 'fallback',
    },
    ...overrides,
  };
}
