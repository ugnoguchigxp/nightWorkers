import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ThreadEvent } from '@openai/codex-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  buildCodexRuntimePrompt,
  CodexAgentRuntime,
} from '../api/services/agent-runtime/CodexAgentRuntime';
import {
  createCodexEventMapperState,
  mapCodexThreadEvent,
  redactProviderEvent,
} from '../api/services/agent-runtime/codex-event-mapper';
import {
  buildCodexRuntimeSdkOptions,
  buildCodexRuntimeThreadOptions,
} from '../api/services/agent-runtime/codex-runtime-config';

const execFileAsync = promisify(execFile);

describe('CodexAgentRuntime', () => {
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
      } as any,
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
      } as any,
    });

    expect(options.config).toBeUndefined();
    expect(options.env).toMatchObject({
      PATH: '/usr/bin',
      CODEX_ACCESS_TOKEN: 'runtime-token',
    });
    expect(options.env?.CODEX_THREAD_ID).toBeUndefined();
  });

  it('can explicitly disable MCP for Codex runtime', () => {
    const options = buildCodexRuntimeSdkOptions({
      enableNightworkersMcp: false,
      env: { PATH: '/usr/bin' } as any,
    });

    expect(options.config).toMatchObject({
      features: { mcp: false },
      mcp_servers: {},
    });
  });

  it('builds runtime thread options from the repository root', () => {
    const options = buildCodexRuntimeThreadOptions(
      buildContext({ repoRoot: '/repo/project', codex: { model: 'gpt-5.3-codex' } })
    );

    expect(options).toMatchObject({
      model: 'gpt-5.3-codex',
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
    expect(prompt).toContain('nightworkers.todo_list');
    expect(prompt).toContain('operation=replace');
    expect(prompt).toContain('operation=done');
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
    expect(prompt).toContain('nightworkers.import_project');
    expect(prompt).not.toContain('nightworkers.materialize_template');
    expect(prompt).not.toContain('nightworkers.clone_git_repo');
    expect(prompt).toContain('source=starter, stack=hono');
    expect(prompt).toContain('default SQLite variant');
    expect(prompt).toContain('run_command and run_verification keep full stdout/stderr by default');
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
    const events: any[] = [];

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
  });

  it('records Codex turn usage through the shared LLM usage recorder', async () => {
    const usageRecorder = vi.fn(async (input) => ({ id: 'usage-record', ...input }) as any);
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
    const events: any[] = [];

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
        ] as any)
      ),
    });
    const events: any[] = [];

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
        ] as any),
    });
    const events: any[] = [];

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
      payload: { command: 'pnpm test', aggregatedOutput: 'ok', exitCode: 0 },
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
    } as any);

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
      const events: any[] = [];

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
  };
}

function fakeThread(events: ThreadEvent[]) {
  return {
    runStreamed: vi.fn(async () => ({
      events: (async function* () {
        for (const event of events) yield event;
      })(),
    })),
  } as any;
}

async function git(cwd: string, args: string[]) {
  await execFileAsync('git', args, { cwd });
}
