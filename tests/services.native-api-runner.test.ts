import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  createTaskEvent: vi.fn(),
}));

vi.mock('../api/services/mcp/mcp-client-manager', () => ({
  mcpClientManager: {
    listAvailableTools: vi.fn(async () => []),
    callTool: vi.fn(),
  },
}));

describe('NativeApiRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (repo.getTaskRun as never).mockResolvedValue({
      id: 'run-1',
      status: 'running',
    });
    (repo.listTaskRunTodosForRun as never).mockResolvedValue([]);
  });

  it('stops with needs_human when implementation provider returns text but no native tool calls', async () => {
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
    });

    const result = await runner.run(buildContext(), createSink());

    expect(result).toMatchObject({
      terminalState: 'needs_human',
      stoppedBy: 'missing_tool_call',
      riskLevel: 'high',
    });
    expect(result.finalReport).toContain('requires tool calls/finalize_answer');
    expect(store.turns).toHaveLength(1);
    expect(store.finishedTurns[0]).toMatchObject({ status: 'failed' });
    expect(store.toolCalls).toHaveLength(0);
    expect(usageRecorder).toHaveBeenCalledOnce();
  });

  it('allows text-only completion for general answers', async () => {
    const store = createFakeStore();
    const providerTurn = createProvider([
      {
        type: 'supported',
        content: 'Here is the answer.',
        toolCalls: [],
        usage: usage(),
        model: 'api-model',
      },
    ]);
    const runner = new NativeApiRunner({
      store: store.instance,
      startupController: createNoopStartup(),
      providerTurn,
      usageRecorder: vi.fn(async () => undefined),
    });

    const result = await runner.run(
      buildContext({ runtimeOptions: { executionMode: 'general_answer' } }),
      createSink()
    );

    expect(result).toMatchObject({
      terminalState: 'completed',
      stoppedBy: 'decision',
    });
    expect(result.finalReport).toBe('Here is the answer.');
    expect(store.finishedTurns[0]).toMatchObject({ status: 'completed' });
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

  it('continues past the previous 20 provider-native turn ceiling', async () => {
    const store = createFakeStore();
    const providerTurn = createProvider([
      ...Array.from({ length: 20 }, (_, index) => ({
        type: 'supported' as const,
        content: `continue turn ${index + 1}`,
        toolCalls: [{ id: `call-unknown-${index + 1}`, name: 'unknown_tool', arguments: {} }],
        usage: usage(),
        model: 'api-model',
      })),
      {
        type: 'supported',
        content: 'finalize after old ceiling',
        toolCalls: [
          {
            id: 'call-final',
            name: 'finalize_answer',
            arguments: { finalReport: 'completed after turn 20' },
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
    });

    const result = await runner.run(buildContext(), createSink());

    expect(result).toMatchObject({
      terminalState: 'completed',
      stoppedBy: 'decision',
      finalReport: 'completed after turn 20',
    });
    expect(providerTurn).toHaveBeenCalledTimes(21);
    expect(store.turns.at(-1)).toMatchObject({ turnIndex: 21 });
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

  it('classifies required tool-call failures and falls back to the next native/API route', async () => {
    const restoreSettings = installRuntimeLlmSettings({
      ACTIVE_LLM_PROVIDER: 'azure',
      providerEndpoints: [
        {
          id: 'local-gemma',
          name: 'Local Gemma',
          kind: 'local',
          enabled: true,
          baseUrl: 'http://localhost:11434/v1',
          models: ['gemma-4-12b-it-4bit'],
        },
        {
          id: 'azure-implementation',
          name: 'Azure Implementation',
          kind: 'azure',
          enabled: true,
          endpoint: 'https://example.openai.azure.com',
          apiVersion: '2024-05-01-preview',
          models: ['gpt-5-mini'],
        },
      ],
      roleRoutes: [
        {
          role: 'implementation',
          primary: {
            providerEndpointId: 'local-gemma',
            model: 'gemma-4-12b-it-4bit',
          },
          fallbacks: [
            {
              providerEndpointId: 'local-gemma',
              model: 'gemma-4-12b-it-4bit',
            },
            {
              providerEndpointId: 'azure-implementation',
              model: 'gpt-5-mini',
            },
          ],
        },
      ],
    });
    try {
      const store = createFakeStore();
      const providerTurn = vi
        .fn()
        .mockRejectedValueOnce(
          new Error(
            'OpenAI native tool call failed with status 400: {"error":{"code":"required_tool_call_missing"}}'
          )
        )
        .mockResolvedValueOnce({
          type: 'supported',
          content: 'ready to finalize',
          toolCalls: [
            {
              id: 'call-final',
              name: 'finalize_answer',
              arguments: { finalReport: 'fallback done' },
            },
          ],
          usage: usage(),
          model: 'gpt-5-mini',
          providerDebug: { provider: 'azure-openai' },
        } satisfies ProviderToolTurnResult);
      const events: AgentRuntimeEvent[] = [];
      const runner = new NativeApiRunner({
        store: store.instance,
        startupController: createNoopStartup(),
        providerTurn: providerTurn as unknown as NativeApiToolTurnProvider,
        usageRecorder: vi.fn(async () => undefined),
      });

      const result = await runner.run(buildContext({ timeoutSeconds: 360 }), createSink(events));

      expect(result).toMatchObject({
        terminalState: 'completed',
        finalReport: 'fallback done',
      });
      expect(providerTurn).toHaveBeenCalledTimes(2);
      expect(
        providerTurn.mock.calls.map((call) => ({
          providerEndpointId: call[0].options.normalizedRequest.providerEndpointId,
          attemptTimeoutMs: call[0].options.attemptTimeoutMs,
        }))
      ).toEqual([
        { providerEndpointId: 'local-gemma', attemptTimeoutMs: 300000 },
        {
          providerEndpointId: 'azure-implementation',
          attemptTimeoutMs: 120000,
        },
      ]);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'tool_call_progress',
            payload: expect.objectContaining({
              action: 'provider_route_fallback_started',
              reason: 'tool_required_missing',
            }),
          }),
        ])
      );
      expect(store.finishedTurns[0].providerDebug).toMatchObject({
        routeAttempts: [
          expect.objectContaining({
            ok: false,
            reason: 'tool_required_missing',
            route: expect.objectContaining({
              providerEndpointId: 'local-gemma',
            }),
          }),
          expect.objectContaining({
            ok: true,
            reason: 'accepted',
            route: expect.objectContaining({
              providerEndpointId: 'azure-implementation',
            }),
          }),
        ],
      });
    } finally {
      restoreSettings();
    }
  });

  it('does not synthesize enabled endpoints outside explicit Role Routing fallbacks', async () => {
    const restoreSettings = installRuntimeLlmSettings({
      ACTIVE_LLM_PROVIDER: 'azure',
      providerEndpoints: [
        {
          id: 'codex-implementation',
          name: 'Codex Implementation',
          kind: 'codex',
          enabled: true,
          models: ['gpt-5.4-mini'],
        },
        {
          id: 'local-qwen',
          name: 'Local Qwen',
          kind: 'local',
          enabled: true,
          baseUrl: 'http://localhost:11434/v1',
          models: ['qwen3-coder'],
        },
        {
          id: 'azure-implementation',
          name: 'Azure Implementation',
          kind: 'azure',
          enabled: true,
          endpoint: 'https://example.openai.azure.com',
          apiVersion: '2024-05-01-preview',
          models: ['gpt-5-mini'],
        },
      ],
      roleRoutes: [
        {
          role: 'implementation',
          primary: {
            providerEndpointId: 'codex-implementation',
            model: 'gpt-5.4-mini',
          },
          fallbacks: [],
        },
      ],
    });
    try {
      const store = createFakeStore();
      const providerTurn = createProvider([]);
      const events: AgentRuntimeEvent[] = [];
      const runner = new NativeApiRunner({
        store: store.instance,
        startupController: createNoopStartup(),
        providerTurn,
        usageRecorder: vi.fn(async () => undefined),
      });

      const result = await runner.run(buildContext(), createSink(events));

      expect(result).toMatchObject({
        terminalState: 'needs_human',
        stoppedBy: 'llm_error',
      });
      expect(result.finalReport).toContain('No native/API provider route candidates');
      expect(providerTurn).not.toHaveBeenCalled();
      expect(store.turns).toHaveLength(0);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'runtime_error',
            payload: expect.objectContaining({
              reason: 'no_native_api_provider_route_candidates',
            }),
          }),
        ])
      );
    } finally {
      restoreSettings();
    }
  });

  it('runs baseline context compaction before provider call without waiting for new_context', async () => {
    const restoreSettings = installRuntimeLlmSettings({
      ACTIVE_LLM_PROVIDER: 'azure',
      providerEndpoints: [
        {
          id: 'local-qwen',
          name: 'Local Qwen',
          kind: 'local',
          enabled: true,
          baseUrl: 'http://localhost:11434/v1',
          models: ['qwen3-coder'],
        },
      ],
      roleRoutes: [
        {
          role: 'implementation',
          primary: {
            providerEndpointId: 'local-qwen',
            model: 'qwen3-coder',
          },
          fallbacks: [],
        },
      ],
    });
    try {
      const hugeAssistantContent = `large prior turn ${'x'.repeat(540_000)}`;
      const store = createFakeStore();
      const providerTurn = createProvider([
        {
          type: 'supported',
          content: hugeAssistantContent,
          toolCalls: [{ id: 'call-unknown', name: 'unknown_tool', arguments: {} }],
          usage: usage(),
          model: 'qwen3-coder',
        },
        {
          type: 'supported',
          content: 'ready after runtime compaction',
          toolCalls: [
            {
              id: 'call-final',
              name: 'finalize_answer',
              arguments: { finalReport: 'done after runtime compaction' },
            },
          ],
          usage: usage(),
          model: 'qwen3-coder',
        },
      ]);
      const events: AgentRuntimeEvent[] = [];
      const runner = new NativeApiRunner({
        store: store.instance,
        startupController: createNoopStartup(),
        providerTurn,
        usageRecorder: vi.fn(async () => undefined),
      });

      const result = await runner.run(buildContext({ timeoutSeconds: 360 }), createSink(events));

      expect(result).toMatchObject({
        terminalState: 'completed',
        finalReport: 'done after runtime compaction',
      });
      expect(providerTurn).toHaveBeenCalledTimes(2);
      const secondMessages = vi.mocked(providerTurn).mock.calls[1][0].messages;
      expect(JSON.stringify(secondMessages)).not.toContain('large prior turn');
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'tool_call_progress',
            payload: expect.objectContaining({
              action: 'context_compaction_started',
            }),
          }),
          expect.objectContaining({
            type: 'tool_call_progress',
            payload: expect.objectContaining({
              action: 'context_compaction_finished',
            }),
          }),
        ])
      );
      expect(store.finishedTurns[1].providerDebug).toMatchObject({
        contextCompaction: expect.objectContaining({
          reason: 'hard_limit_exceeded_before_provider_call',
          retainedHistoryItems: 2,
        }),
      });
    } finally {
      restoreSettings();
    }
  });

  it('compacts again before calling an explicit fallback with a smaller context window', async () => {
    const restoreSettings = installRuntimeLlmSettings({
      ACTIVE_LLM_PROVIDER: 'azure',
      providerEndpoints: [
        {
          id: 'local-qwen',
          name: 'Local Qwen',
          kind: 'local',
          enabled: true,
          baseUrl: 'http://localhost:11434/v1',
          models: ['qwen3-coder'],
        },
        {
          id: 'azure-small',
          name: 'Azure Small',
          kind: 'azure',
          enabled: true,
          endpoint: 'https://example.openai.azure.com',
          apiVersion: '2024-05-01-preview',
          models: ['gpt-5-mini'],
          defaultModelCapability: {
            contextWindowTokens: 8192,
            safePromptBudgetTokens: 8192,
            reservedOutputTokens: 1024,
          },
        },
      ],
      roleRoutes: [
        {
          role: 'implementation',
          primary: {
            providerEndpointId: 'local-qwen',
            model: 'qwen3-coder',
          },
          fallbacks: [
            {
              providerEndpointId: 'azure-small',
              model: 'gpt-5-mini',
            },
          ],
        },
      ],
    });
    try {
      const largePriorAssistantContent = `large prior turn ${'x'.repeat(24_000)}`;
      const store = createFakeStore();
      const providerTurn = vi
        .fn()
        .mockResolvedValueOnce({
          type: 'supported',
          content: largePriorAssistantContent,
          toolCalls: [{ id: 'call-unknown', name: 'unknown_tool', arguments: {} }],
          usage: usage(),
          model: 'qwen3-coder',
        } satisfies ProviderToolTurnResult)
        .mockRejectedValueOnce(
          new Error(
            'OpenAI native tool call failed with status 400: {"error":{"code":"required_tool_call_missing"}}'
          )
        )
        .mockResolvedValueOnce({
          type: 'supported',
          content: 'ready after fallback compaction',
          toolCalls: [
            {
              id: 'call-final',
              name: 'finalize_answer',
              arguments: { finalReport: 'fallback done after compaction' },
            },
          ],
          usage: usage(),
          model: 'gpt-5-mini',
        } satisfies ProviderToolTurnResult);
      const events: AgentRuntimeEvent[] = [];
      const runner = new NativeApiRunner({
        store: store.instance,
        startupController: createNoopStartup(),
        providerTurn: providerTurn as unknown as NativeApiToolTurnProvider,
        usageRecorder: vi.fn(async () => undefined),
      });

      const result = await runner.run(buildContext({ timeoutSeconds: 360 }), createSink(events));

      expect(result).toMatchObject({
        terminalState: 'completed',
        finalReport: 'fallback done after compaction',
      });
      expect(providerTurn).toHaveBeenCalledTimes(3);
      expect(
        providerTurn.mock.calls.map((call) => ({
          providerEndpointId: call[0].options.normalizedRequest.providerEndpointId,
          messageText: JSON.stringify(call[0].messages),
        }))
      ).toEqual([
        expect.objectContaining({
          providerEndpointId: 'local-qwen',
          messageText: expect.not.stringContaining('large prior turn'),
        }),
        expect.objectContaining({
          providerEndpointId: 'local-qwen',
          messageText: expect.stringContaining('large prior turn'),
        }),
        expect.objectContaining({
          providerEndpointId: 'azure-small',
          messageText: expect.not.stringContaining('large prior turn'),
        }),
      ]);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'tool_call_progress',
            payload: expect.objectContaining({
              action: 'provider_route_fallback_started',
              to: expect.objectContaining({
                providerEndpointId: 'azure-small',
              }),
            }),
          }),
          expect.objectContaining({
            type: 'tool_call_progress',
            payload: expect.objectContaining({
              action: 'context_compaction_finished',
              contextCompaction: expect.objectContaining({
                previousHistoryItems: expect.any(Number),
              }),
            }),
          }),
        ])
      );
      expect(store.finishedTurns.at(-1)?.providerDebug).toMatchObject({
        contextCompaction: expect.objectContaining({
          reason: 'hard_limit_exceeded_before_provider_call',
        }),
      });
    } finally {
      restoreSettings();
    }
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

  it('records provider tool calls against the latest running Todo instead of stale startup context', async () => {
    (repo.listTaskRunTodosForRun as never).mockResolvedValue([
      {
        seq: 1,
        title: 'initial_instructions を実行する',
        taskType: 'initial_instructions',
        status: 'passed',
        procedureId: 'contextstill.initial_instructions',
      },
      {
        seq: 2,
        title: 'context_compile を実行する',
        taskType: 'context_compile',
        status: 'passed',
        procedureId: 'contextstill.context_compile',
      },
      {
        seq: 3,
        title: 'Implement Todo list UI',
        taskType: 'implementation',
        status: 'running',
        procedureId: null,
      },
    ]);
    const store = createFakeStore();
    const providerTurn = createProvider([
      {
        type: 'supported',
        content: 'inspect unknown path',
        toolCalls: [{ id: 'call-unknown', name: 'unknown_tool', arguments: {} }],
        usage: usage(),
        model: 'api-model',
      },
    ]);
    const runner = new NativeApiRunner({
      store: store.instance,
      startupController: createNoopStartup(),
      providerTurn,
      usageRecorder: vi.fn(async () => undefined),
    });

    await runner.run(
      buildContext({
        currentTodo: {
          id: 'todo-1',
          seq: 1,
          title: 'initial_instructions を実行する',
          taskType: 'initial_instructions',
          status: 'running',
          procedureId: 'contextstill.initial_instructions',
        },
      }),
      createSink()
    );

    expect(store.toolCalls[0]).toMatchObject({
      toolName: 'unknown_tool',
      todoSeq: 3,
    });
    expect(providerTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('title=Implement Todo list UI'),
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
      {
        type: 'supported',
        content: 'dispatcher failed before completion',
        toolCalls: [],
        usage: usage(),
        model: 'api-model',
      },
    ]);
    const runner = new NativeApiRunner({
      store: store.instance,
      startupController: createNoopStartup(),
      providerTurn,
      usageRecorder: vi.fn(async () => undefined),
    });

    const result = await runner.run(buildContext(), createSink());

    expect(result).toMatchObject({
      terminalState: 'needs_human',
      stoppedBy: 'missing_tool_call',
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
        todoListReplaceReason: {
          enum: [
            'initial_plan',
            'scope_changed',
            'estimate_changed',
            'newly_required_work',
            'blocked_replan',
          ],
        },
      },
    });
  });

  it('restricts model-visible tools in planning mode', () => {
    const toolNames = getNativeApiToolDefinitions({
      executionMode: 'planning',
    }).map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        'read_current_specification',
        'list_dir',
        'read_file',
        'search_files',
        'git_status',
        'list_mcp_tools',
        'context_initial_instructions',
        'context_compile',
        'context_decision',
        'new_context',
        'finalize_answer',
      ])
    );
    expect(toolNames).not.toContain('apply_patch');
    expect(toolNames).not.toContain('replace_content');
    expect(toolNames).not.toContain('import_project');
    expect(toolNames).not.toContain('run_verification');
    expect(toolNames).not.toContain('todo_list');
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

  it('exposes compile_eval with the contextStill-required closeout fields', () => {
    const compileEvalTool = getNativeApiToolDefinitions().find(
      (tool) => tool.name === 'compile_eval'
    );

    expect(compileEvalTool?.inputSchema).toMatchObject({
      required: [
        'actionability',
        'body',
        'clarity',
        'coverage',
        'outcome',
        'relevance',
        'specificity',
      ],
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

  it('rejects mutating tools in planning mode even if the provider asks for them', async () => {
    const result = await dispatchNativeApiToolCall({
      toolCall: {
        id: 'call-patch',
        name: 'apply_patch',
        arguments: { patchContent: '*** Begin Patch\n*** End Patch\n' },
      },
      context: buildContext({ runtimeOptions: { executionMode: 'planning' } }),
      sink: createSink(),
      state: { readFiles: [], specificationRead: true },
    });

    expect(result.kind).toBe('continue');
    expect(result.toolResult).toMatchObject({
      ok: false,
      error: {
        code: 'TOOL_NOT_ALLOWED_FOR_MODE',
      },
    });
  });

  it('includes original tool arguments in native/api worker tool finished events', async () => {
    const events: AgentRuntimeEvent[] = [];
    const result = await dispatchNativeApiToolCall({
      toolCall: {
        id: 'call-read-file',
        name: 'read_file',
        arguments: {
          filePath: 'package.json',
          startLine: 1,
          endLine: 5,
          compressionMode: 'off',
        },
      },
      context: buildContext(),
      sink: createSink(events),
      state: { readFiles: [], specificationRead: true },
    });

    expect(result.kind).toBe('continue');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool_call_finished',
          payload: expect.objectContaining({
            callId: 'call-read-file',
            toolName: 'read_file',
            arguments: expect.objectContaining({
              filePath: 'package.json',
              startLine: 1,
              endLine: 5,
            }),
            ok: true,
            result: expect.objectContaining({
              totalLines: expect.any(Number),
              linesReturned: 5,
            }),
          }),
        }),
      ])
    );
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

  it('rejects empty context_decision input before any MCP dispatch', async () => {
    const result = await dispatchNativeApiToolCall({
      toolCall: {
        id: 'call-decision',
        name: 'context_decision',
        arguments: {},
      },
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

  it('blocks context_initial_instructions until read_current_specification has succeeded', async () => {
    const result = await dispatchNativeApiToolCall({
      toolCall: {
        id: 'call-initial',
        name: 'context_initial_instructions',
        arguments: {},
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

  it('returns actionable Todo recovery hints when finalize_answer is blocked by open Todos', async () => {
    (repo.listTaskRunTodosForRun as never).mockResolvedValue([
      {
        seq: 3,
        title: 'Implement Todo list UI',
        taskType: 'implementation',
        status: 'running',
        procedureId: null,
      },
      {
        seq: 4,
        title: 'Verify Todo list UI',
        taskType: 'verification',
        status: 'pending',
        procedureId: 'quality_gate_verify',
      },
    ]);

    const result = await dispatchNativeApiToolCall({
      toolCall: {
        id: 'call-final',
        name: 'finalize_answer',
        arguments: { finalReport: 'done' },
      },
      context: buildContext(),
      sink: createSink(),
      state: { readFiles: [], specificationRead: true },
    });

    expect(result.kind).toBe('continue');
    expect(result.toolResult).toMatchObject({
      ok: false,
      error: {
        code: 'OPEN_TODOS_REMAIN',
        details: {
          nextAction: {
            operation: 'done',
            seq: 3,
            example: 'todo_list operation=done seq=3',
          },
        },
      },
      payload: {
        openTodos: [
          expect.objectContaining({
            seq: 3,
            title: 'Implement Todo list UI',
          }),
          expect.objectContaining({
            seq: 4,
            title: 'Verify Todo list UI',
          }),
        ],
      },
    });
    expect(result.toolResult.content).toContain('todo_list operation=done seq=3');
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
  return {
    instance,
    turns,
    finishedTurns,
    toolCalls,
    runningToolCalls,
    finishedToolCalls,
  };
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

function installRuntimeLlmSettings(settings: Record<string, unknown>) {
  const previousPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-llm-settings-'));
  const settingsPath = path.join(dir, 'llm-settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify(settings));
  process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = settingsPath;
  return () => {
    if (previousPath === undefined) {
      delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
    } else {
      process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = previousPath;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  };
}
