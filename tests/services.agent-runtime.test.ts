import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import { createLedgerSink } from '../api/services/agent-runtime/ledger-sink';
import { NativeAgentRuntime } from '../api/services/agent-runtime/NativeAgentRuntime';
import { createAgentHook } from '../api/services/hooks/hooks-settings';
import { mcpClientManager } from '../api/services/mcp/mcp-client-manager';
import * as supervisor from '../api/services/supervisor/supervisor-loop';
import { executeWorkerTool } from '../api/services/worker-tools/dispatcher';

vi.mock('../api/modules/nightworkers/nightworkers.repository', () => ({
  createRunEvent: vi.fn(),
  getTaskRun: vi.fn(),
  listTaskRunTodosForRun: vi.fn(),
  startTaskRunTodoIfStillPendingAndNoEarlierOpen: vi.fn(),
  updateTaskRunTodo: vi.fn(),
}));

vi.mock('../api/services/supervisor/supervisor-loop', () => ({
  runSupervisorLoop: vi.fn(),
}));

vi.mock('../api/services/mcp/mcp-client-manager', () => ({
  mcpClientManager: {
    listAvailableTools: vi.fn(),
    disconnectAll: vi.fn(),
  },
}));

vi.mock('../api/services/worker-tools/dispatcher', () => ({
  executeWorkerTool: vi.fn(),
}));

describe('AgentRuntime', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mcpClientManager.listAvailableTools).mockResolvedValue([]);
    vi.mocked(executeWorkerTool).mockResolvedValue({
      result: {
        ok: true,
        toolName: 'mcp_call_tool',
        startedAt: new Date('2026-06-13T00:00:00.000Z').toISOString(),
        finishedAt: new Date('2026-06-13T00:00:01.000Z').toISOString(),
        payload: {},
      },
    });
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-agent-runtime-'));
    process.env.NIGHTWORKERS_HOOKS_SETTINGS_PATH = path.join(tempDir, 'agent-hooks.json');
  });

  afterEach(() => {
    delete process.env.NIGHTWORKERS_HOOKS_SETTINGS_PATH;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('maps runtime events into task events via ledger sink', async () => {
    const sink = createLedgerSink('run-123');
    await sink.emit({
      type: 'tool_call_finished',
      message: 'tool finished',
      payload: { ok: true },
    });

    expect(repo.createRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-123',
        actor: 'worker',
        severity: 'info',
        type: 'tool.call_finished',
        message: 'tool finished',
      })
    );
  });

  it('does not fail runtime execution when ledger persistence fails', async () => {
    (repo.createRunEvent as never).mockRejectedValueOnce(new Error('database is locked'));
    const sink = createLedgerSink('run-123');

    await expect(
      sink.emit({
        type: 'tool_call_started',
        message: 'tool started',
        payload: { toolName: 'nightworkers.list_recent_specifications' },
      })
    ).resolves.toBeUndefined();
  });

  it('persists runtime_warning severity from Codex contract payload', async () => {
    const sink = createLedgerSink('run-123');

    await sink.emit({
      type: 'runtime_warning',
      message: 'error warning',
      payload: {
        code: 'codex_high_risk_native_import_command',
        severity: 'error',
        message: 'High risk native import.',
      },
    });
    await sink.emit({
      type: 'runtime_warning',
      message: 'info warning',
      payload: {
        code: 'codex_global_mcp_tool_observed',
        severity: 'info',
        message: 'Observed global MCP tool.',
      },
    });
    await sink.emit({
      type: 'runtime_warning',
      message: 'invalid warning',
      payload: {
        code: 'codex_invalid',
        severity: 'critical' as never,
        message: 'Invalid severity.',
      },
    });

    expect(repo.createRunEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'system.warning',
        severity: 'error',
      })
    );
    expect(repo.createRunEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'system.warning',
        severity: 'info',
      })
    );
    expect(repo.createRunEvent).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        type: 'system.warning',
        severity: 'warning',
      })
    );
  });

  it('auto-closes initial gate Todos after successful matching MCP tool completion', async () => {
    (repo.getTaskRun as never).mockResolvedValue({
      id: 'run-123',
      taskId: 'task-123',
    } as never);
    (repo.listTaskRunTodosForRun as never)
      .mockResolvedValueOnce([
        {
          id: 'todo-1',
          runId: 'run-123',
          seq: 1,
          title: 'initial_instructions を実行する',
          taskType: 'initial_instructions',
          status: 'running',
          procedureId: 'contextstill.initial_instructions',
          startedAt: new Date('2026-06-13T00:00:00.000Z'),
        },
        {
          id: 'todo-2',
          runId: 'run-123',
          seq: 2,
          title: 'context_compile を実行する',
          taskType: 'context_compile',
          status: 'pending',
          procedureId: 'contextstill.context_compile',
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          id: 'todo-1',
          runId: 'run-123',
          seq: 1,
          title: 'initial_instructions を実行する',
          taskType: 'initial_instructions',
          status: 'passed',
          procedureId: 'contextstill.initial_instructions',
          startedAt: new Date('2026-06-13T00:00:00.000Z'),
          completedAt: new Date('2026-06-13T00:00:01.000Z'),
        },
        {
          id: 'todo-2',
          runId: 'run-123',
          seq: 2,
          title: 'context_compile を実行する',
          taskType: 'context_compile',
          status: 'pending',
          procedureId: 'contextstill.context_compile',
        },
      ] as never);

    const sink = createLedgerSink('run-123');
    await sink.emit({
      type: 'tool_call_finished',
      message: 'initial instructions finished',
      payload: {
        toolName: 'context-still.initial_instructions',
        status: 'completed',
      },
    });

    expect(repo.updateTaskRunTodo).toHaveBeenNthCalledWith(
      1,
      'todo-1',
      expect.objectContaining({
        status: 'passed',
        completedAt: expect.any(Date),
      }),
      { notifyTaskId: 'task-123', notifyRunId: 'run-123' }
    );
    expect(repo.startTaskRunTodoIfStillPendingAndNoEarlierOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'todo-2',
        runId: 'run-123',
        afterSeq: 1,
        startedAt: expect.any(Date),
      }),
      { notifyTaskId: 'task-123', notifyRunId: 'run-123' }
    );
  });

  it('auto-closes the quality gate but leaves closeout gates pending after successful broad verify', async () => {
    (repo.getTaskRun as never).mockResolvedValue({
      id: 'run-123',
      taskId: 'task-123',
    } as never);
    (repo.listTaskRunTodosForRun as never)
      .mockResolvedValueOnce([
        {
          id: 'todo-8',
          runId: 'run-123',
          seq: 8,
          title: '品質ゲート verify を実施する',
          taskType: 'verification',
          status: 'running',
          procedureId: 'quality_gate_verify',
          startedAt: new Date('2026-06-13T00:00:00.000Z'),
        },
        {
          id: 'todo-9',
          runId: 'run-123',
          seq: 9,
          title: '知識登録を行う',
          taskType: 'knowledge_capture',
          status: 'pending',
          procedureId: 'contextstill.register_candidates',
        },
        {
          id: 'todo-10',
          runId: 'run-123',
          seq: 10,
          title: '完了報告を行う',
          taskType: 'completion_report',
          status: 'pending',
          procedureId: 'final_completion_report',
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          id: 'todo-8',
          runId: 'run-123',
          seq: 8,
          title: '品質ゲート verify を実施する',
          taskType: 'verification',
          status: 'passed',
          procedureId: 'quality_gate_verify',
          startedAt: new Date('2026-06-13T00:00:00.000Z'),
          completedAt: new Date('2026-06-13T00:00:01.000Z'),
        },
        {
          id: 'todo-9',
          runId: 'run-123',
          seq: 9,
          title: '知識登録を行う',
          taskType: 'knowledge_capture',
          status: 'pending',
          procedureId: 'contextstill.register_candidates',
        },
        {
          id: 'todo-10',
          runId: 'run-123',
          seq: 10,
          title: '完了報告を行う',
          taskType: 'completion_report',
          status: 'pending',
          procedureId: 'final_completion_report',
        },
      ] as never);

    const sink = createLedgerSink('run-123');
    await sink.emit({
      type: 'tool_call_finished',
      message: 'command finished',
      payload: {
        toolName: 'command_execution',
        command: 'bun scripts/verify.ts',
        exitCode: 0,
        status: 'completed',
      },
    });

    expect(repo.updateTaskRunTodo).toHaveBeenNthCalledWith(
      1,
      'todo-8',
      expect.objectContaining({
        status: 'passed',
        completedAt: expect.any(Date),
      }),
      { notifyTaskId: 'task-123', notifyRunId: 'run-123' }
    );
    expect(repo.updateTaskRunTodo).toHaveBeenCalledTimes(1);
  });

  it('auto-closes only the knowledge registration gate after successful register_candidates', async () => {
    (repo.getTaskRun as never).mockResolvedValue({
      id: 'run-123',
      taskId: 'task-123',
    } as never);
    (repo.listTaskRunTodosForRun as never).mockResolvedValueOnce([
      {
        id: 'todo-8',
        runId: 'run-123',
        seq: 8,
        title: '知識登録を行う',
        taskType: 'knowledge_capture',
        status: 'pending',
        procedureId: 'contextstill.register_candidates',
      },
      {
        id: 'todo-9',
        runId: 'run-123',
        seq: 9,
        title: '完了報告を行う',
        taskType: 'completion_report',
        status: 'pending',
        procedureId: 'final_completion_report',
      },
    ] as never);

    const sink = createLedgerSink('run-123');
    await sink.emit({
      type: 'tool_call_finished',
      message: 'register candidates finished',
      payload: {
        toolName: 'context-still.register_candidates',
        status: 'completed',
      },
    });

    expect(repo.updateTaskRunTodo).toHaveBeenCalledWith(
      'todo-8',
      expect.objectContaining({
        status: 'passed',
        startedAt: expect.any(Date),
        completedAt: expect.any(Date),
      }),
      { notifyTaskId: 'task-123', notifyRunId: 'run-123' }
    );
    expect(repo.updateTaskRunTodo).toHaveBeenCalledTimes(1);
  });

  it('does not auto-close knowledge registration when register_candidates fails', async () => {
    const sink = createLedgerSink('run-123');
    await sink.emit({
      type: 'tool_call_finished',
      message: 'register candidates finished',
      payload: {
        toolName: 'context-still.register_candidates',
        status: 'failed',
        error: 'user cancelled MCP tool call',
      },
    });

    expect(repo.getTaskRun).not.toHaveBeenCalled();
    expect(repo.listTaskRunTodosForRun).not.toHaveBeenCalled();
    expect(repo.updateTaskRunTodo).not.toHaveBeenCalled();
  });

  it('auto-closes the final completion report after runtime finishes with a final report', async () => {
    (repo.getTaskRun as never).mockResolvedValue({
      id: 'run-123',
      taskId: 'task-123',
    } as never);
    (repo.listTaskRunTodosForRun as never).mockResolvedValueOnce([
      {
        id: 'todo-8',
        runId: 'run-123',
        seq: 8,
        title: '知識登録を行う',
        taskType: 'knowledge_capture',
        status: 'passed',
        procedureId: 'contextstill.register_candidates',
      },
      {
        id: 'todo-9',
        runId: 'run-123',
        seq: 9,
        title: '完了報告を行う',
        taskType: 'completion_report',
        status: 'pending',
        procedureId: 'final_completion_report',
      },
    ] as never);

    const sink = createLedgerSink('run-123');
    await sink.emit({
      type: 'runtime_finished',
      message: 'runtime completed',
      payload: { finalReport: '完了しました。' },
    });

    expect(repo.updateTaskRunTodo).toHaveBeenCalledWith(
      'todo-9',
      expect.objectContaining({
        status: 'passed',
        startedAt: expect.any(Date),
        completedAt: expect.any(Date),
      }),
      { notifyTaskId: 'task-123', notifyRunId: 'run-123' }
    );
  });

  it('does not auto-close the final completion report on intermediate assistant messages', async () => {
    const sink = createLedgerSink('run-123');
    await sink.emit({
      type: 'model_response_finished',
      message: 'assistant message completed',
      payload: { text: 'まだ途中です。' },
    });

    expect(repo.getTaskRun).not.toHaveBeenCalled();
    expect(repo.listTaskRunTodosForRun).not.toHaveBeenCalled();
    expect(repo.updateTaskRunTodo).not.toHaveBeenCalled();
  });

  it('does not auto-close the final completion report while knowledge registration is open', async () => {
    (repo.getTaskRun as never).mockResolvedValue({
      id: 'run-123',
      taskId: 'task-123',
    } as never);
    (repo.listTaskRunTodosForRun as never).mockResolvedValueOnce([
      {
        id: 'todo-8',
        runId: 'run-123',
        seq: 8,
        title: '知識登録を行う',
        taskType: 'knowledge_capture',
        status: 'pending',
        procedureId: 'contextstill.register_candidates',
      },
      {
        id: 'todo-9',
        runId: 'run-123',
        seq: 9,
        title: '完了報告を行う',
        taskType: 'completion_report',
        status: 'pending',
        procedureId: 'final_completion_report',
      },
    ] as never);

    const sink = createLedgerSink('run-123');
    await sink.emit({
      type: 'runtime_finished',
      message: 'runtime completed',
      payload: { finalReport: '完了しました。' },
    });

    expect(repo.updateTaskRunTodo).not.toHaveBeenCalled();
  });

  it('runs native initial_instructions before entering the supervisor loop', async () => {
    const currentTodos = [
      {
        id: 'todo-1',
        runId: 'run-1',
        seq: 1,
        title: 'initial_instructions を実行する',
        taskType: 'initial_instructions',
        status: 'running',
        procedureId: 'contextstill.initial_instructions',
        startedAt: new Date('2026-06-13T00:00:00.000Z'),
      },
      {
        id: 'todo-2',
        runId: 'run-1',
        seq: 2,
        title: 'context_compile を実行する',
        taskType: 'context_compile',
        status: 'pending',
        procedureId: 'contextstill.context_compile',
      },
      {
        id: 'todo-3',
        runId: 'run-1',
        seq: 3,
        title: '実装する',
        taskType: 'implementation',
        status: 'pending',
        procedureId: null,
      },
    ];
    let todos = currentTodos;
    vi.mocked(repo.getTaskRun).mockResolvedValue({ id: 'run-1', taskId: 'task-1' } as never);
    vi.mocked(repo.listTaskRunTodosForRun).mockImplementation(async () => todos as never);
    vi.mocked(repo.updateTaskRunTodo).mockImplementation(async (todoId, patch) => {
      todos = todos.map((todo) => (todo.id === todoId ? { ...todo, ...patch } : todo));
      return todos.find((todo) => todo.id === todoId) as never;
    });
    vi.mocked(repo.startTaskRunTodoIfStillPendingAndNoEarlierOpen).mockImplementation(
      async ({ id, startedAt }) => {
        const target = todos.find((todo) => todo.id === id && todo.status === 'pending');
        if (!target) return null as never;
        todos = todos.map((todo) =>
          todo.id === id ? { ...todo, status: 'running', startedAt } : todo
        );
        return todos.find((todo) => todo.id === id) as never;
      }
    );
    vi.mocked(mcpClientManager.listAvailableTools).mockResolvedValue([
      {
        serverId: 'server-1',
        serverName: 'context-still',
        toolPrefix: 'context_still',
        name: 'initial_instructions',
        namespacedName: 'mcp__context_still__initial_instructions',
      },
      {
        serverId: 'server-1',
        serverName: 'context-still',
        toolPrefix: 'context_still',
        name: 'context_compile',
        namespacedName: 'mcp__context_still__context_compile',
      },
    ]);
    vi.mocked(supervisor.runSupervisorLoop).mockResolvedValue({
      terminalState: 'completed',
      summary: 'done',
      finalReport: 'done',
      stoppedBy: 'decision',
      riskLevel: 'low',
    });

    const runtime = new NativeAgentRuntime();
    const result = await runtime.start(
      {
        runId: 'run-1',
        taskId: 'task-1',
        repositoryId: 'repo-1',
        repoRoot: process.cwd(),
        compiledPrompt: 'do work',
        latestUserMessage: 'do work',
        timeoutSeconds: 60,
        contextSnapshot: {
          compiledPrompt: 'do work',
          source: 'fallback',
        },
        todoPlan: currentTodos,
        currentTodo: currentTodos[0],
      },
      createLedgerSink('run-1')
    );

    expect(result.terminalState).toBe('completed');
    expect(executeWorkerTool).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'mcp_call_tool',
        args: expect.objectContaining({
          serverId: 'server-1',
          toolName: 'initial_instructions',
        }),
      })
    );
    expect(executeWorkerTool).toHaveBeenCalledTimes(1);
    expect(todos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'todo-1', status: 'passed' }),
        expect.objectContaining({ id: 'todo-2', status: 'running' }),
        expect.objectContaining({ id: 'todo-3', status: 'pending' }),
      ])
    );
    expect(supervisor.runSupervisorLoop).toHaveBeenCalled();
  });

  it('does not auto-close the quality gate for focused checks', async () => {
    const sink = createLedgerSink('run-123');
    await sink.emit({
      type: 'tool_call_finished',
      message: 'command finished',
      payload: {
        toolName: 'command_execution',
        command: 'bun run typecheck',
        exitCode: 0,
        status: 'completed',
      },
    });

    expect(repo.getTaskRun).not.toHaveBeenCalled();
    expect(repo.listTaskRunTodosForRun).not.toHaveBeenCalled();
    expect(repo.updateTaskRunTodo).not.toHaveBeenCalled();
  });

  it('normalizes runtime crash to failed result and runtime_error event', async () => {
    (supervisor.runSupervisorLoop as never).mockRejectedValue(new Error('supervisor exploded'));

    const runtime = new NativeAgentRuntime();
    const events: string[] = [];
    const result = await runtime.start(
      {
        runId: 'run-1',
        taskId: 'task-1',
        repositoryId: 'repo-1',
        repoRoot: process.cwd(),
        compiledPrompt: 'do work',
        latestUserMessage: 'do work',
        timeoutSeconds: 60,
        contextSnapshot: {
          compiledPrompt: 'do work',
          source: 'fallback',
        },
      },
      {
        emit: async (event) => {
          events.push(event.type);
        },
      }
    );

    expect(result.terminalState).toBe('failed');
    expect(result.stoppedBy).toBe('llm_error');
    expect(events).toContain('runtime_error');
  });

  it('runs SessionEnd hooks after runtime errors once the session has started', async () => {
    (supervisor.runSupervisorLoop as never).mockRejectedValue(new Error('supervisor exploded'));
    createAgentHook({
      name: 'Session end audit',
      enabled: true,
      event: 'SessionEnd',
      handler: {
        type: 'command',
        command: process.execPath,
        args: ['-e', 'console.log("{}")'],
      },
    });

    const runtime = new NativeAgentRuntime();
    const result = await runtime.start(
      {
        runId: 'run-1',
        taskId: 'task-1',
        repositoryId: 'repo-1',
        repoRoot: process.cwd(),
        compiledPrompt: 'do work',
        latestUserMessage: 'do work',
        timeoutSeconds: 60,
        contextSnapshot: {
          compiledPrompt: 'do work',
          source: 'fallback',
        },
      },
      {
        emit: async () => {},
      }
    );

    expect(result.terminalState).toBe('failed');
    expect(repo.createRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'hook.started',
        data: expect.objectContaining({
          hookEvent: 'SessionEnd',
          hookName: 'Session end audit',
        }),
      }),
      expect.anything()
    );
  });

  it('passes current todo context into the supervisor loop', async () => {
    (supervisor.runSupervisorLoop as never).mockResolvedValue({
      terminalState: 'completed',
      summary: 'done',
      finalReport: 'done',
      stoppedBy: 'decision',
      riskLevel: 'low',
    });

    const runtime = new NativeAgentRuntime();
    const emitted: unknown[] = [];
    await runtime.start(
      {
        runId: 'run-1',
        taskId: 'task-1',
        repositoryId: 'repo-1',
        repoRoot: process.cwd(),
        compiledPrompt: 'do work',
        latestUserMessage: 'do work',
        timeoutSeconds: 60,
        contextSnapshot: {
          compiledPrompt: 'do work',
          source: 'fallback',
        },
        currentTodo: {
          id: 'todo-1',
          seq: 1,
          title: 'Implement feature',
          taskType: 'code_change',
          status: 'running',
          procedureId: 'code-change',
        },
      },
      {
        emit: async (event) => {
          emitted.push(event);
        },
      }
    );

    expect(supervisor.runSupervisorLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        currentTodo: expect.objectContaining({
          id: 'todo-1',
          seq: 1,
          procedureId: 'code-change',
        }),
      })
    );
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'turn_started',
          payload: expect.objectContaining({
            todoId: 'todo-1',
            todoSeq: 1,
            procedureId: 'code-change',
          }),
        }),
        expect.objectContaining({
          type: 'runtime_finished',
          payload: expect.objectContaining({
            todoId: 'todo-1',
            todoSeq: 1,
            procedureId: 'code-change',
          }),
        }),
      ])
    );
  });
});
