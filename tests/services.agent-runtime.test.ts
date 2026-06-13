import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import { createLedgerSink } from '../api/services/agent-runtime/ledger-sink';
import { NativeAgentRuntime } from '../api/services/agent-runtime/NativeAgentRuntime';
import { createAgentHook } from '../api/services/hooks/hooks-settings';
import * as supervisor from '../api/services/supervisor/supervisor-loop';

vi.mock('../api/modules/nightworkers/nightworkers.repository', () => ({
  createRunEvent: vi.fn(),
  getTaskRun: vi.fn(),
  listTaskRunTodosForRun: vi.fn(),
  updateTaskRunTodo: vi.fn(),
}));

vi.mock('../api/services/supervisor/supervisor-loop', () => ({
  runSupervisorLoop: vi.fn(),
}));

describe('AgentRuntime', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
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
    (repo.createRunEvent as any).mockRejectedValueOnce(new Error('database is locked'));
    const sink = createLedgerSink('run-123');

    await expect(
      sink.emit({
        type: 'tool_call_started',
        message: 'tool started',
        payload: { toolName: 'nightworkers.list_recent_specifications' },
      })
    ).resolves.toBeUndefined();
  });

  it('auto-closes initial gate Todos after successful matching MCP tool completion', async () => {
    (repo.getTaskRun as any).mockResolvedValue({
      id: 'run-123',
      taskId: 'task-123',
    } as any);
    (repo.listTaskRunTodosForRun as any)
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
      ] as any)
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
      ] as any);

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
    expect(repo.updateTaskRunTodo).toHaveBeenNthCalledWith(
      2,
      'todo-2',
      expect.objectContaining({
        status: 'running',
        startedAt: expect.any(Date),
        completedAt: null,
      }),
      { notifyTaskId: 'task-123', notifyRunId: 'run-123' }
    );
  });

  it('normalizes runtime crash to failed result and runtime_error event', async () => {
    (supervisor.runSupervisorLoop as any).mockRejectedValue(new Error('supervisor exploded'));

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
    (supervisor.runSupervisorLoop as any).mockRejectedValue(new Error('supervisor exploded'));
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
    (supervisor.runSupervisorLoop as any).mockResolvedValue({
      terminalState: 'completed',
      summary: 'done',
      finalReport: 'done',
      stoppedBy: 'decision',
      riskLevel: 'low',
    });

    const runtime = new NativeAgentRuntime();
    const emitted: any[] = [];
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
