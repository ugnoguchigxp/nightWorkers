import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../../api/modules/nightworkers/nightworkers.repository';
import {
  runSessionQueueForRepository,
  startTaskRun,
} from '../../api/modules/nightworkers/nightworkers.service';
import * as runtimeRegistry from '../../api/services/agent-runtime/registry';
import * as conversationContext from '../../api/services/conversation-context';

const repoRoot = '/Users/y.noguchi/Code/nightWorkers';
const implementationPhasePreamble = [
  '実装フェーズに移行しました。',
  'plan mode はこの時点で終了です。',
  'ここからは計画相談ではなく、実装・検証・必要な修正・closeout まで最後までやり切ってください。',
  'Todo を作成・更新する場合も、この実装フェーズ前提で進めてください。',
].join('\n');

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

vi.mock('../../api/routes/settings', () => ({
  getCurrentSettings: vi.fn(() => {
    const activeProvider = process.env.ACTIVE_LLM_PROVIDER || 'azure';
    const codexEnabled = process.env.CODEX_ENABLED === 'true';
    return {
      ACTIVE_LLM_PROVIDER: activeProvider === 'codex' ? 'azure' : activeProvider,
      CODEX_ENABLED: codexEnabled,
      IMPLEMENTATION_RUNTIME_LANE:
        process.env.IMPLEMENTATION_RUNTIME_LANE ||
        (activeProvider === 'codex' && codexEnabled ? 'codex-sdk' : ''),
    };
  }),
}));

vi.mock('../../api/services/agent-runtime/registry', () => {
  const resolveAgentRuntime = vi.fn();
  const buildRuntimeLaneInitialTodos = vi.fn((lane: string) =>
    lane === 'codex-sdk'
      ? [
          { title: '対象変更を確認して実装する', taskType: 'implementation' },
          { title: '必要最小限の動作確認を行う', taskType: 'focused_verification' },
        ]
      : [
          { title: '仕様と既存構成を確認する', taskType: 'inspection' },
          { title: '対象画面の実装準備を行う', taskType: 'scaffold', dependsOn: [1] },
          { title: '対象画面を仕様に沿って実装する', taskType: 'implementation', dependsOn: [2] },
          { title: '受け入れ条件を検証する', taskType: 'verification', dependsOn: [3] },
        ]
  );
  return {
    buildRuntimeLaneInitialTodos,
    resolveAgentRuntime,
    resolveRuntimeLaneDefinition: vi.fn((lane: 'native-api-runner' | 'codex-sdk') => ({
      kind: lane,
      aliases: [],
      buildInitialTodos: (input: { compiledPromptText: string }) =>
        buildRuntimeLaneInitialTodos(lane, input),
      buildRuntimeOptions: (input: {
        runtimeLaneResolution?: unknown;
        executionMode?: string;
      }) => ({
        executionMode: input.executionMode ?? 'implementation',
        runtimeLane: lane,
        runtimeLaneResolution: input.runtimeLaneResolution ?? null,
      }),
      createAdapter: () =>
        resolveAgentRuntime(lane === 'codex-sdk' ? 'codex-agent' : 'native-local'),
    })),
  };
});

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
    process.env.NIGHTWORKERS_RUNTIME_LANE = 'native-api-runner';
  });

  it('keeps API implementation routes on the native-api-runner lane even when legacy Codex is enabled', async () => {
    delete process.env.NIGHTWORKERS_RUNTIME_LANE;
    process.env.ACTIVE_LLM_PROVIDER = 'codex';
    process.env.CODEX_ENABLED = 'true';
    const task = {
      id: 'task-codex-provider',
      repositoryId: 'repo-codex-provider',
      title: 'Codex provider task',
      description: 'Use Codex provider',
      objective: 'Use Codex provider',
      acceptanceCriteria: 'API implementation route stays on native-api-runner lane',
      timeoutSeconds: 60,
    };
    const run = {
      id: 'run-codex-provider',
      taskId: task.id,
      repositoryId: task.repositoryId,
      status: 'running',
    };

    vi.mocked(repo.getTask).mockResolvedValue(task as never);
    vi.mocked(repo.listActiveTaskRunsForTask).mockResolvedValue([]);
    vi.mocked(repo.getRepository).mockResolvedValue({
      id: task.repositoryId,
      localPath: repoRoot,
      safetyPolicy: {},
    } as never);
    vi.mocked(repo.listTaskMessages).mockResolvedValue([
      { role: 'user', content: 'Use Codex provider' },
    ] as never);
    vi.mocked(repo.createTaskRun).mockResolvedValue(run as never);
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
    vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as never);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
    vi.mocked(repo.updateTaskRun).mockResolvedValue(run as never);
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
    } as never);

    await startTaskRun(task.id);

    expect(repo.createTaskRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workerKind: 'native-local',
        contextSnapshot: expect.objectContaining({
          runtimeLane: 'native-api-runner',
          runtimeLaneResolution: expect.objectContaining({
            workerKind: 'native-local',
            source: 'role_route',
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
          title: '仕様と既存構成を確認する',
          taskType: 'inspection',
        }),
        expect.objectContaining({
          title: '対象画面の実装準備を行う',
          taskType: 'scaffold',
        }),
        expect.objectContaining({
          title: '対象画面を仕様に沿って実装する',
          taskType: 'implementation',
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
    expect(runtimeRegistry.resolveAgentRuntime).toHaveBeenCalledWith('native-local');
  });

  it('starts simple runtime once and precreates a visible TodoList', async () => {
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
    vi.mocked(repo.getTask).mockResolvedValue(task as never);
    vi.mocked(repo.listActiveTaskRunsForTask).mockResolvedValue([]);
    vi.mocked(repo.getRepository).mockResolvedValue({
      id: task.repositoryId,
      localPath: repoRoot,
      safetyPolicy: {},
    } as never);
    vi.mocked(repo.listTaskMessages).mockResolvedValue([
      { role: 'user', content: task.description },
    ] as never);
    vi.mocked(repo.createTaskRun).mockResolvedValue(run as never);
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
    vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as never);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
    vi.mocked(repo.updateTaskRun).mockResolvedValue(run as never);
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
    } as never);

    await startTaskRun(task.id);

    await vi.waitFor(() => {
      expect(runtimeStart).toHaveBeenCalledTimes(1);
    });
    expect(runtimeStart.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        compiledPrompt: expect.stringContaining('Update the code'),
        latestUserMessage: `${implementationPhasePreamble}\n\n${task.description}`,
        contextSnapshot: expect.objectContaining({
          executionPhase: 'implementation',
          planModeClosed: true,
          implementationPhasePreamble,
        }),
      })
    );
    expect(repo.replaceTaskRunTodosForRun).toHaveBeenCalledWith(
      run.id,
      expect.arrayContaining([
        expect.objectContaining({
          seq: 1,
          title: 'initial_instructions を実行する',
          status: 'running',
        }),
        expect.objectContaining({
          title: '仕様と既存構成を確認する',
          taskType: 'inspection',
        }),
        expect.objectContaining({
          title: '対象画面を仕様に沿って実装する',
          taskType: 'implementation',
        }),
      ])
    );
    expect(repo.updateTaskRunTodo).not.toHaveBeenCalled();
  });

  it('starts native/API planning mode without implementation Todos or preamble', async () => {
    const task = {
      id: 'task-plan-mode',
      repositoryId: 'repo-plan-mode',
      title: 'Planning task',
      description: '実装計画を作ってください',
      objective: '実装計画を作ってください',
      acceptanceCriteria: 'Plan is produced',
      timeoutSeconds: 60,
    };
    const run = {
      id: 'run-plan-mode',
      taskId: task.id,
      repositoryId: task.repositoryId,
      status: 'running',
    };
    vi.mocked(repo.getTask).mockResolvedValue(task as never);
    vi.mocked(repo.listActiveTaskRunsForTask).mockResolvedValue([]);
    vi.mocked(repo.getRepository).mockResolvedValue({
      id: task.repositoryId,
      localPath: repoRoot,
      safetyPolicy: {},
    } as never);
    vi.mocked(repo.listTaskMessages).mockResolvedValue([
      { id: 'message-user', role: 'user', content: task.description },
      {
        id: 'message-run-started',
        role: 'system',
        content: 'Planning run started from Workbench intake.',
        metadataJson: {
          intent: 'run_started',
          source: 'workbench',
          intakeJobSelection: {
            jobType: 'planning',
            goal: task.description,
          },
        },
      },
    ] as never);
    vi.mocked(repo.createTaskRun).mockResolvedValue(run as never);
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
    vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as never);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
    vi.mocked(repo.updateTaskRun).mockResolvedValue(run as never);
    const runtimeStart = vi.fn().mockResolvedValue({
      terminalState: 'completed',
      summary: 'Plan done',
      finalReport: 'Implementation plan',
      stoppedBy: 'decision',
      riskLevel: 'low',
      diffPatch: '',
      logContent: '',
    });
    vi.mocked(runtimeRegistry.resolveAgentRuntime).mockReturnValue({
      kind: 'native-local',
      start: runtimeStart,
      stop: vi.fn(),
    } as never);

    await startTaskRun(task.id);

    await vi.waitFor(() => {
      expect(runtimeStart).toHaveBeenCalledTimes(1);
    });
    expect(repo.replaceTaskRunTodosForRun).toHaveBeenCalledWith(run.id, []);
    expect(runtimeStart.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        latestUserMessage: task.description,
        runtimeOptions: expect.objectContaining({
          executionMode: 'planning',
        }),
        contextSnapshot: expect.objectContaining({
          executionPhase: 'planning',
          planModeClosed: false,
        }),
      })
    );
    expect(runtimeStart.mock.calls[0][0].latestUserMessage).not.toContain(
      'plan mode はこの時点で終了です。'
    );
  });

  it('uses an explicit implementation handoff instead of stale planning intake', async () => {
    const task = {
      id: 'task-draft-spec-handoff',
      repositoryId: 'repo-draft-spec-handoff',
      title: 'Todo List',
      description: '',
      objective: 'todo list を作りたいです。 計画してください',
      acceptanceCriteria: 'Todo List specification is ready for implementation',
      timeoutSeconds: 60,
    };
    const run = {
      id: 'run-draft-spec-handoff',
      taskId: task.id,
      repositoryId: task.repositoryId,
      status: 'running',
    };
    vi.mocked(repo.getTask).mockResolvedValue(task as never);
    vi.mocked(repo.listActiveTaskRunsForTask).mockResolvedValue([]);
    vi.mocked(repo.getRepository).mockResolvedValue({
      id: task.repositoryId,
      localPath: repoRoot,
      safetyPolicy: {},
    } as never);
    vi.mocked(repo.listTaskMessages).mockResolvedValue([
      {
        id: 'message-user',
        role: 'user',
        content: 'todo list を作りたいです。 計画してください',
        messageType: 'text',
        metadataJson: null,
      },
      {
        id: 'message-stale-planning-intake',
        role: 'system',
        content: 'Design Questionnaire を生成しました。',
        messageType: 'text',
        metadataJson: {
          intent: 'design_questionnaire_ready',
          intakeJobSelection: {
            jobType: 'planning',
            goal: 'todo list を作成するための実装方針と作業手順を整理する',
          },
        },
      },
      {
        id: 'message-queue',
        role: 'system',
        content: 'Implementation Queue entry created.',
        messageType: 'text',
        metadataJson: {
          source: 'implementation_queue',
          status: 'queued',
        },
      },
    ] as never);
    vi.mocked(repo.createTaskRun).mockResolvedValue(run as never);
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
    vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as never);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
    vi.mocked(repo.updateTaskRun).mockResolvedValue(run as never);
    const runtimeStart = vi.fn().mockResolvedValue({
      terminalState: 'completed',
      summary: 'Implementation done',
      finalReport: 'Implementation report',
      stoppedBy: 'decision',
      riskLevel: 'low',
      diffPatch: '',
      logContent: '',
    });
    vi.mocked(runtimeRegistry.resolveAgentRuntime).mockReturnValue({
      kind: 'native-local',
      start: runtimeStart,
      stop: vi.fn(),
    } as never);

    await startTaskRun(task.id, {
      executionMode: 'implementation',
      executionModeSource: 'workbench_run',
    });

    await vi.waitFor(() => {
      expect(runtimeStart).toHaveBeenCalledTimes(1);
    });
    expect(repo.replaceTaskRunTodosForRun).not.toHaveBeenCalledWith(run.id, []);
    expect(runtimeStart.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        latestUserMessage: `${implementationPhasePreamble}\n\ntodo list を作りたいです。 計画してください`,
        runtimeOptions: expect.objectContaining({
          executionMode: 'implementation',
        }),
        contextSnapshot: expect.objectContaining({
          executionModeSource: 'workbench_run',
          executionPhase: 'implementation',
          planModeClosed: true,
          implementationPhasePreamble,
        }),
      })
    );
  });

  it('does not auto-close unfinished Todos when runtime completes', async () => {
    const task = {
      id: 'task-open-todos',
      repositoryId: 'repo-open-todos',
      title: 'Open Todo task',
      description: 'Complete with open todos',
      objective: 'Complete with open todos',
      acceptanceCriteria: 'Runtime completes',
      timeoutSeconds: 60,
    };
    const run = {
      id: 'run-open-todos',
      taskId: task.id,
      repositoryId: task.repositoryId,
      status: 'running',
    };
    vi.mocked(repo.getTask).mockResolvedValue(task as never);
    vi.mocked(repo.listActiveTaskRunsForTask).mockResolvedValue([]);
    vi.mocked(repo.getRepository).mockResolvedValue({
      id: task.repositoryId,
      localPath: repoRoot,
      safetyPolicy: {},
    } as never);
    vi.mocked(repo.listTaskMessages).mockResolvedValue([
      { role: 'user', content: task.description },
    ] as never);
    vi.mocked(repo.createTaskRun).mockResolvedValue(run as never);
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([
      {
        id: 'todo-running',
        runId: run.id,
        seq: 1,
        title: 'Running Todo',
        taskType: 'implementation',
        status: 'running',
        startedAt: new Date('2026-06-12T00:00:00.000Z'),
      },
      {
        id: 'todo-pending',
        runId: run.id,
        seq: 2,
        title: 'Pending Todo',
        taskType: 'verification',
        status: 'pending',
      },
      {
        id: 'todo-passed',
        runId: run.id,
        seq: 3,
        title: 'Passed Todo',
        taskType: 'review',
        status: 'passed',
      },
    ] as never);
    vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as never);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
    vi.mocked(repo.updateTaskRun).mockResolvedValue(run as never);
    const runtimeStart = vi.fn().mockResolvedValue({
      terminalState: 'completed',
      summary: 'Runtime done',
      finalReport: 'Runtime report',
      stoppedBy: 'decision',
      riskLevel: 'low',
      diffPatch: '',
      logContent: '',
      contractWarnings: [
        {
          code: 'codex_file_change_before_todo_replace',
          severity: 'warning',
          message: 'File changed before Todo replace.',
          providerItemId: 'file-1',
          toolName: null,
          todoId: 'todo-running',
          todoSeq: 1,
          changedFiles: ['src/app.ts'],
          command: null,
          sequence: 4,
          occurredAt: '2026-06-12T00:00:00.000Z',
          count: 2,
        },
      ],
    });
    vi.mocked(runtimeRegistry.resolveAgentRuntime).mockReturnValue({
      kind: 'native-local',
      start: runtimeStart,
      stop: vi.fn(),
    } as never);

    await startTaskRun(task.id);

    await vi.waitFor(() => {
      expect(repo.updateTaskRun).toHaveBeenCalledWith(
        run.id,
        expect.objectContaining({
          status: 'needs_human',
          summary: 'Runtime finished without explicitly closing all open Todos.',
          finalReport: expect.stringContaining(
            'Todo closeout incomplete: #1 Running Todo (running), #2 Pending Todo (pending)'
          ),
          contextSnapshot: expect.objectContaining({
            runtimeContract: expect.objectContaining({
              lane: 'native-api-runner',
              warnings: expect.arrayContaining([
                expect.objectContaining({
                  code: 'codex_file_change_before_todo_replace',
                  sequence: 4,
                  occurredAt: '2026-06-12T00:00:00.000Z',
                  count: 2,
                }),
                expect.objectContaining({
                  code: 'codex_open_todos_before_completion',
                  todoId: 'todo-running',
                  todoSeq: 1,
                }),
              ]),
            }),
          }),
        })
      );
    });
    expect(repo.updateTaskRunTodo).not.toHaveBeenCalled();
    expect(repo.updateTaskStatus).toHaveBeenCalledWith(task.id, 'needs_human');
    expect(repo.createRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: run.id,
        taskId: task.id,
        type: 'run.outcome_decided',
        message: 'Runtime finished before explicit Todo closeout; run cannot be marked completed.',
        data: expect.objectContaining({
          warningCode: 'codex_open_todos_before_completion',
          contractWarning: expect.objectContaining({
            code: 'codex_open_todos_before_completion',
          }),
          terminalState: 'completed',
          nextStatus: 'needs_human',
          openTodos: expect.arrayContaining([
            expect.objectContaining({ id: 'todo-running', seq: 1, status: 'running' }),
            expect.objectContaining({ id: 'todo-pending', seq: 2, status: 'pending' }),
          ]),
        }),
      })
    );
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
    vi.mocked(repo.getTask).mockResolvedValue(task as never);
    vi.mocked(repo.listActiveTaskRunsForTask).mockResolvedValue([]);
    vi.mocked(repo.getRepository).mockResolvedValue({
      id: task.repositoryId,
      localPath: repoRoot,
      safetyPolicy: {},
    } as never);
    vi.mocked(repo.listTaskMessages).mockResolvedValue([
      { id: 'message-1', role: 'user', content: 'foo 条件も追加してください７で割ってください' },
    ] as never);
    vi.mocked(repo.createTaskRun).mockResolvedValue(run as never);
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
    vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as never);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
    vi.mocked(repo.updateTaskRun).mockResolvedValue(run as never);
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
      snapshotJson: { version: 1, task: { id: task.id } } as never,
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
    } as never);

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
          executionPhase: 'implementation',
          planModeClosed: true,
          implementationPhasePreamble,
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
    vi.mocked(repo.getTask).mockResolvedValue(task as never);
    vi.mocked(repo.listActiveTaskRunsForTask).mockResolvedValue([]);
    vi.mocked(repo.getRepository).mockResolvedValue({
      id: task.repositoryId,
      localPath: repoRoot,
      safetyPolicy: {},
    } as never);
    vi.mocked(repo.listTaskMessages).mockResolvedValue([
      { id: 'message-current', role: 'user', content: 'foo 条件も追加してください' },
    ] as never);
    vi.mocked(repo.createTaskRun).mockResolvedValue(run as never);
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
    vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as never);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
    vi.mocked(repo.updateTaskRun).mockResolvedValue(run as never);
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
      snapshotJson: { version: 1, task: { id: task.id } } as never,
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
    } as never);

    await startTaskRun(task.id);

    await vi.waitFor(() => {
      expect(runtimeStart).toHaveBeenCalledTimes(1);
    });
    expect(runtimeStart.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        latestUserMessage: `${implementationPhasePreamble}\n\nfoo 条件も追加してください`,
        contextSnapshot: expect.objectContaining({
          executionPhase: 'implementation',
          planModeClosed: true,
          implementationPhasePreamble,
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
    vi.mocked(repo.getTask).mockResolvedValue(task as never);
    vi.mocked(repo.listActiveTaskRunsForTask).mockResolvedValue([]);
    vi.mocked(repo.getRepository).mockResolvedValue({
      id: task.repositoryId,
      localPath: repoRoot,
      safetyPolicy: {},
    } as never);
    vi.mocked(repo.listTaskMessages).mockResolvedValue([
      { id: 'message-1', role: 'user', content: 'raw request' },
    ] as never);
    vi.mocked(repo.createTaskRun).mockResolvedValue(run as never);
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
    vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as never);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
    vi.mocked(repo.updateTaskRun).mockResolvedValue(run as never);
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
      snapshotJson: { version: 1 } as never,
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
    } as never);

    await startTaskRun(task.id);

    await vi.waitFor(() => {
      expect(runtimeStart).toHaveBeenCalledTimes(1);
    });
    expect(runtimeStart.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        latestUserMessage: `${implementationPhasePreamble}\n\nraw request`,
        contextSnapshot: expect.objectContaining({
          executionPhase: 'implementation',
          planModeClosed: true,
          implementationPhasePreamble,
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
    } as never);
    vi.mocked(repo.countActiveTaskRuns).mockResolvedValue(0);
    vi.mocked(repo.claimNextQueuedTask)
      .mockResolvedValueOnce(task as never)
      .mockResolvedValueOnce(null);
    vi.mocked(repo.getTask).mockResolvedValue(task as never);
    vi.mocked(repo.listActiveTaskRunsForTask).mockResolvedValue([]);
    vi.mocked(repo.listTaskMessages).mockResolvedValue([
      { role: 'user', content: task.description },
    ] as never);
    vi.mocked(repo.createTaskRun).mockResolvedValue(run as never);
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
    vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as never);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
    vi.mocked(repo.updateTaskRun).mockResolvedValue(run as never);
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
    } as never);

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
    } as never);
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
