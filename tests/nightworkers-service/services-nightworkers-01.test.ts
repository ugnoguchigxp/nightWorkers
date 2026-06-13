import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../../api/modules/nightworkers/nightworkers.repository';
import {
  createLocalFolder,
  getTaskRun as getTaskRunDetail,
  listTaskRunEvents,
  listTaskRunEventsForReplay,
  startTaskRun,
} from '../../api/modules/nightworkers/nightworkers.service';
import * as runtimeRegistry from '../../api/services/agent-runtime/registry';

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-service-01-'));
const implementationPhasePreamble = [
  '実装フェーズに移行しました。',
  'plan mode はこの時点で終了です。',
  'ここからは計画相談ではなく、実装・検証・必要な修正・closeout まで最後までやり切ってください。',
  'Todo を作成・更新する場合も、この実装フェーズ前提で進めてください。',
].join('\n');

afterAll(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

vi.mock('../../api/modules/nightworkers/nightworkers.repository', () => ({
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
  replaceTaskRunTodosForRun: vi.fn(),
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

vi.mock('../../api/services/agent-runtime/registry', () => ({
  resolveAgentRuntime: vi.fn(),
}));

vi.mock('../../api/services/conversation-context', () => ({
  buildPromptWithStateCard: vi.fn(
    (input: { latestUserMessage: string; stateCardText?: string | null }) => {
      const request = input.latestUserMessage.trim();
      const card = input.stateCardText?.trim();
      return card ? `<USER_REQUEST>\n${request}\n</USER_REQUEST>\n\n${card}` : request;
    }
  ),
  buildPromptWithStateCardParts: vi.fn(
    (input: { latestUserMessage: string; stateCardText?: string | null }) => {
      const request = input.latestUserMessage.trim();
      const card = input.stateCardText?.trim();
      const promptText = card ? `<USER_REQUEST>\n${request}\n</USER_REQUEST>\n\n${card}` : request;
      return {
        latestUserMessage: request,
        stateCardText: card || null,
        promptText,
        estimates: {
          latestUserMessageTokens: Math.ceil(request.length / 4),
          stateCardTokens: card ? Math.ceil(card.length / 4) : 0,
          promptTokens: Math.ceil(promptText.length / 4),
        },
      };
    }
  ),
  getLatestConversationContextForTask: vi.fn(),
  refreshConversationContextSnapshot: vi.fn(),
}));

describe('NightWorkers service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ACTIVE_LLM_PROVIDER;
    delete process.env.CODEX_ENABLED;
    process.env.NIGHTWORKERS_RUNTIME_LANE = 'native-supervisor';
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

  it('creates a local folder under the selected parent directory', async () => {
    const folder = await createLocalFolder({ parentPath: repoRoot, name: 'new-project' });

    expect(folder).toEqual({
      name: 'new-project',
      path: path.join(repoRoot, 'new-project'),
    });
  });

  it('rejects nested folder names when creating a local folder', async () => {
    await expect(
      createLocalFolder({ parentPath: repoRoot, name: '../outside' })
    ).rejects.toMatchObject({
      code: 'INVALID_FOLDER_NAME',
    });
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
      status: 'running',
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
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
    vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as any);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
    vi.mocked(repo.updateTaskRun).mockResolvedValue(run as any);
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
    expect(repo.createTaskRunTodo).not.toHaveBeenCalled();
    expect(repo.updateTaskRunTodo).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(runtimeStart).toHaveBeenCalledWith(
        expect.objectContaining({
          compiledPrompt: expect.stringContaining('Run a blocked command'),
          latestUserMessage: `${implementationPhasePreamble}\n\nRun a blocked command`,
        }),
        expect.anything()
      );
    });
    await vi.waitFor(() => {
      expect(repo.updateTaskRun).toHaveBeenCalledWith(
        run.id,
        expect.objectContaining({
          status: 'needs_human',
          finalReport: 'Tool policy blocked execution.',
          finalJudgment: null,
        })
      );
    });
    expect(repo.createRunEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'run.outcome_decided' }),
      expect.anything()
    );
    expect(repo.createTaskMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'assistant',
        content: 'Tool policy blocked execution.',
        payloadJson: expect.objectContaining({
          finalReport: 'Tool policy blocked execution.',
          status: 'needs_human',
        }),
      })
    );
  });

  it('uses the codex-agent runtime lane when the env override is set', async () => {
    process.env.NIGHTWORKERS_RUNTIME_LANE = 'codex-agent';
    const task = {
      id: 'task-codex-lane',
      repositoryId: 'repo-codex-lane',
      title: 'Codex lane task',
      description: 'Use Codex lane',
      objective: 'Use Codex lane',
      acceptanceCriteria: 'Codex lane starts',
      timeoutSeconds: 60,
    };
    const run = {
      id: 'run-codex-lane',
      taskId: task.id,
      repositoryId: task.repositoryId,
      status: 'running',
    };

    vi.mocked(repo.getTask).mockResolvedValue(task as any);
    vi.mocked(repo.listActiveTaskRunsForTask).mockResolvedValue([]);
    vi.mocked(repo.getRepository).mockResolvedValue({
      id: task.repositoryId,
      localPath: repoRoot,
      safetyPolicy: {},
    } as any);
    vi.mocked(repo.listTaskMessages).mockResolvedValue([
      { role: 'user', content: 'Use Codex lane' },
    ] as any);
    vi.mocked(repo.createTaskRun).mockResolvedValue(run as any);
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
    vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as any);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
    vi.mocked(repo.updateTaskRun).mockResolvedValue(run as any);
    const runtimeStart = vi.fn().mockResolvedValue({
      terminalState: 'completed',
      summary: 'Codex done',
      finalReport: 'Codex done',
      stoppedBy: 'decision',
      riskLevel: 'medium',
      diffPatch: '',
      logContent: '',
    });
    vi.mocked(runtimeRegistry.resolveAgentRuntime).mockReturnValue({
      kind: 'codex-agent',
      start: runtimeStart,
      stop: vi.fn(),
    } as any);

    await startTaskRun(task.id);

    expect(repo.createTaskRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workerKind: 'codex-agent',
        contextSnapshot: expect.objectContaining({
          runtimeLane: 'codex-agent',
          runtimeLaneResolution: expect.objectContaining({
            workerKind: 'codex-agent',
            source: 'env',
          }),
        }),
      })
    );
    const todos = vi.mocked(repo.replaceTaskRunTodosForRun).mock.calls[0]?.[1] || [];
    expect(todos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'initial_instructions を実行する',
          status: 'running',
        }),
        expect.objectContaining({
          title: 'context_compile を実行する',
        }),
        expect.objectContaining({
          title: '対象変更を確認して実装する',
          taskType: 'implementation',
        }),
        expect.objectContaining({
          title: '必要最小限の動作確認を行う',
          taskType: 'focused_verification',
        }),
        expect.objectContaining({
          title: 'LLM コードレビューを実施する',
          taskType: 'review',
        }),
        expect.objectContaining({
          title: '品質ゲート verify を実施する',
          taskType: 'verification',
        }),
      ])
    );
    expect(todos).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: '仕様と既存構成を確認する',
        }),
      ])
    );
    expect(runtimeRegistry.resolveAgentRuntime).toHaveBeenCalledWith('codex-agent');
    await vi.waitFor(() => {
      expect(runtimeStart).toHaveBeenCalledWith(
        expect.objectContaining({
          runtimeOptions: expect.objectContaining({
            runtimeLane: 'codex-agent',
          }),
        }),
        expect.anything()
      );
    });
  });
});
