import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import { startTaskRun } from '../api/modules/nightworkers/nightworkers.service';
import * as runtimeRegistry from '../api/services/agent-runtime/registry';
import * as contextStill from '../api/services/context-still';

vi.mock('../api/modules/nightworkers/nightworkers.repository', () => ({
  getTask: vi.fn(),
  listActiveTaskRunsForTask: vi.fn(),
  updateTaskStatus: vi.fn(),
  getRepository: vi.fn(),
  listTaskMessages: vi.fn(),
  createTaskRun: vi.fn(),
  createTaskRunTodo: vi.fn(),
  listTaskRunTodosForRun: vi.fn(),
  updateTaskRunTodo: vi.fn(),
  createRunEvent: vi.fn(),
  listTaskRunsForTask: vi.fn(),
  listTaskEventsForRun: vi.fn(),
  updateTaskCompiledPrompt: vi.fn(),
  updateTaskRun: vi.fn(),
  createTaskMessage: vi.fn(),
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
});
