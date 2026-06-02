import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import { createLedgerSink } from '../api/services/agent-runtime/ledger-sink';
import { NativeAgentRuntime } from '../api/services/agent-runtime/NativeAgentRuntime';
import * as supervisor from '../api/services/supervisor/supervisor-loop';
import * as gitTools from '../api/services/worker-tools/git';

vi.mock('../api/modules/nightworkers/nightworkers.repository', () => ({
  createRunEvent: vi.fn(),
}));

vi.mock('../api/services/supervisor/supervisor-loop', () => ({
  runSupervisorLoop: vi.fn(),
}));

vi.mock('../api/services/worker-tools/git', () => ({
  gitStatusTool: vi.fn(),
  gitDiffTool: vi.fn(),
}));

describe('AgentRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('normalizes runtime crash to failed result and runtime_error event', async () => {
    vi.mocked(gitTools.gitStatusTool).mockResolvedValue({
      ok: true,
      toolName: 'git_status',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      payload: {
        branch: 'main',
        isDirty: false,
        untrackedCount: 0,
        modifiedCount: 0,
        shortStatus: '',
      },
    });
    vi.mocked(supervisor.runSupervisorLoop).mockRejectedValue(new Error('supervisor exploded'));

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

  it('passes current todo context into the supervisor loop', async () => {
    vi.mocked(gitTools.gitStatusTool).mockResolvedValue({
      ok: true,
      toolName: 'git_status',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      payload: {
        branch: 'main',
        isDirty: false,
        untrackedCount: 0,
        modifiedCount: 0,
        shortStatus: '',
      },
    });
    vi.mocked(gitTools.gitDiffTool).mockResolvedValue({
      ok: true,
      toolName: 'git_diff',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      payload: {
        diff: '',
        diffStat: '',
        hasChanges: false,
      },
    });
    vi.mocked(supervisor.runSupervisorLoop).mockResolvedValue({
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
          type: 'tool_call_finished',
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
