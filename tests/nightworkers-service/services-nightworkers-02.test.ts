import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../../api/modules/nightworkers/nightworkers.repository';
import {
  runSessionQueueForRepository,
  startTaskRun,
} from '../../api/modules/nightworkers/nightworkers.service';
import * as runtimeRegistry from '../../api/services/agent-runtime/registry';
import * as conversationContext from '../../api/services/conversation-context';

const repoRoot = '/Users/y.noguchi/Code/nightWorkers';

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
    delete process.env.IMPLEMENTATION_RUNTIME_LANE;
  });

  it('routes enabled Codex provider implementation runs to the codex-agent lane', async () => {
    process.env.ACTIVE_LLM_PROVIDER = 'codex';
    process.env.CODEX_ENABLED = 'true';
    const task = {
      id: 'task-codex-provider',
      repositoryId: 'repo-codex-provider',
      title: 'Codex provider task',
      description: 'Use Codex provider',
      objective: 'Use Codex provider',
      acceptanceCriteria: 'Codex provider uses codex-agent lane',
      timeoutSeconds: 60,
    };
    const run = {
      id: 'run-codex-provider',
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
      { role: 'user', content: 'Use Codex provider' },
    ] as any);
    vi.mocked(repo.createTaskRun).mockResolvedValue(run as any);
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
    vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as any);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
    vi.mocked(repo.updateTaskRun).mockResolvedValue(run as any);
    const runtimeStart = vi.fn().mockResolvedValue({
      terminalState: 'completed',
      summary: 'Codex provider done',
      finalReport: 'Codex provider done',
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
            source: 'provider_default',
          }),
        }),
      })
    );
    expect(runtimeRegistry.resolveAgentRuntime).toHaveBeenCalledWith('codex-agent');
  });

  it('starts simple runtime once without creating planned todos', async () => {
    const task = {
      id: 'task-sequential',
      repositoryId: 'repo-sequential',
      title: 'Sequential task',
      description: '1. Update the code\n2. Add regression tests',
      objective: 'Run task once',
      acceptanceCriteria: 'Runtime completes',
      timeoutSeconds: 60,
    };
    const run = {
      id: 'run-sequential',
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
      { role: 'user', content: task.description },
    ] as any);
    vi.mocked(repo.createTaskRun).mockResolvedValue(run as any);
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
    vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as any);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
    vi.mocked(repo.updateTaskRun).mockResolvedValue(run as any);
    const runtimeStart = vi.fn().mockResolvedValue({
      terminalState: 'completed',
      summary: 'Runtime done',
      finalReport: 'Runtime report',
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
      expect(runtimeStart).toHaveBeenCalledTimes(1);
    });
    expect(runtimeStart.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        compiledPrompt: expect.stringContaining('Update the code'),
        latestUserMessage: task.description,
      })
    );
    expect(repo.createTaskRunTodo).not.toHaveBeenCalled();
    expect(repo.updateTaskRunTodo).not.toHaveBeenCalled();
  });

  it('injects StateCard into runtime latestUserMessage while preserving raw compiled prompt', async () => {
    const task = {
      id: 'task-state-card',
      repositoryId: 'repo-state-card',
      title: 'StateCard task',
      description: 'initial',
      objective: 'initial',
      acceptanceCriteria: 'Runtime completes',
      timeoutSeconds: 60,
    };
    const run = {
      id: 'run-state-card',
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
      { id: 'message-1', role: 'user', content: 'foo 条件も追加してください７で割ってください' },
    ] as any);
    vi.mocked(repo.createTaskRun).mockResolvedValue(run as any);
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
    vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as any);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
    vi.mocked(repo.updateTaskRun).mockResolvedValue(run as any);
    vi.mocked(conversationContext.getLatestConversationContextForTask).mockResolvedValue({
      id: 'snapshot-1',
      taskId: task.id,
      runId: 'run-previous',
      version: 1,
      jobType: 'minor_code_edit',
      latestUserMessageId: 'message-previous',
      previousRunId: 'run-previous',
      terminalState: 'completed',
      tokenEstimate: 42,
      snapshotJson: { version: 1, task: { id: task.id } } as any,
      stateCardText:
        '<STATE_CARD>\nTask: task-state-card | minor_code_edit | continuation\n</STATE_CARD>',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const runtimeStart = vi.fn().mockResolvedValue({
      terminalState: 'completed',
      summary: 'Runtime done',
      finalReport: 'Runtime report',
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

    await startTaskRun(task.id);

    await vi.waitFor(() => {
      expect(runtimeStart).toHaveBeenCalledTimes(1);
    });
    expect(repo.updateTaskCompiledPrompt).toHaveBeenCalledWith(
      task.id,
      'foo 条件も追加してください７で割ってください'
    );
    expect(runtimeStart.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        compiledPrompt: 'foo 条件も追加してください７で割ってください',
        latestUserMessage: expect.stringContaining('<STATE_CARD>'),
        contextSnapshot: expect.objectContaining({
          compiledPrompt: 'foo 条件も追加してください７で割ってください',
          conversationContext: expect.objectContaining({
            snapshotId: 'snapshot-1',
            stateCardIncluded: true,
            stateCardText: expect.stringContaining('<STATE_CARD>'),
            snapshotJson: expect.objectContaining({
              version: 1,
            }),
          }),
        }),
      })
    );
  });

  it('does not inject a StateCard built from the current latest user message', async () => {
    const task = {
      id: 'task-current-state-card',
      repositoryId: 'repo-current-state-card',
      title: 'Current StateCard task',
      description: 'initial',
      objective: 'initial',
      acceptanceCriteria: 'Runtime completes',
      timeoutSeconds: 60,
    };
    const run = {
      id: 'run-current-state-card',
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
      { id: 'message-current', role: 'user', content: 'foo 条件も追加してください' },
    ] as any);
    vi.mocked(repo.createTaskRun).mockResolvedValue(run as any);
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
    vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as any);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
    vi.mocked(repo.updateTaskRun).mockResolvedValue(run as any);
    vi.mocked(conversationContext.getLatestConversationContextForTask).mockResolvedValue({
      id: 'snapshot-current',
      taskId: task.id,
      runId: 'run-current',
      version: 1,
      jobType: 'minor_code_edit',
      latestUserMessageId: 'message-current',
      previousRunId: 'run-current',
      terminalState: 'completed',
      tokenEstimate: 42,
      snapshotJson: { version: 1, task: { id: task.id } } as any,
      stateCardText:
        '<STATE_CARD>\nTask: task-current-state-card | minor_code_edit | continuation\n</STATE_CARD>',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const runtimeStart = vi.fn().mockResolvedValue({
      terminalState: 'completed',
      summary: 'Runtime done',
      finalReport: 'Runtime report',
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

    await startTaskRun(task.id);

    await vi.waitFor(() => {
      expect(runtimeStart).toHaveBeenCalledTimes(1);
    });
    expect(runtimeStart.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        latestUserMessage: 'foo 条件も追加してください',
        contextSnapshot: expect.objectContaining({
          conversationContext: expect.objectContaining({
            stateCardIncluded: false,
            usage: expect.objectContaining({
              stateCardTokens: 0,
            }),
          }),
        }),
      })
    );
  });

  it('keeps runtime latestUserMessage raw when StateCard injection is explicitly disabled', async () => {
    process.env.CONVERSATION_CONTEXT_ENABLED = 'false';
    const task = {
      id: 'task-state-card-disabled',
      repositoryId: 'repo-state-card-disabled',
      title: 'StateCard disabled task',
      description: 'initial',
      objective: 'initial',
      acceptanceCriteria: 'Runtime completes',
      timeoutSeconds: 60,
    };
    const run = {
      id: 'run-state-card-disabled',
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
      { id: 'message-1', role: 'user', content: 'raw request' },
    ] as any);
    vi.mocked(repo.createTaskRun).mockResolvedValue(run as any);
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
    vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as any);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
    vi.mocked(repo.updateTaskRun).mockResolvedValue(run as any);
    vi.mocked(conversationContext.getLatestConversationContextForTask).mockResolvedValue({
      id: 'snapshot-disabled',
      taskId: task.id,
      runId: null,
      version: 1,
      jobType: 'minor_code_edit',
      latestUserMessageId: 'message-previous',
      previousRunId: 'run-previous',
      terminalState: 'completed',
      tokenEstimate: 42,
      snapshotJson: { version: 1 } as any,
      stateCardText: '<STATE_CARD>\nTask: disabled\n</STATE_CARD>',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const runtimeStart = vi.fn().mockResolvedValue({
      terminalState: 'completed',
      summary: 'Runtime done',
      finalReport: 'Runtime report',
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

    await startTaskRun(task.id);

    await vi.waitFor(() => {
      expect(runtimeStart).toHaveBeenCalledTimes(1);
    });
    expect(runtimeStart.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        latestUserMessage: 'raw request',
        contextSnapshot: expect.objectContaining({
          conversationContext: expect.objectContaining({
            stateCardIncluded: false,
            usage: expect.objectContaining({
              stateCardTokens: 0,
            }),
          }),
        }),
      })
    );
    expect(conversationContext.getLatestConversationContextForTask).not.toHaveBeenCalled();
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
      status: 'running',
    };
    const run = {
      id: 'run-next',
      taskId: task.id,
      repositoryId: task.repositoryId,
      status: 'running',
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
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
    vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as any);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
    vi.mocked(repo.updateTaskRun).mockResolvedValue(run as any);
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
