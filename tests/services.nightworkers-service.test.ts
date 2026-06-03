import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import {
  getTaskRun as getTaskRunDetail,
  listTaskRunEvents,
  listTaskRunEventsForReplay,
  runSessionQueueForRepository,
  startTaskRun,
} from '../api/modules/nightworkers/nightworkers.service';
import * as runtimeRegistry from '../api/services/agent-runtime/registry';
import * as contextStill from '../api/services/context-still';

vi.mock('../api/modules/nightworkers/nightworkers.repository', () => ({
  getTask: vi.fn(),
  updateRepository: vi.fn(),
  countActiveTaskRuns: vi.fn(),
  claimNextQueuedTask: vi.fn(),
  listActiveTaskRunsForTask: vi.fn(),
  updateTaskStatus: vi.fn(),
  getRepository: vi.fn(),
  listTaskMessages: vi.fn(),
  createTaskRun: vi.fn(),
  getTaskRun: vi.fn(),
  createTaskRunTodo: vi.fn(),
  listTaskRunTodosForRun: vi.fn(),
  updateTaskRunTodo: vi.fn(),
  createRunEvent: vi.fn(),
  listTaskRunsForTask: vi.fn(),
  listTaskEventsForRun: vi.fn(),
  updateTaskCompiledPrompt: vi.fn(),
  updateTaskRun: vi.fn(),
  createTaskMessage: vi.fn(),
  getImplementationQueueEntryForRun: vi.fn(),
  updateImplementationQueueEntry: vi.fn(),
}));

vi.mock('../api/services/agent-runtime/registry', () => ({
  resolveAgentRuntime: vi.fn(),
}));

vi.mock('../api/services/context-still', () => ({
  compileContext: vi.fn(),
  evaluateContext: vi.fn(),
}));

describe('NightWorkers service', () => {
  let repoRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    repoRoot = await mkdtemp(path.join(os.tmpdir(), 'nightworkers-service-test-'));
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('lists replay events for a run after the requested cursor', async () => {
    vi.mocked(repo.getTaskRun).mockResolvedValue({
      id: 'run-replay',
      taskId: 'task-replay',
    } as any);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([
      { id: 'event-3', seq: 3, taskRunId: 'run-replay', message: 'after cursor' },
    ] as any);

    const events = await listTaskRunEventsForReplay({
      taskId: 'task-replay',
      runId: 'run-replay',
      afterSeq: 2,
    });

    expect(events).toHaveLength(1);
    expect(repo.listTaskEventsForRun).toHaveBeenCalledWith('run-replay', { afterSeq: 2 });
  });

  it('applies the event cursor when listing run events', async () => {
    vi.mocked(repo.getTaskRun).mockResolvedValue({
      id: 'run-detail',
      taskId: 'task-detail',
      status: 'running',
    } as any);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([
      { id: 'event-8', seq: 8, taskRunId: 'run-detail', message: 'new event' },
    ] as any);

    const events = await listTaskRunEvents('run-detail', { afterSeq: 7 });

    expect(events).toHaveLength(1);
    expect(repo.listTaskEventsForRun).toHaveBeenCalledWith('run-detail', { afterSeq: 7 });
  });

  it('loads full run details without applying an event cursor', async () => {
    vi.mocked(repo.getTaskRun).mockResolvedValue({
      id: 'run-detail',
      taskId: 'task-detail',
      status: 'running',
    } as any);
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([
      { id: 'event-1', seq: 1, taskRunId: 'run-detail', message: 'existing event' },
    ] as any);

    const detail = await getTaskRunDetail('run-detail');

    expect(detail?.events).toHaveLength(1);
    expect(repo.listTaskEventsForRun).toHaveBeenCalledWith('run-detail');
  });

  it('rejects replay events when the run does not belong to the subscribed task', async () => {
    vi.mocked(repo.getTaskRun).mockResolvedValue({
      id: 'run-replay',
      taskId: 'other-task',
    } as any);

    await expect(
      listTaskRunEventsForReplay({
        taskId: 'task-replay',
        runId: 'run-replay',
        afterSeq: 2,
      })
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(repo.listTaskEventsForRun).not.toHaveBeenCalled();
  });

  it('preserves policy stopped runtime results as policy_violation outcomes', async () => {
    const task = {
      id: 'task-policy',
      repositoryId: 'repo-policy',
      title: 'Policy task',
      description: 'Run a blocked command',
      objective: 'Run a blocked command',
      acceptanceCriteria: 'Policy block is preserved',
      timeoutSeconds: 60,
    };
    const run = {
      id: 'run-policy',
      taskId: task.id,
      repositoryId: task.repositoryId,
      status: 'context_compiling',
    };

    vi.mocked(repo.getTask).mockResolvedValue(task as any);
    vi.mocked(repo.listActiveTaskRunsForTask).mockResolvedValue([]);
    vi.mocked(repo.getRepository).mockResolvedValue({
      id: task.repositoryId,
      localPath: repoRoot,
      safetyPolicy: { blockedCommands: ['rm'] },
    } as any);
    vi.mocked(repo.listTaskMessages).mockResolvedValue([
      { role: 'user', content: 'Run a blocked command' },
    ] as any);
    vi.mocked(repo.createTaskRun).mockResolvedValue(run as any);
    vi.mocked(repo.createTaskRunTodo).mockResolvedValue({ id: 'todo-policy' } as any);
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([
      {
        id: 'todo-policy',
        runId: run.id,
        seq: 1,
        title: 'Run a blocked command',
        description: 'Run a blocked command',
        taskType: 'code_change',
        status: 'pending',
        procedureId: 'code-change',
        procedureSnapshot: {
          source: 'builtin',
          id: 'code-change',
          title: 'Code Change',
          version: 1,
          digest: 'sha256:test',
          sections: {},
        },
      },
    ] as any);
    vi.mocked(repo.updateTaskRunTodo).mockResolvedValue({ id: 'todo-policy' } as any);
    vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as any);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
    vi.mocked(repo.updateTaskRun).mockResolvedValue(run as any);
    vi.mocked(contextStill.compileContext).mockResolvedValue({
      compiledPromptText: 'Run a blocked command',
      degraded: true,
      degradedReason: 'test',
      sourceMetadata: {},
      includedMemoryRefs: [],
    } as any);
    vi.mocked(contextStill.evaluateContext).mockResolvedValue(undefined as any);

    const runtimeStart = vi.fn().mockResolvedValue({
      terminalState: 'needs_human',
      summary: 'Stopped by policy block',
      finalReport: 'Tool policy blocked execution.',
      stoppedBy: 'policy',
      riskLevel: 'high',
      diffPatch: '',
      logContent: '',
    });
    vi.mocked(runtimeRegistry.resolveAgentRuntime).mockReturnValue({
      kind: 'native-local',
      start: runtimeStart,
      stop: vi.fn(),
    } as any);

    await startTaskRun(task.id);
    expect(repo.createTaskRunTodo).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: run.id,
        seq: 1,
        title: 'Run a blocked command',
        taskType: 'code_change',
        status: 'pending',
        procedureId: 'code-change',
        procedureSnapshot: expect.objectContaining({
          id: 'code-change',
          digest: expect.stringMatching(/^sha256:/),
        }),
        dependsOn: [],
      })
    );
    expect(repo.updateTaskRunTodo).toHaveBeenCalledWith(
      'todo-policy',
      expect.objectContaining({
        contextSnapshot: expect.objectContaining({
          todo: expect.objectContaining({ id: 'todo-policy', taskType: 'code_change' }),
          selectedProcedure: expect.objectContaining({
            id: 'code-change',
            digest: 'sha256:test',
          }),
          runContext: expect.objectContaining({
            source: 'fallback',
            digest: expect.any(String),
          }),
        }),
      })
    );
    await vi.waitFor(() => {
      expect(runtimeStart).toHaveBeenCalledWith(
        expect.objectContaining({
          todoPlan: [
            expect.objectContaining({
              id: 'todo-policy',
              taskType: 'code_change',
              procedureId: 'code-change',
              procedureDigest: 'sha256:test',
            }),
          ],
        }),
        expect.anything()
      );
    });
    await vi.waitFor(() => {
      expect(repo.createRunEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'run.outcome_decided',
          data: expect.objectContaining({
            status: 'needs_human',
            reason: 'policy_violation',
          }),
        }),
        expect.objectContaining({
          legacyPayload: expect.objectContaining({ reason: 'policy_violation' }),
        })
      );
    });
  });

  it('executes multiple planned todos sequentially', async () => {
    const task = {
      id: 'task-sequential',
      repositoryId: 'repo-sequential',
      title: 'Sequential task',
      description: '1. Update the code\n2. Add regression tests',
      objective: 'Run todos in order',
      acceptanceCriteria: 'Both todos complete',
      timeoutSeconds: 60,
    };
    const run = {
      id: 'run-sequential',
      taskId: task.id,
      repositoryId: task.repositoryId,
      status: 'context_compiling',
    };
    const todos = [
      {
        id: 'todo-code',
        runId: run.id,
        seq: 1,
        title: 'Update the code',
        description: 'Update the code',
        taskType: 'code_change',
        status: 'pending',
        procedureId: 'code-change',
        procedureSnapshot: { id: 'code-change', digest: 'sha256:code' },
      },
      {
        id: 'todo-test',
        runId: run.id,
        seq: 2,
        title: 'Add regression tests',
        description: 'Add regression tests',
        taskType: 'test_change',
        status: 'pending',
        procedureId: 'test-change',
        procedureSnapshot: { id: 'test-change', digest: 'sha256:test' },
      },
    ];

    vi.mocked(repo.getTask).mockResolvedValue(task as any);
    vi.mocked(repo.listActiveTaskRunsForTask).mockResolvedValue([]);
    vi.mocked(repo.getRepository).mockResolvedValue({
      id: task.repositoryId,
      localPath: repoRoot,
      safetyPolicy: {},
    } as any);
    vi.mocked(repo.listTaskMessages).mockResolvedValue([
      { role: 'user', content: task.description },
    ] as any);
    vi.mocked(repo.createTaskRun).mockResolvedValue(run as any);
    vi.mocked(repo.createTaskRunTodo).mockResolvedValue({ id: 'todo' } as any);
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue(todos as any);
    vi.mocked(repo.updateTaskRunTodo).mockResolvedValue({ id: 'todo' } as any);
    vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as any);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
    vi.mocked(repo.updateTaskRun).mockResolvedValue(run as any);
    vi.mocked(contextStill.compileContext).mockResolvedValue({
      compiledPromptText: task.description,
      degraded: false,
      sourceMetadata: {},
      includedMemoryRefs: [],
    } as any);
    vi.mocked(contextStill.evaluateContext).mockResolvedValue(undefined as any);

    const runtimeStart = vi.fn().mockResolvedValue({
      terminalState: 'completed',
      summary: 'Todo done',
      finalReport: 'Todo report',
      stoppedBy: 'decision',
      riskLevel: 'low',
      diffPatch: 'diff --git a/a b/a',
      logContent: 'log',
    });
    vi.mocked(runtimeRegistry.resolveAgentRuntime).mockReturnValue({
      kind: 'native-local',
      start: runtimeStart,
      stop: vi.fn(),
    } as any);

    await startTaskRun(task.id);

    await vi.waitFor(() => {
      expect(runtimeStart).toHaveBeenCalledTimes(2);
    });
    expect(runtimeStart.mock.calls[0][0].compiledPrompt).toContain('seq: 1');
    expect(runtimeStart.mock.calls[1][0].compiledPrompt).toContain('seq: 2');
    expect(repo.updateTaskRunTodo).toHaveBeenCalledWith(
      'todo-code',
      expect.objectContaining({ status: 'passed' })
    );
    expect(repo.updateTaskRunTodo).toHaveBeenCalledWith(
      'todo-test',
      expect.objectContaining({ status: 'passed' })
    );
  });

  it('starts the next queued session when project queue capacity is available', async () => {
    const task = {
      id: 'task-next',
      repositoryId: 'repo-queue',
      title: 'Queued session',
      description: 'Run queued session',
      objective: 'Run queued session',
      acceptanceCriteria: 'Queued session starts',
      timeoutSeconds: 60,
      status: 'context_compiling',
    };
    const run = {
      id: 'run-next',
      taskId: task.id,
      repositoryId: task.repositoryId,
      status: 'context_compiling',
    };
    const todo = {
      id: 'todo-next',
      runId: run.id,
      seq: 1,
      title: 'Run queued session',
      description: 'Run queued session',
      taskType: 'code_change',
      status: 'pending',
      procedureId: 'code-change',
      procedureSnapshot: { id: 'code-change', digest: 'sha256:queue' },
    };

    vi.mocked(repo.getRepository).mockResolvedValue({
      id: task.repositoryId,
      localPath: repoRoot,
      queueEnabled: true,
      maxConcurrentSessions: 1,
      safetyPolicy: {},
    } as any);
    vi.mocked(repo.countActiveTaskRuns).mockResolvedValue(0);
    vi.mocked(repo.claimNextQueuedTask)
      .mockResolvedValueOnce(task as any)
      .mockResolvedValueOnce(null);
    vi.mocked(repo.getTask).mockResolvedValue(task as any);
    vi.mocked(repo.listActiveTaskRunsForTask).mockResolvedValue([]);
    vi.mocked(repo.listTaskMessages).mockResolvedValue([
      { role: 'user', content: task.description },
    ] as any);
    vi.mocked(repo.createTaskRun).mockResolvedValue(run as any);
    vi.mocked(repo.createTaskRunTodo).mockResolvedValue({ id: todo.id } as any);
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([todo] as any);
    vi.mocked(repo.updateTaskRunTodo).mockResolvedValue(todo as any);
    vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as any);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
    vi.mocked(repo.updateTaskRun).mockResolvedValue(run as any);
    vi.mocked(contextStill.compileContext).mockResolvedValue({
      compiledPromptText: task.description,
      degraded: false,
      sourceMetadata: {},
      includedMemoryRefs: [],
    } as any);
    vi.mocked(contextStill.evaluateContext).mockResolvedValue(undefined as any);

    const runtimeStart = vi.fn().mockResolvedValue({
      terminalState: 'completed',
      summary: 'Queued session done',
      finalReport: 'Queued session report',
      stoppedBy: 'decision',
      riskLevel: 'low',
      diffPatch: '',
      logContent: '',
    });
    vi.mocked(runtimeRegistry.resolveAgentRuntime).mockReturnValue({
      kind: 'native-local',
      start: runtimeStart,
      stop: vi.fn(),
    } as any);

    const started = await runSessionQueueForRepository(task.repositoryId);

    expect(started).toHaveLength(1);
    expect(repo.claimNextQueuedTask).toHaveBeenCalledWith(task.repositoryId);
    expect(repo.createTaskRun).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: task.id, repositoryId: task.repositoryId })
    );
    await vi.waitFor(() => {
      expect(runtimeStart).toHaveBeenCalledTimes(1);
    });
  });

  it('does not claim queued sessions when global capacity is full', async () => {
    vi.mocked(repo.getRepository).mockResolvedValue({
      id: 'repo-full',
      localPath: repoRoot,
      queueEnabled: true,
      maxConcurrentSessions: 3,
      safetyPolicy: {},
    } as any);
    vi.mocked(repo.countActiveTaskRuns).mockResolvedValue(2);

    const previousLimit = process.env.SESSION_QUEUE_MAX_CONCURRENCY;
    process.env.SESSION_QUEUE_MAX_CONCURRENCY = '2';
    try {
      const started = await runSessionQueueForRepository('repo-full');
      expect(started).toHaveLength(0);
      expect(repo.claimNextQueuedTask).not.toHaveBeenCalled();
    } finally {
      if (previousLimit === undefined) delete process.env.SESSION_QUEUE_MAX_CONCURRENCY;
      else process.env.SESSION_QUEUE_MAX_CONCURRENCY = previousLimit;
    }
  });
});
