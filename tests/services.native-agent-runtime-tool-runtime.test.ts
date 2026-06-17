import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import { NativeAgentRuntime } from '../api/services/agent-runtime/NativeAgentRuntime';
import { runNativeToolTurnLoop } from '../api/services/agent-runtime/native-tool-runtime/native-tool-turn-loop';
import { runAgentHooks } from '../api/services/hooks/hooks-runner';
import { mcpClientManager } from '../api/services/mcp/mcp-client-manager';
import { runSupervisorLoop } from '../api/services/supervisor/supervisor-loop';
import { executeWorkerTool } from '../api/services/worker-tools/dispatcher';

vi.mock('../api/modules/nightworkers/nightworkers.repository', () => ({
  createRunEvent: vi.fn(),
  getTaskRun: vi.fn(),
  listTaskRunTodosForRun: vi.fn(),
}));

vi.mock('../api/services/hooks/hooks-runner', () => ({
  runAgentHooks: vi.fn(),
}));

vi.mock('../api/services/mcp/mcp-client-manager', () => ({
  mcpClientManager: {
    listAvailableTools: vi.fn(),
  },
}));

vi.mock('../api/services/supervisor/supervisor-loop', () => ({
  runSupervisorLoop: vi.fn(),
}));

vi.mock('../api/services/agent-runtime/native-tool-runtime/native-tool-turn-loop', () => ({
  runNativeToolTurnLoop: vi.fn(),
}));

vi.mock('../api/services/worker-tools/dispatcher', () => ({
  executeWorkerTool: vi.fn(),
}));

describe('NativeAgentRuntime native tool runtime wiring', () => {
  let previousFlag: string | undefined;

  beforeEach(() => {
    previousFlag = process.env.NIGHTWORKERS_EXPERIMENTAL_NATIVE_TOOL_RUNTIME;
    process.env.NIGHTWORKERS_EXPERIMENTAL_NATIVE_TOOL_RUNTIME = 'true';
    vi.clearAllMocks();
    vi.mocked(runAgentHooks).mockResolvedValue({ decision: 'allow' } as never);
    vi.mocked(mcpClientManager.listAvailableTools).mockResolvedValue([]);
    vi.mocked(repo.getTaskRun).mockResolvedValue(null);
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
    vi.mocked(executeWorkerTool).mockResolvedValue({
      result: {
        ok: true,
        toolName: 'mcp_call_tool',
        startedAt: '2026-06-17T00:00:00.000Z',
        finishedAt: '2026-06-17T00:00:01.000Z',
        payload: {},
      },
      readFilesChanged: [],
    } as never);
  });

  afterEach(() => {
    if (previousFlag === undefined) {
      delete process.env.NIGHTWORKERS_EXPERIMENTAL_NATIVE_TOOL_RUNTIME;
      return;
    }
    process.env.NIGHTWORKERS_EXPERIMENTAL_NATIVE_TOOL_RUNTIME = previousFlag;
  });

  it('uses NativeToolTurnLoop when the experimental flag is enabled', async () => {
    vi.mocked(runNativeToolTurnLoop).mockResolvedValue({
      type: 'supported',
      result: {
        terminalState: 'completed',
        summary: 'native done',
        finalReport: 'native done',
        stoppedBy: 'decision',
        riskLevel: 'medium',
      },
    });
    const runtime = new NativeAgentRuntime();

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result).toMatchObject({
      terminalState: 'completed',
      finalReport: 'native done',
    });
    expect(runNativeToolTurnLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ runId: 'run-1' }),
      })
    );
    expect(runSupervisorLoop).not.toHaveBeenCalled();
  });

  it('uses NativeToolTurnLoop when native/API runtime options enable it', async () => {
    process.env.NIGHTWORKERS_EXPERIMENTAL_NATIVE_TOOL_RUNTIME = 'false';
    vi.mocked(runNativeToolTurnLoop).mockResolvedValue({
      type: 'supported',
      result: {
        terminalState: 'completed',
        summary: 'native api done',
        finalReport: 'native api done',
        stoppedBy: 'decision',
        riskLevel: 'medium',
      },
    });
    const runtime = new NativeAgentRuntime();

    const result = await runtime.start(
      buildContext({
        runtimeOptions: {
          experimentalNativeToolRuntime: true,
          structuredLlmRoutePolicy: {
            disallowedProviderIds: ['codex'],
            synthesizeFallbacksFromEnabledEndpoints: true,
          },
        },
      }),
      { emit: async () => {} }
    );

    expect(result).toMatchObject({
      terminalState: 'completed',
      finalReport: 'native api done',
    });
    expect(runNativeToolTurnLoop).toHaveBeenCalled();
    expect(runSupervisorLoop).not.toHaveBeenCalled();
  });

  it('runs only the startup contextStill gate before native tool turns', async () => {
    vi.mocked(mcpClientManager.listAvailableTools).mockResolvedValue([
      {
        serverId: 'context-still-server',
        serverName: 'context-still',
        toolPrefix: 'context_still',
        name: 'initial_instructions',
        namespacedName: 'mcp__context_still__initial_instructions',
      },
    ]);
    vi.mocked(repo.listTaskRunTodosForRun)
      .mockResolvedValueOnce([
        {
          id: 'todo-1',
          seq: 1,
          title: 'initial_instructions を実行する',
          taskType: 'initial_instructions',
          status: 'running',
          procedureId: 'contextstill.initial_instructions',
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          id: 'todo-1',
          seq: 1,
          title: 'initial_instructions を実行する',
          taskType: 'initial_instructions',
          status: 'running',
          procedureId: 'contextstill.initial_instructions',
        },
      ] as never)
      .mockResolvedValue([
        {
          id: 'todo-2',
          seq: 2,
          title: 'context_compile を実行する',
          taskType: 'context_compile',
          status: 'running',
          procedureId: 'contextstill.context_compile',
        },
      ] as never);
    vi.mocked(runNativeToolTurnLoop).mockResolvedValue({
      type: 'supported',
      result: {
        terminalState: 'completed',
        summary: 'native done',
        finalReport: 'native done',
        stoppedBy: 'decision',
        riskLevel: 'medium',
      },
    });
    const runtime = new NativeAgentRuntime();

    await runtime.start(
      buildContext({
        currentTodo: {
          id: 'todo-1',
          seq: 1,
          title: 'initial_instructions を実行する',
          taskType: 'initial_instructions',
          status: 'running',
          procedureId: 'contextstill.initial_instructions',
        },
        todoPlan: [
          {
            id: 'todo-1',
            seq: 1,
            title: 'initial_instructions を実行する',
            taskType: 'initial_instructions',
            status: 'running',
            procedureId: 'contextstill.initial_instructions',
          },
          {
            id: 'todo-2',
            seq: 2,
            title: 'context_compile を実行する',
            taskType: 'context_compile',
            status: 'pending',
            procedureId: 'contextstill.context_compile',
          },
        ],
      }),
      { emit: async () => {} }
    );

    expect(executeWorkerTool).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'mcp_call_tool',
        args: expect.objectContaining({
          toolName: 'initial_instructions',
        }),
      })
    );
    expect(executeWorkerTool).toHaveBeenCalledTimes(1);
    expect(executeWorkerTool).not.toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          toolName: 'context_compile',
        }),
      })
    );
    expect(runNativeToolTurnLoop).toHaveBeenCalled();
  });

  it('does not fall back to SchemaFirstAgent after a cancelled native provider failure', async () => {
    vi.mocked(runNativeToolTurnLoop).mockRejectedValue(new Error('provider failed after stop'));
    vi.mocked(repo.getTaskRun).mockResolvedValue({
      id: 'run-1',
      status: 'cancelled',
    } as never);
    const runtime = new NativeAgentRuntime();

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result).toMatchObject({
      terminalState: 'cancelled',
      stoppedBy: 'cancelled',
    });
    expect(runSupervisorLoop).not.toHaveBeenCalled();
  });

  it('falls back to Supervisor Loop when NativeToolTurnLoop reports unsupported', async () => {
    vi.mocked(runNativeToolTurnLoop).mockResolvedValue({
      type: 'unsupported',
      reason: 'unsupported provider',
    });
    vi.mocked(runSupervisorLoop).mockResolvedValue({
      terminalState: 'completed',
      summary: 'supervisor done',
      finalReport: 'supervisor done',
      stoppedBy: 'decision',
      riskLevel: 'low',
    });
    const events: unknown[] = [];
    const runtime = new NativeAgentRuntime();

    const result = await runtime.start(buildContext(), {
      emit: async (event) => {
        events.push(event);
      },
    });

    expect(result).toMatchObject({
      terminalState: 'completed',
      finalReport: 'supervisor done',
    });
    expect(runSupervisorLoop).toHaveBeenCalled();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'runtime_warning',
          payload: expect.objectContaining({
            code: 'NATIVE_TOOL_RUNTIME_SELECTED',
            severity: 'info',
          }),
        }),
        expect.objectContaining({
          type: 'runtime_warning',
          payload: expect.objectContaining({
            code: 'NATIVE_TOOL_RUNTIME_UNSUPPORTED',
          }),
        }),
      ])
    );
  });

  it('falls back to Supervisor Loop when NativeToolTurnLoop throws', async () => {
    vi.mocked(runNativeToolTurnLoop).mockRejectedValue(new Error('native provider failed'));
    vi.mocked(runSupervisorLoop).mockResolvedValue({
      terminalState: 'completed',
      summary: 'supervisor recovered',
      finalReport: 'supervisor recovered',
      stoppedBy: 'decision',
      riskLevel: 'low',
    });
    const events: unknown[] = [];
    const runtime = new NativeAgentRuntime();

    const result = await runtime.start(buildContext(), {
      emit: async (event) => {
        events.push(event);
      },
    });

    expect(result).toMatchObject({
      terminalState: 'completed',
      finalReport: 'supervisor recovered',
    });
    expect(runSupervisorLoop).toHaveBeenCalled();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'runtime_warning',
          payload: expect.objectContaining({
            code: 'NATIVE_TOOL_RUNTIME_UNSUPPORTED',
            message: expect.stringContaining('native provider failed'),
          }),
        }),
      ])
    );
  });
});

function buildContext(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-1',
    taskId: 'task-1',
    repositoryId: 'repo-1',
    repoRoot: '/repo',
    compiledPrompt: 'do work',
    latestUserMessage: 'do work',
    timeoutSeconds: 60,
    contextSnapshot: {
      compiledPrompt: 'do work',
      source: 'fallback' as const,
    },
    ...overrides,
  };
}
