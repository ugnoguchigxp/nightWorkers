import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import { createLedgerSink } from '../api/services/agent-runtime/ledger-sink';
import { NativeAgentRuntime } from '../api/services/agent-runtime/NativeAgentRuntime';
import * as supervisor from '../api/services/supervisor/supervisor-loop';
import * as gitTools from '../api/services/worker-tools/git';

vi.mock('../api/modules/nightworkers/nightworkers.repository', () => ({
  createTaskEvent: vi.fn(),
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

    expect(repo.createTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        taskRunId: 'run-123',
        actor: 'worker',
        type: 'info',
        eventType: 'tool_result',
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
});
