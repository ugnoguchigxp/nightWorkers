import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ThreadEvent } from '@openai/codex-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getNightWorkersCodexToolNames } from '../api/mcp/nightworkers-tool-manifest';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import {
  buildCodexRuntimePrompt,
  CodexAgentRuntime,
} from '../api/services/agent-runtime/CodexAgentRuntime';
import { CODEX_CONTRACT_WARNING_CATALOG } from '../api/services/agent-runtime/codex-contract-warning-catalog';
import {
  createCodexEventMapperState,
  mapCodexThreadEvent,
  redactProviderEvent,
} from '../api/services/agent-runtime/codex-event-mapper';
import {
  buildCodexRuntimeSdkOptions,
  buildCodexRuntimeThreadOptions,
  resolveCodexRuntimeMcpConfigState,
} from '../api/services/agent-runtime/codex-runtime-config';

const execFileAsync = promisify(execFile);

vi.mock('../api/modules/nightworkers/nightworkers.repository', () => ({
  listTaskRunTodosForRun: vi.fn(),
}));

describe('CodexAgentRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repo.listTaskRunTodosForRun).mockRejectedValue(new Error('todo db unavailable'));
  });

  it('builds runtime Codex options without structured provider feature suppression', () => {
    const options = buildCodexRuntimeSdkOptions({
      accessToken: 'runtime-token',
      env: {
        PATH: '/usr/bin',
        CODEX_THREAD_ID: 'parent-thread',
        CODEX_SHELL: '1',
        NIGHTWORKERS_CODEX_MCP_COMMAND: '/bin/nightworkers-mcp',
        NIGHTWORKERS_CODEX_MCP_ARGS: '--stdio',
        NIGHTWORKERS_TASK_ID: 'task-codex',
        NIGHTWORKERS_RUN_ID: 'run-codex',
        DATABASE_URL: 'file:/tmp/nightworkers.sqlite',
        JWT_SECRET: 'secret-with-enough-length-for-tests',
        NIGHTWORKERS_DESKTOP: '1',
        NIGHTWORKERS_RUNTIME_DIR: '/tmp/nightworkers-runtime',
      } as never,
    });

    expect(options.config).toMatchObject({
      features: { mcp: true },
      mcp_servers: {
        nightworkers: {
          command: '/bin/nightworkers-mcp',
          args: ['--stdio'],
          tools: {
            read_current_specification: { approval_mode: 'approve' },
            list_recent_specifications: { approval_mode: 'approve' },
            todo_list: { approval_mode: 'approve' },
            import_project: { approval_mode: 'approve' },
          },
          env: {
            DATABASE_URL: 'file:/tmp/nightworkers.sqlite',
            JWT_SECRET: 'secret-with-enough-length-for-tests',
            NIGHTWORKERS_DESKTOP: '1',
            NIGHTWORKERS_RUNTIME_DIR: '/tmp/nightworkers-runtime',
            NIGHTWORKERS_TASK_ID: 'task-codex',
            NIGHTWORKERS_RUN_ID: 'run-codex',
          },
        },
      },
    });
    expect(options.env).toMatchObject({
      PATH: '/usr/bin',
      CODEX_ACCESS_TOKEN: 'runtime-token',
    });
    expect(options.env?.CODEX_THREAD_ID).toBeUndefined();
    expect(options.env?.CODEX_SHELL).toBeUndefined();
  });

  it('leaves global Codex MCP settings available when no inline NightWorkers MCP command is configured', () => {
    const options = buildCodexRuntimeSdkOptions({
      accessToken: 'runtime-token',
      env: {
        PATH: '/usr/bin',
        CODEX_THREAD_ID: 'parent-thread',
      } as never,
    });

    expect(options.config).toBeUndefined();
    expect(options.env).toMatchObject({
      PATH: '/usr/bin',
      CODEX_ACCESS_TOKEN: 'runtime-token',
    });
    expect(options.env?.CODEX_THREAD_ID).toBeUndefined();
  });

  it('resolves Codex MCP config source without disabling global inheritance', () => {
    expect(
      resolveCodexRuntimeMcpConfigState({
        env: { NIGHTWORKERS_CODEX_MCP_COMMAND: '/bin/nightworkers-mcp' } as never,
      })
    ).toMatchObject({
      source: 'inline_configured',
      hasInlineNightWorkersMcp: true,
      serverName: 'nightworkers',
      expectedTools: getNightWorkersCodexToolNames(),
    });
    expect(resolveCodexRuntimeMcpConfigState({ env: {} as never })).toMatchObject({
      source: 'global_inherited',
      hasInlineNightWorkersMcp: false,
    });
    expect(resolveCodexRuntimeMcpConfigState({ enableNightworkersMcp: false })).toMatchObject({
      source: 'disabled',
      hasInlineNightWorkersMcp: false,
    });
  });

  it('can explicitly disable MCP for Codex runtime', () => {
    const options = buildCodexRuntimeSdkOptions({
      enableNightworkersMcp: false,
      env: { PATH: '/usr/bin' } as never,
    });

    expect(options.config).toMatchObject({
      features: { mcp: false },
      mcp_servers: {},
    });
  });

  it('builds runtime thread options from the repository root', () => {
    const options = buildCodexRuntimeThreadOptions(
      buildContext({
        repoRoot: '/repo/project',
        codex: { model: 'gpt-5.3-codex', thinkingDepth: 'very_high' },
      })
    );

    expect(options).toMatchObject({
      model: 'gpt-5.3-codex',
      modelReasoningEffort: 'xhigh',
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never',
      networkAccessEnabled: false,
      webSearchMode: 'disabled',
      skipGitRepoCheck: true,
      workingDirectory: '/repo/project',
    });
  });

  it('adds NightWorkers MCP planning guidance to the Codex runtime prompt', () => {
    const prompt = buildCodexRuntimePrompt(
      buildContext({
        latestUserMessage: '実装計画書を作ってください',
      })
    );

    expect(prompt).toContain('実装計画書を作ってください');
    expect(prompt).toContain('[NightWorkers Runtime Contract]');
    expect(prompt).toContain('taskId: task-codex');
    expect(prompt).toContain('runId: run-codex');
    expect(prompt).toContain('context-still.initial_instructions');
    expect(prompt).toContain(getNightWorkersCodexToolNames().join(', '));
    expect(prompt).toContain('nightworkers.todo_list');
    expect(prompt).toContain('operation=replace');
    expect(prompt).toContain('operation=done');
    expect(prompt).toContain('Minimal implementation behavior:');
    expect(prompt).toContain('計画文書で止まらず、必要最小限の確認後に実装へ進む');
    expect(prompt).toContain('詳細な implementation-plan artifact を作らない');
    expect(prompt).toContain('LLM コードレビュー、品質ゲート verify、closeout は省略しない');
    expect(prompt).toContain('小さいコード変更で仕様 artifact がないことだけを理由に停止しない');
    expect(prompt).toContain(
      'Execution order: specification -> Todo execution -> verification -> closeout.'
    );
    expect(prompt).toContain('Planning is not closeout');
    expect(prompt).toContain('do not call context-still.compile_eval');
    expect(prompt).toContain(
      'closeout starts only after implementation and verification are genuinely finished'
    );
    expect(prompt).toContain('nightworkers.read_current_specification');
    expect(prompt).toContain('nightworkers.list_recent_specifications');
    expect(prompt).toContain('For explicit planning, implementation-plan, specification');
    expect(prompt).toContain('implementation work grounded in an existing specification');
    expect(prompt).toContain('nightworkers.import_project');
    expect(prompt).not.toContain('nightworkers.materialize_template');
    expect(prompt).not.toContain('nightworkers.clone_git_repo');
    expect(prompt).not.toContain('nightworkers.run_command');
    expect(prompt).not.toContain('nightworkers.run_verification');
    expect(prompt).toContain('source=starter, stack=hono');
    expect(prompt).toContain('default SQLite variant');
    expect(prompt).toContain('Codex native command_execution events');
    expect(prompt).toContain('Do not create a fallback static app');
    expect(prompt).toContain('do not stop with a plan-only answer or next-steps summary');
  });

  it('passes the composed runtime prompt to Codex threads', async () => {
    const thread = fakeThread([
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
    ]);
    const runtime = new CodexAgentRuntime({
      threadFactory: () => thread,
    });

    await runtime.start(buildContext({ latestUserMessage: '仕様に沿って計画して' }), {
      emit: async () => {},
    });

    expect(thread.runStreamed).toHaveBeenCalledWith(
      expect.stringContaining('nightworkers.read_current_specification'),
      expect.any(Object)
    );
  });

  it('maps a fake assistant turn into runtime ledger events', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          { type: 'thread.started', thread_id: 'codex-thread-1' },
          { type: 'turn.started' },
          {
            type: 'item.updated',
            item: { id: 'item-1', type: 'agent_message', text: 'hello' },
          },
          {
            type: 'item.completed',
            item: { id: 'item-1', type: 'agent_message', text: 'hello world' },
          },
          {
            type: 'turn.completed',
            usage: {
              input_tokens: 10,
              cached_input_tokens: 2,
              output_tokens: 3,
              reasoning_output_tokens: 1,
            },
          },
        ]),
    });
    const events: unknown[] = [];

    const result = await runtime.start(buildContext(), {
      emit: async (event) => {
        events.push(event);
      },
    });

    expect(result.terminalState).toBe('completed');
    expect(result.finalReport).toBe('hello world');
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'runtime_started',
        'turn_started',
        'model_response_delta',
        'model_response_finished',
        'runtime_finished',
      ])
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'runtime_started',
          payload: expect.objectContaining({
            runtimeContract: expect.objectContaining({
              lane: 'codex-sdk',
              mcp: expect.objectContaining({
                configSource: expect.any(String),
                expectedTools: expect.arrayContaining(['nightworkers.import_project']),
              }),
            }),
          }),
        }),
      ])
    );
  });

  it('emits contract warning and Todo evidence for file_change before Todo replace', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'file-before-todo',
              type: 'file_change',
              status: 'completed',
              changes: [{ path: 'src/app.ts' }],
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });
    const events: unknown[] = [];

    const result = await runtime.start(
      buildContext({
        currentTodo: {
          id: 'todo-1',
          seq: 1,
          title: '実装する',
          taskType: 'implementation',
          status: 'running',
          procedureId: 'implementation',
        },
      }),
      {
        emit: async (event) => {
          events.push(event);
        },
      }
    );

    expect(result.contractWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'codex_file_change_before_todo_replace',
          providerItemId: 'file-before-todo',
          todoId: 'todo-1',
          todoSeq: 1,
          changedFiles: ['src/app.ts'],
        }),
      ])
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'runtime_warning',
          payload: expect.objectContaining({ code: 'codex_file_change_before_todo_replace' }),
        }),
        expect.objectContaining({
          type: 'diff_collected',
          payload: expect.objectContaining({
            changedFiles: ['src/app.ts'],
            todoId: 'todo-1',
            todoSeq: 1,
            todoTitle: '実装する',
          }),
        }),
      ])
    );
  });

  it('aggregates repeated contract warnings while preserving first occurrence metadata', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'file-repeat',
              type: 'file_change',
              status: 'completed',
              changes: [{ path: 'src/app.ts' }],
            },
          },
          {
            type: 'item.completed',
            item: {
              id: 'file-repeat',
              type: 'file_change',
              status: 'completed',
              changes: [{ path: 'src/app.ts' }],
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(
      buildContext({
        currentTodo: {
          id: 'todo-1',
          seq: 1,
          title: '実装する',
          taskType: 'implementation',
          status: 'running',
          procedureId: 'implementation',
        },
      }),
      { emit: async () => {} }
    );

    const warning = result.contractWarnings?.find(
      (item) => item.code === 'codex_file_change_before_todo_replace'
    );
    expect(warning).toEqual(
      expect.objectContaining({
        providerItemId: 'file-repeat',
        changedFiles: ['src/app.ts'],
        sequence: expect.any(Number),
        occurredAt: expect.any(String),
        count: 2,
      })
    );
  });

  it('keeps repeated contract warnings separate when changed files differ', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'file-repeat',
              type: 'file_change',
              status: 'completed',
              changes: [{ path: 'src/app.ts' }],
            },
          },
          {
            type: 'item.completed',
            item: {
              id: 'file-repeat',
              type: 'file_change',
              status: 'completed',
              changes: [{ path: 'src/other.ts' }],
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(
      buildContext({
        currentTodo: {
          id: 'todo-1',
          seq: 1,
          title: '実装する',
          taskType: 'implementation',
          status: 'running',
          procedureId: 'implementation',
        },
      }),
      { emit: async () => {} }
    );

    const warnings =
      result.contractWarnings?.filter(
        (item) => item.code === 'codex_file_change_before_todo_replace'
      ) ?? [];
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ changedFiles: ['src/app.ts'], count: 1 }),
        expect.objectContaining({ changedFiles: ['src/other.ts'], count: 1 }),
      ])
    );
  });

  it('prefers DB running Todo evidence over stale runtime context for file_change', async () => {
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([
      {
        id: 'todo-1',
        runId: 'run-codex',
        seq: 1,
        title: '古い Todo',
        taskType: 'implementation',
        status: 'passed',
      },
      {
        id: 'todo-2',
        runId: 'run-codex',
        seq: 2,
        title: '現在の Todo',
        taskType: 'implementation',
        status: 'running',
        procedureId: 'implementation',
      },
    ] as never);
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'file-db-todo',
              type: 'file_change',
              status: 'completed',
              changes: [{ path: 'src/app.ts' }],
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });
    const events: unknown[] = [];

    const result = await runtime.start(
      buildContext({
        currentTodo: {
          id: 'todo-1',
          seq: 1,
          title: '古い Todo',
          taskType: 'implementation',
          status: 'running',
        },
      }),
      {
        emit: async (event) => {
          events.push(event);
        },
      }
    );

    expect(result.contractWarnings ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'codex_todo_evidence_db_read_failed' }),
      ])
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'diff_collected',
          payload: expect.objectContaining({
            providerItemId: 'file-db-todo',
            todoId: 'todo-2',
            todoSeq: 2,
            todoTitle: '現在の Todo',
          }),
        }),
      ])
    );
  });

  it('does not fall back to stale context when DB has no running Todo', async () => {
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'file-no-db-todo',
              type: 'file_change',
              status: 'completed',
              changes: [{ path: 'src/app.ts' }],
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(
      buildContext({
        currentTodo: {
          id: 'todo-1',
          seq: 1,
          title: '古い Todo',
          taskType: 'implementation',
          status: 'running',
        },
      }),
      { emit: async () => {} }
    );

    expect(result.contractWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'codex_file_change_without_current_todo',
          providerItemId: 'file-no-db-todo',
        }),
      ])
    );
    expect(result.contractWarnings ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'codex_todo_evidence_db_read_failed' }),
      ])
    );
  });

  it('falls back to runtime Todo context only when DB Todo evidence cannot be read', async () => {
    vi.mocked(repo.listTaskRunTodosForRun).mockRejectedValue(new Error('SQLITE_BUSY'));
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'file-db-throw',
              type: 'file_change',
              status: 'completed',
              changes: [{ path: 'src/app.ts' }],
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });
    const events: unknown[] = [];

    const result = await runtime.start(
      buildContext({
        currentTodo: {
          id: 'todo-fallback',
          seq: 3,
          title: 'fallback Todo',
          taskType: 'implementation',
          status: 'running',
        },
      }),
      {
        emit: async (event) => {
          events.push(event);
        },
      }
    );

    expect(result.contractWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'codex_todo_evidence_db_read_failed',
          providerItemId: 'file-db-throw',
          todoId: 'todo-fallback',
          todoSeq: 3,
          todoEvidenceSource: 'context',
        }),
      ])
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'diff_collected',
          payload: expect.objectContaining({
            providerItemId: 'file-db-throw',
            todoId: 'todo-fallback',
            todoSeq: 3,
          }),
        }),
      ])
    );
  });

  it('does not emit the pre-replace file_change warning after todo_list replace', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'todo-replace',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'todo_list',
              arguments: { operation: 'replace', todos: [{ seq: 1, title: '実装' }] },
              status: 'completed',
              result: { ok: true },
            },
          },
          {
            type: 'item.completed',
            item: {
              id: 'file-after-todo',
              type: 'file_change',
              status: 'completed',
              changes: [{ path: 'src/app.ts' }],
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(
      buildContext({
        currentTodo: {
          id: 'todo-1',
          seq: 1,
          title: '実装',
          taskType: 'implementation',
          status: 'running',
        },
      }),
      { emit: async () => {} }
    );

    expect(result.contractWarnings ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'codex_file_change_before_todo_replace' }),
      ])
    );
  });

  it('records Codex turn usage through the shared LLM usage recorder', async () => {
    const usageRecorder = vi.fn(async (input) => ({ id: 'usage-record', ...input }) as never);
    const runtime = new CodexAgentRuntime({
      persistRuntimeUsage: true,
      usageRecorder,
      threadFactory: () =>
        fakeThread([
          {
            type: 'turn.completed',
            usage: {
              input_tokens: 1200,
              cached_input_tokens: 300,
              output_tokens: 45,
              reasoning_output_tokens: 6,
            },
          },
        ]),
    });

    await runtime.start(
      buildContext({
        codex: { model: 'gpt-5.3-codex' },
        conversationContextUsage: {
          latestUserMessageTokens: 10,
          stateCardTokens: 20,
          runtimeUserPromptTokens: 30,
        },
      }),
      { emit: async () => {} }
    );

    expect(usageRecorder).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-codex',
        runId: 'run-codex',
        provider: 'codex',
        model: 'gpt-5.3-codex',
        label: 'codex-runtime',
        usage: expect.objectContaining({
          inputTokens: 1200,
          outputTokens: 45,
          cachedInputTokens: 300,
          reasoningOutputTokens: 6,
          totalTokens: 1245,
          mode: 'measured',
          rawUsage: {
            input_tokens: 1200,
            cached_input_tokens: 300,
            output_tokens: 45,
            reasoning_output_tokens: 6,
          },
        }),
        promptPartTokenEstimates: {
          latestUserMessageTokens: 10,
          stateCardTokens: 20,
          userPromptTokens: 30,
        },
      })
    );
  });

  it('returns cancelled when the run is stopped before the stream starts', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () => fakeThread([{ type: 'turn.started' }]),
    });
    await runtime.stop('run-codex');

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.terminalState).toBe('cancelled');
    expect(result.stoppedBy).toBe('cancelled');
  });

  it('maps runtime failure to failed result and runtime_error event', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () => fakeThread([{ type: 'turn.failed', error: { message: 'boom' } }]),
    });
    const events: unknown[] = [];

    const result = await runtime.start(buildContext(), {
      emit: async (event) => {
        events.push(event);
      },
    });

    expect(result.terminalState).toBe('failed');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'runtime_error',
          payload: expect.objectContaining({ error: 'boom' }),
        }),
      ])
    );
  });

  it('fails once for provider-cancelled project import and records transport diagnostics', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: vi.fn().mockReturnValue(
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'mcp-template-1',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'import_project',
              arguments: { source: 'starter', stack: 'hono', variant: 'sqlite' },
              status: 'failed',
              error: { message: 'user cancelled MCP tool call' },
            },
          },
          {
            type: 'item.completed',
            item: {
              id: 'file-after-template-failure',
              type: 'file_change',
              status: 'completed',
              changes: [{ path: 'index.html' }],
            },
          },
        ] as never)
      ),
    });
    const events: unknown[] = [];

    const result = await runtime.start(buildContext(), {
      emit: async (event) => {
        events.push(event);
      },
    });

    expect(result.terminalState).toBe('needs_human');
    expect(result.stoppedBy).toBe('tool_failure');
    expect(result.finalReport).toContain(
      'Project import failed before the MCP server returned a tool result: user cancelled MCP tool call'
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'runtime_error',
          payload: expect.objectContaining({
            providerItemId: 'mcp-template-1',
            reason: 'project_import_transport_cancelled',
          }),
        }),
        expect.objectContaining({
          type: 'runtime_finished',
          payload: expect.objectContaining({
            terminalState: 'needs_human',
            stoppedBy: 'tool_failure',
          }),
        }),
      ])
    );
    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'diff_collected',
          payload: expect.objectContaining({ changedFiles: ['index.html'] }),
        }),
      ])
    );
  });

  it('treats explicit cancelled project import status as cancelled', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'mcp-template',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'import_project',
              arguments: { source: 'starter', stack: 'hono', variant: 'sqlite' },
              status: 'cancelled',
            },
          },
        ] as never),
    });
    const events: unknown[] = [];

    const result = await runtime.start(buildContext(), {
      emit: async (event) => {
        events.push(event);
      },
    });

    expect(result.terminalState).toBe('cancelled');
    expect(result.stoppedBy).toBe('cancelled');
    expect(result.finalReport).toContain('Project import was cancelled');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'runtime_finished',
          payload: expect.objectContaining({
            terminalState: 'cancelled',
            stoppedBy: 'cancelled',
          }),
        }),
      ])
    );
  });

  it('warns when import_project succeeds with recommended verification but no evidence', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'import-1',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'import_project',
              arguments: { source: 'starter', stack: 'hono' },
              status: 'completed',
              result: {
                ok: true,
                postImport: {
                  manifest: {
                    recommendedVerificationCommands: ['bun run verify:base'],
                  },
                  initialization: { ok: true },
                  llmContext: 'Use Hono starter',
                },
              },
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.contractWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'codex_import_project_verification_missing',
          providerItemId: 'import-1',
          toolName: 'nightworkers.import_project',
        }),
      ])
    );
  });

  it('does not let pre-import verification evidence satisfy post-import verification', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'cmd-pre-import',
              type: 'command_execution',
              command: 'bun run typecheck',
              aggregated_output: 'ok',
              exit_code: 0,
              status: 'completed',
            },
          },
          {
            type: 'item.completed',
            item: {
              id: 'import-1',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'import_project',
              arguments: { source: 'starter', stack: 'hono' },
              status: 'completed',
              result: {
                ok: true,
                postImport: {
                  manifest: {
                    recommendedVerificationCommands: ['bun run verify:base'],
                  },
                },
              },
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.contractWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'codex_import_project_verification_missing',
          providerItemId: 'import-1',
        }),
      ])
    );
  });

  it('warns when post-import verification command fails', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'import-1',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'import_project',
              arguments: { source: 'starter', stack: 'hono' },
              status: 'completed',
              result: {
                ok: true,
                postImport: {
                  manifest: {
                    recommendedVerificationCommands: ['bun run verify:base'],
                  },
                },
              },
            },
          },
          {
            type: 'item.completed',
            item: {
              id: 'cmd-verify',
              type: 'command_execution',
              command: 'bun run verify:base',
              aggregated_output: 'failed',
              exit_code: 1,
              status: 'failed',
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.contractWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'codex_import_project_verification_missing',
          providerItemId: 'import-1',
        }),
      ])
    );
  });

  it('does not require post-import verification when no commands are recommended', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'import-1',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'import_project',
              arguments: { source: 'starter', stack: 'hono' },
              status: 'completed',
              result: {
                ok: true,
                postImport: {
                  manifest: {
                    recommendedVerificationCommands: [],
                  },
                },
              },
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.contractWarnings ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'codex_import_project_verification_missing' }),
      ])
    );
  });

  it('reads import_project verification recommendations from MCP structuredContent payload', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'import-structured',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'import_project',
              arguments: { source: 'starter', stack: 'hono' },
              status: 'completed',
              result: {
                structuredContent: {
                  payload: {
                    mode: 'template',
                    template: { templateId: 'hono-standard' },
                    git: null,
                    postImport: {
                      manifest: {
                        recommendedVerificationCommands: ['bun run verify:base'],
                      },
                    },
                  },
                },
                content: [{ type: 'text', text: '{"ignored":true}' }],
              },
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.contractWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'codex_import_project_verification_missing',
          providerItemId: 'import-structured',
        }),
      ])
    );
  });

  it('hard-gates import_project MCP error results even when item status is completed', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'import-error-content',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'import_project',
              arguments: { source: 'starter', stack: 'hono' },
              status: 'completed',
              result: {
                isError: true,
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      error: {
                        code: 'TASK_REPOSITORY_NOT_FOUND',
                        message: 'Cannot resolve repository.',
                      },
                      payload: { mode: '', template: null, git: null, postImport: null },
                    }),
                  },
                ],
              },
            },
          },
          {
            type: 'item.completed',
            item: {
              id: 'file-after-import-error',
              type: 'file_change',
              status: 'completed',
              changes: [{ path: 'index.html' }],
            },
          },
        ] as never),
    });
    const events: unknown[] = [];

    const result = await runtime.start(buildContext(), {
      emit: async (event) => {
        events.push(event);
      },
    });

    expect(result.terminalState).toBe('needs_human');
    expect(result.finalReport).toContain('Cannot resolve repository.');
    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'diff_collected',
          payload: expect.objectContaining({ changedFiles: ['index.html'] }),
        }),
      ])
    );
  });

  it('accepts successful verification command evidence after import_project', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'import-1',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'import_project',
              arguments: { source: 'starter', stack: 'hono' },
              status: 'completed',
              result: {
                ok: true,
                postImport: {
                  manifest: {
                    recommendedVerificationCommands: ['bun run verify:base'],
                  },
                },
              },
            },
          },
          {
            type: 'item.completed',
            item: {
              id: 'cmd-verify',
              type: 'command_execution',
              command: 'bun run verify:base',
              aggregated_output: 'ok',
              exit_code: 0,
              status: 'completed',
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.contractWarnings ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'codex_import_project_verification_missing' }),
        expect.objectContaining({
          code: 'codex_import_project_recommended_verification_mismatch',
        }),
      ])
    );
  });

  it('accepts same-runner shorthand verification command evidence after import_project', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'import-1',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'import_project',
              arguments: { source: 'starter', stack: 'hono' },
              status: 'completed',
              result: {
                ok: true,
                postImport: {
                  manifest: {
                    recommendedVerificationCommands: ['bun run verify:base'],
                  },
                },
              },
            },
          },
          {
            type: 'item.completed',
            item: {
              id: 'cmd-verify',
              type: 'command_execution',
              command: 'bun verify:base',
              aggregated_output: 'ok',
              exit_code: 0,
              status: 'completed',
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.contractWarnings ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'codex_import_project_verification_missing' }),
        expect.objectContaining({
          code: 'codex_import_project_recommended_verification_mismatch',
        }),
      ])
    );
  });

  it('warns when successful post-import verification does not match recommended commands', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'import-1',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'import_project',
              arguments: { source: 'starter', stack: 'hono' },
              status: 'completed',
              result: {
                ok: true,
                postImport: {
                  manifest: {
                    recommendedVerificationCommands: ['bun run verify:base'],
                  },
                },
              },
            },
          },
          {
            type: 'item.completed',
            item: {
              id: 'cmd-typecheck',
              type: 'command_execution',
              command: 'bun run typecheck',
              aggregated_output: 'ok',
              exit_code: 0,
              status: 'completed',
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.terminalState).toBe('completed');
    expect(result.contractWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'codex_import_project_recommended_verification_mismatch',
          severity: 'warning',
          providerItemId: 'import-1',
          command: 'bun run typecheck',
        }),
      ])
    );
    expect(result.contractWarnings ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'codex_import_project_verification_missing' }),
      ])
    );
  });

  it('accepts any one recommended verification command match after import_project', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'import-1',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'import_project',
              arguments: { source: 'starter', stack: 'hono' },
              status: 'completed',
              result: {
                ok: true,
                postImport: {
                  manifest: {
                    recommendedVerificationCommands: ['bun run verify:base', 'bun run typecheck'],
                  },
                },
              },
            },
          },
          {
            type: 'item.completed',
            item: {
              id: 'cmd-typecheck',
              type: 'command_execution',
              command: 'bun run typecheck',
              aggregated_output: 'ok',
              exit_code: 0,
              status: 'completed',
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.contractWarnings ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'codex_import_project_verification_missing' }),
        expect.objectContaining({
          code: 'codex_import_project_recommended_verification_mismatch',
        }),
      ])
    );
  });

  it('requires human review when native import completes without import_project success', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'cmd-clone',
              type: 'command_execution',
              command: 'git clone https://example.test/repo.git .',
              aggregated_output: 'ok',
              exit_code: 0,
              status: 'completed',
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.terminalState).toBe('needs_human');
    expect(result.stoppedBy).toBe('tool_failure');
    expect(result.riskLevel).toBe('high');
    expect(result.finalReport).toContain('without nightworkers.import_project success');
    expect(result.contractWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'codex_high_risk_native_import_command',
          severity: 'error',
          providerItemId: 'cmd-clone',
        }),
        expect.objectContaining({
          code: 'codex_native_import_without_import_project',
          severity: 'error',
          providerItemId: 'cmd-clone',
        }),
      ])
    );
  });

  it('keeps completed terminal state when native import follows import_project success', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'import-1',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'import_project',
              arguments: { source: 'git', repoUrl: 'https://example.test/repo.git' },
              status: 'completed',
              result: {
                ok: true,
                postImport: {
                  manifest: {
                    recommendedVerificationCommands: [],
                  },
                },
              },
            },
          },
          {
            type: 'item.completed',
            item: {
              id: 'cmd-clone',
              type: 'command_execution',
              command: 'git clone https://example.test/fixture.git fixture',
              aggregated_output: 'ok',
              exit_code: 0,
              status: 'completed',
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.terminalState).toBe('completed');
    expect(result.contractWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'codex_high_risk_native_import_command',
          severity: 'error',
          providerItemId: 'cmd-clone',
        }),
      ])
    );
    expect(result.contractWarnings ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'codex_native_import_without_import_project' }),
      ])
    );
  });

  it('does not hard-gate normal verification commands as native import', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'cmd-test',
              type: 'command_execution',
              command: 'bun run typecheck',
              aggregated_output: 'ok',
              exit_code: 0,
              status: 'completed',
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.terminalState).toBe('completed');
    expect(result.contractWarnings ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'codex_native_import_without_import_project' }),
      ])
    );
  });

  it('maps command and MCP activity without rejecting provider activity', () => {
    const state = createCodexEventMapperState();
    const commandEvents = mapCodexThreadEvent(
      {
        type: 'item.completed',
        item: {
          id: 'cmd-1',
          type: 'command_execution',
          command: 'pnpm test',
          aggregated_output: 'ok',
          exit_code: 0,
          status: 'completed',
        },
      },
      state
    );
    const mcpEvents = mapCodexThreadEvent(
      {
        type: 'item.completed',
        item: {
          id: 'mcp-1',
          type: 'mcp_tool_call',
          server: 'nightworkers',
          tool: 'get_task_context',
          arguments: { taskId: 'task-1', Authorization: 'Bearer secret' },
          status: 'completed',
        },
      },
      state
    );

    expect(commandEvents[0]).toMatchObject({
      type: 'tool_call_finished',
      payload: {
        command: 'pnpm test',
        commandClass: 'verification',
        aggregatedOutput: 'ok',
        exitCode: 0,
      },
    });
    expect(mcpEvents[0]).toMatchObject({
      type: 'tool_call_finished',
      payload: {
        toolName: 'nightworkers.get_task_context',
        mcpServer: 'nightworkers',
        mcpTool: 'get_task_context',
        arguments: { taskId: 'task-1', Authorization: '[REDACTED]' },
      },
    });
  });

  it('keeps manifest, prompt, and MCP expected tool names in sync', () => {
    const tools = getNightWorkersCodexToolNames();
    const prompt = buildCodexRuntimePrompt(buildContext());
    const mcpConfig = resolveCodexRuntimeMcpConfigState();

    expect(prompt).toContain(`Available NightWorkers MCP tools in this lane: ${tools.join(', ')}.`);
    expect(mcpConfig.expectedTools).toEqual(tools);
  });

  it('keeps emitted Codex contract warning codes documented in the read-only catalog', async () => {
    const source = await readFile('api/services/agent-runtime/CodexAgentRuntime.ts', 'utf8');
    const emittedCodes = [...source.matchAll(/code: '(codex_[^']+)'/g)].map((match) => match[1]);

    expect(new Set(emittedCodes)).toEqual(new Set(Object.keys(CODEX_CONTRACT_WARNING_CATALOG)));
    expect(
      Object.values(CODEX_CONTRACT_WARNING_CATALOG).every(
        (entry) => entry.description.length > 0 && entry.terminalPolicy.length > 0
      )
    ).toBe(true);
  });

  it('warns for NightWorkers MCP tools outside the manifest helper list', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          {
            type: 'item.completed',
            item: {
              id: 'unexpected-tool',
              type: 'mcp_tool_call',
              server: 'nightworkers',
              tool: 'run_command',
              arguments: { command: 'pwd' },
              status: 'completed',
              result: { ok: true },
            },
          },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } },
        ] as never),
    });

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(getNightWorkersCodexToolNames()).not.toContain('nightworkers.run_command');
    expect(result.contractWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'codex_unexpected_nightworkers_mcp_tool',
          toolName: 'nightworkers.run_command',
        }),
      ])
    );
  });

  it('classifies Codex native command_execution events for audit evidence', () => {
    const state = createCodexEventMapperState();
    const cases = [
      ['pnpm verify', 'broad_verification'],
      ['bun run verify:base', 'broad_verification'],
      ['npm run typecheck', 'verification'],
      ['git clone https://example.test/repo.git', 'git_clone_or_import'],
      ['pnpm install', 'install'],
      ['git status --short', 'inspection'],
      ['node custom-script.js', 'other'],
    ] as const;

    for (const [command, commandClass] of cases) {
      const [event] = mapCodexThreadEvent(
        {
          type: 'item.completed',
          item: {
            id: `cmd-${commandClass}`,
            type: 'command_execution',
            command,
            status: 'completed',
          },
        } as never,
        state
      );
      expect(event).toMatchObject({
        payload: { command, commandClass },
      });
    }
  });

  it('maps in-progress command and MCP updates as tool progress', () => {
    const state = createCodexEventMapperState();

    expect(
      mapCodexThreadEvent(
        {
          type: 'item.updated',
          item: {
            id: 'cmd-progress',
            type: 'command_execution',
            command: 'pnpm test',
            aggregated_output: 'running',
            status: 'in_progress',
          },
        },
        state
      )[0]
    ).toMatchObject({
      type: 'tool_call_progress',
      payload: { toolName: 'command_execution', status: 'in_progress' },
    });
    expect(
      mapCodexThreadEvent(
        {
          type: 'item.updated',
          item: {
            id: 'mcp-progress',
            type: 'mcp_tool_call',
            server: 'nightworkers',
            tool: 'get_task_context',
            arguments: { taskId: 'task-1' },
            status: 'in_progress',
          },
        },
        state
      )[0]
    ).toMatchObject({
      type: 'tool_call_progress',
      payload: { toolName: 'nightworkers.get_task_context', status: 'in_progress' },
    });
  });

  it('maps file changes with normalized changed file paths', () => {
    const events = mapCodexThreadEvent({
      type: 'item.completed',
      item: {
        id: 'file-change-1',
        type: 'file_change',
        status: 'completed',
        changes: [{ path: 'src/fizzbuzz.ts' }, 'README.md'],
      },
    } as never);

    expect(events[0]).toMatchObject({
      type: 'diff_collected',
      payload: {
        changedFiles: ['src/fizzbuzz.ts', 'README.md'],
        status: 'completed',
      },
    });
  });

  it('collects post-run workspace file creation as a diff event', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'nightworkers-codex-diff-'));
    try {
      await git(repoRoot, ['init']);
      await git(repoRoot, ['config', 'user.email', 'test@example.com']);
      await git(repoRoot, ['config', 'user.name', 'Test User']);
      await writeFile(path.join(repoRoot, 'README.md'), 'baseline\n');
      await git(repoRoot, ['add', 'README.md']);
      await git(repoRoot, ['commit', '-m', 'baseline']);
      await writeFile(path.join(repoRoot, 'fizzbuzz.ts'), 'export const fizzbuzz = true;\n');
      const runtime = new CodexAgentRuntime({
        collectWorkspaceDiff: true,
        threadFactory: () =>
          fakeThread([
            { type: 'turn.started' },
            {
              type: 'item.completed',
              item: { id: 'item-1', type: 'agent_message', text: 'done' },
            },
          ]),
      });
      const events: unknown[] = [];

      const result = await runtime.start(buildContext({ repoRoot }), {
        emit: async (event) => {
          events.push(event);
        },
      });

      expect(result.diffPatch).toContain('diff --git a/fizzbuzz.ts b/fizzbuzz.ts');
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'diff_collected',
            payload: expect.objectContaining({
              source: 'post_run_git_diff',
              changedFiles: ['fizzbuzz.ts'],
            }),
          }),
        ])
      );
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('redacts secret-like provider event fields', () => {
    expect(
      redactProviderEvent({
        headers: { Authorization: 'Bearer secret' },
        nested: { apiKey: 'secret' },
      })
    ).toEqual({
      headers: { Authorization: '[REDACTED]' },
      nested: { apiKey: '[REDACTED]' },
    });
  });
});

function buildContext(
  input: {
    repoRoot?: string;
    codex?: Record<string, unknown>;
    latestUserMessage?: string;
    conversationContextUsage?: {
      latestUserMessageTokens: number;
      stateCardTokens: number;
      runtimeUserPromptTokens: number;
    };
    currentTodo?: {
      id: string;
      seq: number;
      title: string;
      taskType: string;
      status: string;
      procedureId?: string | null;
    };
    todoPlan?: Array<{
      id: string;
      seq: number;
      title: string;
      taskType: string;
      status: string;
      procedureId?: string | null;
    }>;
  } = {}
) {
  return {
    runId: 'run-codex',
    taskId: 'task-codex',
    repositoryId: 'repo-codex',
    repoRoot: input.repoRoot ?? process.cwd(),
    compiledPrompt: 'do work',
    latestUserMessage: input.latestUserMessage ?? 'do work',
    timeoutSeconds: 60,
    contextSnapshot: {
      compiledPrompt: 'do work',
      source: 'fallback' as const,
      ...(input.conversationContextUsage
        ? {
            conversationContext: {
              stateCardIncluded: true,
              usage: input.conversationContextUsage,
            },
          }
        : {}),
    },
    runtimeOptions: input.codex ? { codex: input.codex } : undefined,
    currentTodo: input.currentTodo,
    todoPlan: input.todoPlan,
  };
}

function fakeThread(events: ThreadEvent[]) {
  return {
    runStreamed: vi.fn(async () => ({
      events: (async function* () {
        for (const event of events) yield event;
      })(),
    })),
  } as never;
}

async function git(cwd: string, args: string[]) {
  await execFileAsync('git', args, { cwd });
}
