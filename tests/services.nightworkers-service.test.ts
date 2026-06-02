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

    vi.mocked(runtimeRegistry.resolveAgentRuntime).mockReturnValue({
      kind: 'native-local',
      start: vi.fn().mockResolvedValue({
        terminalState: 'needs_human',
        summary: 'Stopped by policy block',
        finalReport: 'Tool policy blocked execution.',
        stoppedBy: 'policy',
        riskLevel: 'high',
        diffPatch: '',
        logContent: '',
      }),
      stop: vi.fn(),
    } as any);

    await startTaskRun(task.id);
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
});
