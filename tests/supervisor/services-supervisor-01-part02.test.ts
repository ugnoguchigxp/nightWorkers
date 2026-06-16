import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../../api/modules/nightworkers/nightworkers.repository';
import { mcpClientManager } from '../../api/services/mcp/mcp-client-manager';
import * as llm from '../../api/services/structured-llm';
import { runSupervisorLoop } from '../../api/services/supervisor/supervisor-loop';
import { parseRound2UserContextJsonSection } from '../../api/services/supervisor/user-context';

const execFileAsync = promisify(execFile);

vi.mock('../../api/services/structured-llm', () => ({
  callSupervisorLLM: vi.fn(),
}));

vi.mock('../../api/services/mcp/mcp-client-manager', () => ({
  mcpClientManager: {
    listAvailableTools: vi.fn(),
    callTool: vi.fn(),
  },
}));

vi.mock('../../api/modules/nightworkers/nightworkers.repository', () => ({
  getTaskRun: vi.fn(),
  getTask: vi.fn(),
  createRunEvent: vi.fn(),
  createTaskMessage: vi.fn(),
  updateTaskRun: vi.fn(),
  updateTaskStatus: vi.fn(),
  listTaskMessages: vi.fn(),
  listTaskRunTodosForRun: vi.fn(),
  replaceTaskRunTodosForRun: vi.fn(),
  updateTaskRunTodo: vi.fn(),
  startTaskRunTodoIfStillPendingAndNoEarlierOpen: vi.fn(),
}));

describe('Schema-first supervisor loop', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(repo.getTaskRun).mockResolvedValue({ id: 'run-1', taskId: 'task-1' } as never);
    vi.mocked(repo.getTask).mockResolvedValue({
      id: 'task-1',
      objective: 'Create fizzbuzz.ts',
      acceptanceCriteria: 'File exists',
    } as never);
    vi.mocked(repo.listTaskMessages).mockResolvedValue([] as never);
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
    vi.mocked(mcpClientManager.listAvailableTools).mockResolvedValue([]);
    vi.mocked(mcpClientManager.callTool).mockResolvedValue({
      content: [{ type: 'text', text: '## Workflow\n1. 仕様に沿って実装する。' }],
    });
  });

  it('forces a Todo-capable workflow when open Todos already exist', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-open-todo-workflow-'));
    const createdTodos = [
      {
        id: 'todo-1',
        runId: 'run-1',
        seq: 1,
        title: '実装する',
        taskType: 'implementation',
        status: 'running',
        procedureId: null,
        startedAt: new Date('2026-06-16T00:00:00.000Z'),
      },
    ];
    let currentTodos = createdTodos;
    vi.mocked(repo.listTaskRunTodosForRun).mockImplementation(async () => currentTodos as never);
    vi.mocked(repo.updateTaskRunTodo).mockImplementation(async (todoId, patch) => {
      currentTodos = currentTodos.map((todo) =>
        todo.id === todoId ? { ...todo, ...patch } : todo
      );
      return currentTodos.find((todo) => todo.id === todoId) as never;
    });
    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        jobType: 'planning',
        goal: '実装計画をまとめる',
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'finalize_answer',
          arguments: { message: 'まだ TODO を閉じていない完了報告' },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'apply_patch',
          arguments: {
            patchContent: [
              '--- /dev/null',
              '+++ b/implementation-evidence.txt',
              '@@ -0,0 +1 @@',
              '+implemented',
              '',
            ].join('\n'),
          },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'todo_list',
          arguments: { operation: 'done' },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'finalize_answer',
          arguments: { message: '完了しました。' },
        },
      });

    try {
      const result = await runSupervisorLoop({
        runId: 'run-1',
        repoRoot,
        prompt: '実装してください',
        timeoutSeconds: 60,
      });

      expect(result.finalReport).toBe('完了しました。');
      const firstRound2SystemPrompt = vi.mocked(llm.callSupervisorLLM).mock.calls[1]?.[0] as string;
      const firstRound2UserPrompt = vi.mocked(llm.callSupervisorLLM).mock.calls[1]?.[1] as string;
      expect(firstRound2SystemPrompt).toContain('jobType=major_code_edit');
      expect(firstRound2SystemPrompt).toContain('todo_list');
      expect(firstRound2UserPrompt).toContain('"workflow": "major_code_edit"');
      expect(repo.updateTaskRunTodo).toHaveBeenCalledWith(
        'todo-1',
        expect.objectContaining({ status: 'passed' })
      );
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('reads the specification before Round 1 and runs context_compile before implementation Todos', async () => {
    const repoRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'nightworkers-context-compile-order-')
    );
    const specContent = [
      '## 目的',
      '画面内一時データの Todo List を実装する。',
      '',
      '## 受け入れ条件',
      '- 新規 Todo を作成できる',
      '- Todo を編集できる',
      '- Todo の完了状態を切り替えられる',
    ].join('\n');
    const currentTodos = [
      {
        id: 'todo-1',
        runId: 'run-1',
        seq: 1,
        title: 'initial_instructions を実行する',
        taskType: 'initial_instructions',
        status: 'passed',
        procedureId: 'contextstill.initial_instructions',
      },
      {
        id: 'todo-2',
        runId: 'run-1',
        seq: 2,
        title: 'context_compile を実行する',
        taskType: 'context_compile',
        status: 'running',
        procedureId: 'contextstill.context_compile',
        startedAt: new Date('2026-06-16T00:00:00.000Z'),
      },
      {
        id: 'todo-3',
        runId: 'run-1',
        seq: 3,
        title: '仕様と既存構成を確認する',
        taskType: 'inspection',
        status: 'pending',
        procedureId: null,
      },
    ];
    let todos = currentTodos;
    vi.mocked(repo.listTaskMessages).mockResolvedValue([
      {
        id: 'spec-1',
        taskId: 'task-1',
        role: 'assistant',
        messageType: 'markdown_document',
        content: specContent,
        createdAt: new Date('2026-06-16T00:00:00.000Z'),
        metadataJson: {
          intent: 'draft_spec',
          title: 'Todo List Specification',
          markdownDocumentData: {
            title: 'Todo List Specification',
            content: specContent,
          },
          generation: {
            context: {
              blueprintSummaryIncluded: true,
              dbDdlReferenceIncluded: true,
            },
          },
        },
      },
    ] as never);
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
        serverId: 'context-server',
        serverName: 'context-still',
        toolPrefix: 'context_still',
        name: 'context_compile',
        namespacedName: 'mcp__context_still__context_compile',
      },
    ]);
    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        jobType: 'major_code_edit',
        goal: '仕様書に沿って Todo List を実装する',
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'todo_list',
          arguments: { operation: 'done' },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'finalize_answer',
          arguments: { message: '完了しました。' },
        },
      });

    try {
      const result = await runSupervisorLoop({
        runId: 'run-1',
        repoRoot,
        prompt: '実装してください',
        timeoutSeconds: 60,
      });

      expect(result.finalReport).toBe('完了しました。');
      expect(mcpClientManager.callTool).toHaveBeenCalledWith(
        'context-server',
        'context_compile',
        expect.objectContaining({
          goal: expect.stringContaining('Todo List Specification'),
          changeTypes: ['implementation', 'verification'],
        })
      );
      expect(vi.mocked(repo.listTaskMessages).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(llm.callSupervisorLLM).mock.invocationCallOrder[0]
      );
      expect(vi.mocked(llm.callSupervisorLLM).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(mcpClientManager.callTool).mock.invocationCallOrder[0]
      );
      const firstRound1UserPrompt = vi.mocked(llm.callSupervisorLLM).mock.calls[0]?.[1] as string;
      expect(firstRound1UserPrompt).toContain('[Current Specification]');
      expect(firstRound1UserPrompt).toContain('Todo List Specification');
      const firstRound2UserPrompt = vi.mocked(llm.callSupervisorLLM).mock.calls[1]?.[1] as string;
      expect(
        parseRound2UserContextJsonSection(firstRound2UserPrompt, 'Current Execution State')
      ).toMatchObject({
        currentTodo: expect.objectContaining({ id: 'todo-3', status: 'running' }),
      });
      expect(
        parseRound2UserContextJsonSection(firstRound2UserPrompt, 'Recent Tool Evidence')
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ toolName: 'read_current_specification', ok: true }),
          expect.objectContaining({ toolName: 'context-still.context_compile', ok: true }),
        ])
      );
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('stops before the Round 2 provider call and closes open Todos when prompt budget is exceeded', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-budget-exceeded-'));
    const settingsPath = path.join(repoRoot, 'llm-settings.json');
    const previousSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
    process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = settingsPath;
    await fs.writeFile(
      settingsPath,
      JSON.stringify({
        ACTIVE_LLM_PROVIDER: 'azure',
        providerEndpoints: [
          {
            id: 'local-qwen-small',
            name: 'Local Qwen Small',
            kind: 'local',
            enabled: true,
            baseUrl: 'http://localhost:11434/v1',
            models: ['qwen-small'],
            modelCapabilities: {
              'qwen-small': {
                contextWindowTokens: 8,
                safePromptBudgetTokens: 1,
                reservedOutputTokens: 7,
                supportsProviderSideCompression: true,
                compressionProfile: 'aggressive',
              },
            },
          },
        ],
        roleRoutes: [
          {
            role: 'implementation',
            primary: { providerEndpointId: 'local-qwen-small', model: 'qwen-small' },
            fallbacks: [],
          },
        ],
      })
    );
    const createdTodos = [
      {
        id: 'todo-1',
        runId: 'run-1',
        seq: 1,
        title: '実装する',
        taskType: 'implementation',
        status: 'running',
        procedureId: 'major_code_edit',
        startedAt: new Date('2026-06-16T00:00:00.000Z'),
      },
      {
        id: 'todo-2',
        runId: 'run-1',
        seq: 2,
        title: '確認する',
        taskType: 'verification',
        status: 'pending',
        procedureId: 'verification',
      },
    ];
    let currentTodos = createdTodos;
    vi.mocked(repo.listTaskRunTodosForRun).mockImplementation(async () => currentTodos as never);
    vi.mocked(repo.updateTaskRunTodo).mockImplementation(async (todoId, patch) => {
      currentTodos = currentTodos.map((todo) =>
        todo.id === todoId ? { ...todo, ...patch } : todo
      );
      return currentTodos.find((todo) => todo.id === todoId) as never;
    });
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce({
      jobType: 'major_code_edit',
      goal: '巨大な Round 2 prompt を作る',
    });

    try {
      const result = await runSupervisorLoop({
        runId: 'run-1',
        repoRoot,
        prompt: '実装してください',
        timeoutSeconds: 60,
      });

      expect(result).toMatchObject({
        terminalState: 'needs_human',
        stoppedBy: 'budget',
        summary: 'Round 2 prompt budget exceeded before provider call',
      });
      expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(1);
      expect(currentTodos.every((todo) => !['pending', 'running'].includes(todo.status))).toBe(
        true
      );
      expect(repo.updateTaskRunTodo).toHaveBeenCalledWith(
        'todo-1',
        expect.objectContaining({
          status: 'needs_human',
          statusReason: expect.stringContaining('budget_exceeded'),
        }),
        expect.any(Object)
      );
      expect(repo.updateTaskRunTodo).toHaveBeenCalledWith(
        'todo-2',
        expect.objectContaining({
          status: 'needs_human',
          statusReason: expect.stringContaining('budget_exceeded'),
        }),
        expect.any(Object)
      );
      expect(repo.createRunEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'system.warning',
          message: '[SchemaFirstAgent] run.needs_human',
        }),
        expect.objectContaining({
          payloadJson: expect.objectContaining({
            payload: expect.objectContaining({
              reason: 'budget_exceeded',
              promptBudget: expect.objectContaining({ budgetExceeded: true }),
            }),
          }),
        })
      );
    } finally {
      if (previousSettingsPath === undefined) {
        delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
      } else {
        process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = previousSettingsPath;
      }
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('allows major_code_edit to create a run-internal TodoList before edits', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-major-todos-'));
    await fs.writeFile(path.join(repoRoot, 'README.md'), 'existing workspace\n');
    let currentTodos = [] as unknown[];
    vi.mocked(repo.replaceTaskRunTodosForRun).mockImplementation(async (_runId, todos) => {
      currentTodos = todos.map((todo: unknown, index: number) => ({
        id: `todo-${index + 1}`,
        runId: 'run-1',
        ...todo,
      }));
      return currentTodos as never;
    });
    vi.mocked(repo.listTaskRunTodosForRun).mockImplementation(async () => currentTodos as never);
    vi.mocked(repo.updateTaskRunTodo).mockImplementation(async (todoId, patch) => {
      currentTodos = currentTodos.map((todo) =>
        todo.id === todoId ? { ...todo, ...patch } : todo
      );
      return currentTodos.find((todo) => todo.id === todoId) as never;
    });
    vi.mocked(repo.startTaskRunTodoIfStillPendingAndNoEarlierOpen).mockImplementation(
      async ({ id, afterSeq, startedAt }) => {
        const target = currentTodos.find((todo) => todo.id === id && todo.status === 'pending');
        const earlierOpen = currentTodos.find(
          (todo) => todo.seq <= afterSeq && ['pending', 'running'].includes(todo.status)
        );
        if (!target || earlierOpen) return null as never;
        currentTodos = currentTodos.map((todo) =>
          todo.id === id ? { ...todo, status: 'running', startedAt, completedAt: null } : todo
        );
        return currentTodos.find((todo) => todo.id === id) as never;
      }
    );
    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        jobType: 'major_code_edit',
        goal: '複数ステップの実装を完了する',
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'todo_list',
          arguments: {
            operation: 'replace',
            todos: [
              {
                seq: 1,
                title: '実装を変更する',
                taskType: 'code_edit',
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'finalize_answer',
          arguments: { message: 'TodoList を作成しました。' },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'todo_list',
          arguments: { operation: 'done' },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'todo_list',
          arguments: { operation: 'done' },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'apply_patch',
          arguments: {
            patchContent: [
              '--- /dev/null',
              '+++ b/implementation-evidence.txt',
              '@@ -0,0 +1 @@',
              '+implemented',
              '',
            ].join('\n'),
          },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'todo_list',
          arguments: { operation: 'done' },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'todo_list',
          arguments: { operation: 'done' },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'run_verification',
          arguments: {
            command: 'echo verification',
            reason: '品質ゲート verify の evidence',
          },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'todo_list',
          arguments: { operation: 'done' },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'todo_list',
          arguments: { operation: 'done' },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'finalize_answer',
          arguments: { message: 'TodoList を作成しました。' },
        },
      })
      .mockResolvedValue({
        toolCall: {
          name: 'finalize_answer',
          arguments: { message: 'TodoList を作成しました。' },
        },
      });

    try {
      const result = await runSupervisorLoop({
        runId: 'run-1',
        repoRoot,
        prompt: 'major code edit を実行して',
        timeoutSeconds: 60,
      });

      expect(result.finalReport).toBe('TodoList を作成しました。');
      expect(repo.replaceTaskRunTodosForRun).toHaveBeenCalledWith(
        'run-1',
        expect.arrayContaining([
          expect.objectContaining({
            seq: 1,
            title: 'initial_instructions を実行する',
            status: 'running',
          }),
          expect.objectContaining({
            seq: 2,
            title: 'context_compile を実行する',
            status: 'pending',
          }),
          expect.objectContaining({
            seq: 3,
            title: '実装を変更する',
            taskType: 'code_edit',
            status: 'pending',
          }),
          expect.objectContaining({
            seq: 4,
            title: 'LLM コードレビューを実施する',
            status: 'pending',
          }),
          expect.objectContaining({
            seq: 6,
            title: '知識登録を行う',
            status: 'pending',
          }),
        ])
      );
      const secondRound2ExecutionState = parseRound2UserContextJsonSection<unknown>(
        vi.mocked(llm.callSupervisorLLM).mock.calls[2]?.[1] as string,
        'Current Execution State'
      );
      const firstRound2ProcedureSummaries = parseRound2UserContextJsonSection<unknown[]>(
        vi.mocked(llm.callSupervisorLLM).mock.calls[1]?.[1] as string,
        'Loaded Procedure Summaries'
      );
      expect(firstRound2ProcedureSummaries).toEqual([
        expect.objectContaining({
          jobType: 'major_code_edit',
          path: 'procedures/major_code_edit.md',
          procedure: expect.arrayContaining([
            expect.stringContaining('空の Project root は有効な作業対象'),
          ]),
          loadedAtStep: 0,
        }),
      ]);
      expect(secondRound2ExecutionState.todoPlan).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'todo-1', seq: 1, status: 'running' }),
          expect.objectContaining({ id: 'todo-2', seq: 2, status: 'pending' }),
          expect.objectContaining({ id: 'todo-4', seq: 4, taskType: 'review', status: 'pending' }),
          expect.objectContaining({
            id: 'todo-6',
            seq: 6,
            taskType: 'knowledge_capture',
            status: 'pending',
          }),
        ])
      );
      expect(secondRound2ExecutionState.currentTodo).toEqual(
        expect.objectContaining({ id: 'todo-1', seq: 1, status: 'running' })
      );
      const thirdRound2ToolEvidence = parseRound2UserContextJsonSection<unknown[]>(
        vi.mocked(llm.callSupervisorLLM).mock.calls[3]?.[1] as string,
        'Recent Tool Evidence'
      );
      expect(thirdRound2ToolEvidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            toolName: 'finalize_answer',
            ok: false,
            summary: expect.stringContaining('Cannot finalize while TodoList has open items'),
          }),
        ])
      );
      expect(repo.updateTaskRunTodo).toHaveBeenCalledWith(
        'todo-1',
        expect.objectContaining({ status: 'passed' })
      );
      expect(repo.updateTaskRunTodo).toHaveBeenCalledWith(
        'todo-7',
        expect.objectContaining({ status: 'passed' }),
        expect.objectContaining({ notifyRunId: 'run-1', notifyTaskId: 'task-1' })
      );
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('runs minor_code_edit with jobType+goal Round 1 and toolCall-only Round 2', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-schema-first-'));
    await execFileAsync('git', ['init'], { cwd: repoRoot });

    const promptWithStateCard = [
      '<USER_REQUEST>',
      'fizzbuzz.tsをプロジェクトルートに作ってください',
      '</USER_REQUEST>',
      '',
      '<STATE_CARD>',
      'Files:',
      '- target: fizzbuzz.ts',
      '',
      'Relevant code:',
      'File: fizzbuzz.ts (target_file_small)',
      '```',
      'for (let i = 1; i <= 100; i += 1) {}',
      '```',
      '</STATE_CARD>',
    ].join('\n');

    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        jobType: 'minor_code_edit',
        goal: 'プロジェクトルートに fizzbuzz.ts を作成する',
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'apply_patch',
          arguments: {
            patchContent: [
              '--- /dev/null',
              '+++ b/fizzbuzz.ts',
              '@@ -0,0 +1,6 @@',
              '+for (let i = 1; i <= 100; i += 1) {',
              '+  if (i % 15 === 0) console.log("FizzBuzz");',
              '+  else if (i % 3 === 0) console.log("Fizz");',
              '+  else if (i % 5 === 0) console.log("Buzz");',
              '+  else console.log(i);',
              '+}',
              '',
            ].join('\n'),
          },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'finalize_answer',
          arguments: { message: 'プロジェクトルートに `fizzbuzz.ts` を作成しました。' },
        },
      });

    try {
      const result = await runSupervisorLoop({
        runId: 'run-1',
        repoRoot,
        prompt: promptWithStateCard,
        timeoutSeconds: 60,
      });

      expect(result).toMatchObject({
        finalReport: 'プロジェクトルートに `fizzbuzz.ts` を作成しました。',
        terminalState: 'completed',
        stoppedBy: 'decision',
      });
      expect(await fs.readFile(path.join(repoRoot, 'fizzbuzz.ts'), 'utf-8')).toContain('FizzBuzz');
      expect(vi.mocked(llm.callSupervisorLLM).mock.calls.map((call) => call[2])).toEqual([
        expect.objectContaining({ round: 1, schemaFirst: true }),
        expect.objectContaining({ round: 2, schemaFirst: true }),
        expect.objectContaining({ round: 2, schemaFirst: true }),
      ]);
      const firstRound2UserPrompt = vi.mocked(llm.callSupervisorLLM).mock.calls[1]?.[1] as string;
      expect(firstRound2UserPrompt).toContain('[Latest User Request]');
      expect(firstRound2UserPrompt).toContain(promptWithStateCard);
      expect(firstRound2UserPrompt).toContain(
        '[Goal]\nプロジェクトルートに fizzbuzz.ts を作成する'
      );
      expect(
        parseRound2UserContextJsonSection(firstRound2UserPrompt, 'Continuity Context')
      ).toMatchObject({ currentJobType: 'minor_code_edit' });
      expect(
        parseRound2UserContextJsonSection(firstRound2UserPrompt, 'Recent Tool Evidence')
      ).toEqual([]);
      expect(
        parseRound2UserContextJsonSection(firstRound2UserPrompt, 'Loaded Procedure Summaries')
      ).toEqual([]);
      expect(vi.mocked(llm.callSupervisorLLM)).toHaveBeenCalledTimes(3);
      expect(vi.mocked(llm.callSupervisorLLM).mock.calls.length).toBeLessThanOrEqual(20);
      expect(repo.updateTaskRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          finalReport: 'プロジェクトルートに `fizzbuzz.ts` を作成しました。',
          summary: 'プロジェクトルートに `fizzbuzz.ts` を作成しました。',
          status: 'completed',
          contextSnapshot: expect.objectContaining({
            executionReview: expect.objectContaining({
              checklist: [
                expect.objectContaining({
                  source: 'worker_tool',
                  evidenceRef: 'tool:1:apply_patch',
                }),
              ],
              workerEvidenceItemCount: 1,
            }),
          }),
        })
      );
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('rejects an empty-root major_code_edit todo list that hides the bootstrap step', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-empty-bootstrap-'));

    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        jobType: 'major_code_edit',
        goal: 'React と Hono の TODO アプリを新規作成する',
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'todo_list',
          arguments: {
            operation: 'replace',
            todos: [
              {
                seq: 1,
                title: 'TODO アプリを実装する',
              },
              {
                seq: 2,
                title: '検証する',
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'todo_list',
          arguments: {
            operation: 'replace',
            todos: [
              {
                seq: 1,
                title: 'import_project で hono-standard を取り込む',
                description: 'import_project を使って React/Hono/SQLite の土台を作る',
              },
              {
                seq: 2,
                title: 'TODO アプリを実装する',
              },
              {
                seq: 3,
                title: '検証する',
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'todo_list',
          arguments: { operation: 'done' },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'todo_list',
          arguments: { operation: 'block' },
        },
      });

    let currentTodos = [] as unknown[];
    vi.mocked(repo.replaceTaskRunTodosForRun).mockImplementation(async (_runId, todos) => {
      currentTodos = todos.map((todo: unknown, index: number) => ({
        id: `todo-${index + 1}`,
        runId: 'run-1',
        ...todo,
      }));
      return currentTodos as never;
    });
    vi.mocked(repo.listTaskRunTodosForRun).mockImplementation(async () => currentTodos as never);
    vi.mocked(repo.updateTaskRunTodo).mockImplementation(async (todoId, patch) => {
      currentTodos = currentTodos.map((todo) =>
        todo.id === todoId ? { ...todo, ...patch } : todo
      );
      return currentTodos.find((todo) => todo.id === todoId) as never;
    });
    vi.mocked(repo.startTaskRunTodoIfStillPendingAndNoEarlierOpen).mockImplementation(
      async ({ id, afterSeq, startedAt }) => {
        const target = currentTodos.find((todo) => todo.id === id && todo.status === 'pending');
        const earlierOpen = currentTodos.find(
          (todo) => todo.seq <= afterSeq && ['pending', 'running'].includes(todo.status)
        );
        if (!target || earlierOpen) return null as never;
        currentTodos = currentTodos.map((todo) =>
          todo.id === id ? { ...todo, status: 'running', startedAt, completedAt: null } : todo
        );
        return currentTodos.find((todo) => todo.id === id) as never;
      }
    );

    try {
      const result = await runSupervisorLoop({
        runId: 'run-1',
        repoRoot,
        prompt: 'React と Hono と SQLite で新しい TODO アプリを作って',
        timeoutSeconds: 60,
      });

      expect(result.terminalState).toBe('needs_human');
      expect(repo.replaceTaskRunTodosForRun).toHaveBeenCalledTimes(1);
      expect(repo.replaceTaskRunTodosForRun).toHaveBeenCalledWith(
        'run-1',
        expect.arrayContaining([
          expect.objectContaining({ seq: 1, title: 'initial_instructions を実行する' }),
          expect.objectContaining({ seq: 2, title: 'context_compile を実行する' }),
          expect.objectContaining({
            seq: 3,
            title: 'import_project で hono-standard を取り込む',
          }),
          expect.objectContaining({ taskType: 'review', procedureId: 'llm_code_review' }),
          expect.objectContaining({
            taskType: 'knowledge_capture',
            procedureId: 'contextstill.register_candidates',
          }),
        ])
      );
      const retryToolEvidence = parseRound2UserContextJsonSection<unknown[]>(
        vi.mocked(llm.callSupervisorLLM).mock.calls[2]?.[1] as string,
        'Recent Tool Evidence'
      );
      expect(retryToolEvidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            toolName: 'todo_list',
            ok: false,
            summary: expect.stringContaining('dedicated bootstrap Todo'),
          }),
        ])
      );
      const initialWorkspaceSnapshot = parseRound2UserContextJsonSection<unknown>(
        vi.mocked(llm.callSupervisorLLM).mock.calls[1]?.[1] as string,
        'Workspace Snapshot'
      );
      expect(initialWorkspaceSnapshot).toMatchObject({
        isEmpty: true,
        topLevelDirs: [],
        topLevelFiles: [],
      });
      const bootstrapProgressContext = parseRound2UserContextJsonSection<unknown>(
        vi.mocked(llm.callSupervisorLLM).mock.calls[2]?.[1] as string,
        'Progress Context'
      );
      expect(bootstrapProgressContext).toMatchObject({
        nextConcreteAction: expect.stringContaining('import_project'),
      });
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('rejects repeated TodoList replace before executing the running bootstrap Todo', async () => {
    const repoRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'nightworkers-redundant-bootstrap-replace-')
    );
    let currentTodos = [] as unknown[];
    vi.mocked(repo.replaceTaskRunTodosForRun).mockImplementation(async (_runId, todos) => {
      currentTodos = todos.map((todo: unknown, index: number) => ({
        id: `todo-${index + 1}`,
        runId: 'run-1',
        ...todo,
      }));
      return currentTodos as never;
    });
    vi.mocked(repo.listTaskRunTodosForRun).mockImplementation(async () => currentTodos as never);
    vi.mocked(repo.updateTaskRunTodo).mockImplementation(async (todoId, patch) => {
      currentTodos = currentTodos.map((todo) =>
        todo.id === todoId ? { ...todo, ...patch } : todo
      );
      return currentTodos.find((todo) => todo.id === todoId) as never;
    });
    vi.mocked(repo.startTaskRunTodoIfStillPendingAndNoEarlierOpen).mockImplementation(
      async ({ id, afterSeq, startedAt }) => {
        const target = currentTodos.find((todo) => todo.id === id && todo.status === 'pending');
        const earlierOpen = currentTodos.find(
          (todo) => todo.seq <= afterSeq && ['pending', 'running'].includes(todo.status)
        );
        if (!target || earlierOpen) return null as never;
        currentTodos = currentTodos.map((todo) =>
          todo.id === id ? { ...todo, status: 'running', startedAt, completedAt: null } : todo
        );
        return currentTodos.find((todo) => todo.id === id) as never;
      }
    );
    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        jobType: 'major_code_edit',
        goal: 'TODO アプリを実装する',
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'todo_list',
          arguments: {
            operation: 'replace',
            todos: [
              {
                seq: 1,
                title: 'import_project で hono-standard を取り込む',
                description: 'import_project を使って React/Hono/SQLite の土台を作る',
              },
              {
                seq: 2,
                title: 'TODO アプリを実装する',
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'todo_list',
          arguments: {
            operation: 'replace',
            todos: [
              {
                seq: 1,
                title: 'TODO アプリを実装する',
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'todo_list',
          arguments: { operation: 'done' },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'todo_list',
          arguments: { operation: 'fail' },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'finalize_answer',
          arguments: { message: 'bootstrap Todo の再 replace を拒否しました。' },
        },
      });

    try {
      const result = await runSupervisorLoop({
        runId: 'run-1',
        repoRoot,
        prompt: 'React と Hono と SQLite で新しい TODO アプリを作って',
        timeoutSeconds: 60,
        maxIterations: 3,
      });

      expect(result.terminalState).toBe('needs_human');
      expect(result.stoppedBy).toBe('budget');
      expect(repo.replaceTaskRunTodosForRun).toHaveBeenCalledTimes(1);
      const retryToolEvidence = parseRound2UserContextJsonSection<unknown[]>(
        vi.mocked(llm.callSupervisorLLM).mock.calls[3]?.[1] as string,
        'Recent Tool Evidence'
      );
      expect(retryToolEvidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            toolName: 'todo_list',
            ok: false,
            summary: expect.stringContaining('TodoList already exists'),
          }),
        ])
      );
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('rejects repeated TodoList list calls while an implementation Todo is running', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-redundant-todo-list-'));
    let currentTodos = [
      {
        id: 'todo-1',
        runId: 'run-1',
        seq: 1,
        title: 'Todo List 画面を実装する',
        description: null,
        taskType: 'implementation',
        status: 'running',
        procedureId: null,
        startedAt: new Date('2026-06-16T00:00:00.000Z'),
        completedAt: null,
      },
    ];
    vi.mocked(repo.listTaskRunTodosForRun).mockImplementation(async () => currentTodos as never);
    vi.mocked(repo.updateTaskRunTodo).mockImplementation(async (todoId, patch) => {
      currentTodos = currentTodos.map((todo) =>
        todo.id === todoId ? { ...todo, ...patch } : todo
      );
      return currentTodos.find((todo) => todo.id === todoId) as never;
    });
    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        jobType: 'major_code_edit',
        goal: 'Todo List 画面を実装する',
      })
      .mockResolvedValueOnce({
        toolCall: { name: 'todo_list', arguments: { operation: 'list' } },
      })
      .mockResolvedValueOnce({
        toolCall: { name: 'todo_list', arguments: { operation: 'list' } },
      })
      .mockResolvedValueOnce({
        toolCall: { name: 'todo_list', arguments: { operation: 'list' } },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'apply_patch',
          arguments: {
            patchContent: [
              '--- /dev/null',
              '+++ b/todo-list.txt',
              '@@ -0,0 +1 @@',
              '+implemented',
              '',
            ].join('\n'),
          },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'todo_list',
          arguments: { operation: 'done' },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'finalize_answer',
          arguments: { message: '完了しました。' },
        },
      });

    try {
      const result = await runSupervisorLoop({
        runId: 'run-1',
        repoRoot,
        prompt: 'Todo List 画面を実装してください',
        timeoutSeconds: 60,
      });

      expect(result.terminalState).toBe('completed');
      expect(result.finalReport).toBe('完了しました。');
      const validationFailure = vi
        .mocked(repo.createRunEvent)
        .mock.calls.find(
          ([, options]) =>
            options?.payloadJson?.agentEventType === 'tool.validation_failed' &&
            options.payloadJson.payload?.toolName === 'todo_list'
        );
      expect(validationFailure?.[1]?.payloadJson?.payload).toMatchObject({
        ok: false,
        arguments: { operation: 'list' },
        summary: expect.stringContaining('TodoList も作業状態も変更しません'),
      });
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('allows major_code_edit runs to continue beyond the legacy 20 tool-call ceiling', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-major-tool-budget-'));
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce({
      jobType: 'major_code_edit',
      goal: '複数ステップの実装を完了する',
    });
    for (let index = 0; index < 22; index += 1) {
      vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce({
        toolCall: {
          name: 'search_procedure',
          arguments: { query: `implementation step ${index + 1}`, maxResults: 1 },
        },
      });
    }
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce({
      toolCall: {
        name: 'finalize_answer',
        arguments: { message: '完了しました。' },
      },
    });

    try {
      const result = await runSupervisorLoop({
        runId: 'run-1',
        repoRoot,
        prompt: '大きめの実装をしてください',
        timeoutSeconds: 60,
      });

      expect(result.terminalState).toBe('completed');
      expect(result.finalReport).toBe('完了しました。');
      expect(vi.mocked(llm.callSupervisorLLM)).toHaveBeenCalledTimes(24);
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('uses the pre-read specification instead of re-running read_current_specification in Round 2', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-cached-spec-'));
    const specContent = '## 目的\nTodo List を実装する。';
    vi.mocked(repo.listTaskMessages).mockResolvedValue([
      {
        id: 'spec-1',
        taskId: 'task-1',
        role: 'assistant',
        messageType: 'markdown_document',
        content: specContent,
        createdAt: new Date('2026-06-16T00:00:00.000Z'),
        metadataJson: {
          intent: 'draft_spec',
          title: 'Todo List Specification',
          markdownDocumentData: {
            title: 'Todo List Specification',
            content: specContent,
          },
        },
      },
    ] as never);
    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        jobType: 'major_code_edit',
        goal: '仕様書に沿って Todo List を実装する',
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'read_current_specification',
          arguments: {},
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'finalize_answer',
          arguments: { message: '仕様確認済みです。' },
        },
      });

    try {
      const result = await runSupervisorLoop({
        runId: 'run-1',
        repoRoot,
        prompt: '仕様を見て実装してください',
        timeoutSeconds: 60,
      });

      expect(result.finalReport).toBe('仕様確認済みです。');
      expect(repo.listTaskMessages).toHaveBeenCalledTimes(1);
      const cachedSpecEvent = vi
        .mocked(repo.createRunEvent)
        .mock.calls.find(
          ([event, options]) =>
            event.message === '[SchemaFirstAgent] tool.finished' &&
            (options as { payloadJson?: { payload?: { toolName?: string; summary?: string } } })
              .payloadJson?.payload?.toolName === 'read_current_specification' &&
            String(
              (options as { payloadJson?: { payload?: { summary?: string } } }).payloadJson?.payload
                ?.summary || ''
            ).includes('cached=true')
        );
      expect(cachedSpecEvent).toBeTruthy();
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('auto-refreshes repeated read_file calls after an unchanged-file cache marker', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-readfile-refresh-'));
    await fs.writeFile(path.join(repoRoot, 'home-view.tsx'), 'export function HomeView() {}\n');
    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        jobType: 'minor_code_edit',
        goal: 'home-view.tsx を確認する',
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'read_file',
          arguments: { filePath: 'home-view.tsx' },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'read_file',
          arguments: { filePath: 'home-view.tsx' },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'read_file',
          arguments: { filePath: 'home-view.tsx' },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'finalize_answer',
          arguments: { message: '確認しました。' },
        },
      });

    try {
      const result = await runSupervisorLoop({
        runId: 'run-1',
        repoRoot,
        prompt: 'home-view.tsx を確認してください',
        timeoutSeconds: 60,
      });

      expect(result.finalReport).toBe('確認しました。');
      const readFileEvents = vi
        .mocked(repo.createRunEvent)
        .mock.calls.filter(
          ([event, options]) =>
            event.message === '[SchemaFirstAgent] tool.finished' &&
            (options as { payloadJson?: { payload?: { toolName?: string } } }).payloadJson?.payload
              ?.toolName === 'read_file'
        )
        .map(
          ([, options]) =>
            (options as { payloadJson?: { payload?: Record<string, unknown> } }).payloadJson
              ?.payload
        );

      expect(readFileEvents).toHaveLength(3);
      expect(String(readFileEvents[1]?.summary)).toContain('"status": "cached"');
      expect(readFileEvents[2]?.arguments).toMatchObject({
        filePath: 'home-view.tsx',
        fresh: true,
      });
      expect(String(readFileEvents[2]?.summary)).not.toContain('"status": "cached"');
      expect(String(readFileEvents[2]?.summary)).toContain('export function HomeView');
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('does not execute a returned tool call after the run is cancelled', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-cancelled-loop-'));
    await fs.writeFile(path.join(repoRoot, 'home-view.tsx'), 'export function HomeView() {}\n');
    let runStatus = 'running';
    vi.mocked(repo.getTaskRun).mockImplementation(
      async () =>
        ({
          id: 'run-1',
          taskId: 'task-1',
          status: runStatus,
          summary: runStatus === 'cancelled' ? 'Run stop requested by user.' : null,
          finalReport: runStatus === 'cancelled' ? 'Run stop requested by user.' : null,
        }) as never
    );
    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        jobType: 'minor_code_edit',
        goal: 'home-view.tsx を確認する',
      })
      .mockImplementationOnce(async () => {
        runStatus = 'cancelled';
        return {
          toolCall: {
            name: 'read_file',
            arguments: { filePath: 'home-view.tsx' },
          },
        };
      });

    try {
      const result = await runSupervisorLoop({
        runId: 'run-1',
        repoRoot,
        prompt: 'home-view.tsx を確認してください',
        timeoutSeconds: 60,
      });

      expect(result).toMatchObject({
        terminalState: 'cancelled',
        stoppedBy: 'cancelled',
        finalReport: 'Run stop requested by user.',
      });
      expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(2);
      const readFileStarted = vi
        .mocked(repo.createRunEvent)
        .mock.calls.some(
          ([event, options]) =>
            event.message === '[SchemaFirstAgent] tool.started' &&
            (options as { payloadJson?: { payload?: { toolName?: string } } }).payloadJson?.payload
              ?.toolName === 'read_file'
        );
      expect(readFileStarted).toBe(false);
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('emits an actionable final report when reserving closeout budget', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-closeout-reserve-'));
    const todos = [
      {
        id: 'todo-1',
        runId: 'run-1',
        seq: 1,
        title: '実装する',
        taskType: 'implementation',
        status: 'running',
        procedureId: null,
      },
    ];
    let currentTodos = todos;
    vi.mocked(repo.listTaskRunTodosForRun).mockImplementation(async () => currentTodos as never);
    vi.mocked(repo.updateTaskRunTodo).mockImplementation(async (todoId, patch) => {
      currentTodos = currentTodos.map((todo) =>
        todo.id === todoId ? { ...todo, ...patch } : todo
      );
      return currentTodos.find((todo) => todo.id === todoId) as never;
    });
    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        jobType: 'major_code_edit',
        goal: '実装する',
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'search_procedure',
          arguments: { query: 'implementation', maxResults: 1 },
        },
      });

    try {
      const result = await runSupervisorLoop({
        runId: 'run-1',
        repoRoot,
        prompt: '実装してください',
        timeoutSeconds: 60,
        maxToolCalls: 3,
      });

      expect(result.terminalState).toBe('needs_human');
      expect(result.finalReport).toContain('Supervisor の tool call 予算');
      expect(result.finalReport).toContain('最後の tool: search_procedure');
      expect(result.finalReport).toContain('#1 needs_human: 実装する');
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('does not mark a finalized run completed when TodoList contains needs_human work', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-needs-human-todo-'));
    const needsHumanTodos = [
      {
        id: 'todo-1',
        runId: 'run-1',
        seq: 1,
        title: '実装対象を確認する',
        taskType: 'investigation',
        status: 'needs_human',
        statusReason: 'Project root is empty.',
      },
    ];
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue(needsHumanTodos as never);

    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        jobType: 'major_code_edit',
        goal: '仕様書に沿って実装する',
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'finalize_answer',
          arguments: { message: '既存ファイルがないため対応できません。' },
        },
      });

    try {
      const result = await runSupervisorLoop({
        runId: 'run-1',
        repoRoot,
        prompt: '現在のSpecification artifactを実装して',
        timeoutSeconds: 60,
      });

      expect(result.terminalState).toBe('needs_human');
      expect(repo.updateTaskRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          status: 'needs_human',
          finalReport: '既存ファイルがないため対応できません。',
        })
      );
      expect(repo.updateTaskStatus).toHaveBeenCalledWith('task-1', 'needs_human');
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('persists all runtime, LLM, and tool activity as append-only events', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-events-'));

    vi.mocked(llm.callSupervisorLLM)
      .mockImplementationOnce(async (_system, _user, options) => {
        await options?.emitEvent?.({
          type: 'model.request_started',
          severity: 'info',
          message: 'round1 start',
          data: { raw: 'request' },
        });
        await options?.emitEvent?.({
          type: 'model.response_finished',
          severity: 'info',
          message: 'round1 raw',
          data: { rawContent: '{"jobType":"minor_code_edit","goal":"完了する"}' },
        });
        return { jobType: 'minor_code_edit', goal: '完了する' } as never;
      })
      .mockImplementationOnce(async (_system, _user, options) => {
        await options?.emitEvent?.({
          type: 'model.response_finished',
          severity: 'info',
          message: 'round2 raw',
          data: {
            rawContent:
              '{"toolCall":{"name":"finalize_answer","arguments":{"message":"完了しました。"}}}',
          },
        });
        return {
          toolCall: {
            name: 'finalize_answer',
            arguments: { message: '完了しました。' },
          },
        } as never;
      });

    try {
      await runSupervisorLoop({
        runId: 'run-1',
        repoRoot,
        prompt: '完了して',
        timeoutSeconds: 60,
      });

      const payloads = vi
        .mocked(repo.createRunEvent)
        .mock.calls.map((call) => call[1]?.payloadJson || {});
      expect(payloads).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ agentEventType: 'run.started' }),
          expect.objectContaining({ agentEventType: 'round1.prompt_built' }),
          expect.objectContaining({ agentEventType: 'model.request_started' }),
          expect.objectContaining({
            agentEventType: 'model.response_finished',
            rawContent: '{"jobType":"minor_code_edit","goal":"完了する"}',
          }),
          expect.objectContaining({ agentEventType: 'round1.parsed' }),
          expect.objectContaining({ agentEventType: 'round2.prompt_built' }),
          expect.objectContaining({ agentEventType: 'round2.parsed' }),
          expect.objectContaining({ agentEventType: 'finalize.received' }),
          expect.objectContaining({ agentEventType: 'run.completed' }),
        ])
      );
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('lets the supervisor read a procedure on demand and reuses the loaded summary', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-read-procedure-'));

    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({ jobType: 'minor_code_edit', goal: 'procedure を読んで完了する' })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'read_procedure',
          arguments: { jobType: 'minor_code_edit' },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'finalize_answer',
          arguments: { message: '完了しました。' },
        },
      });

    try {
      const result = await runSupervisorLoop({
        runId: 'run-1',
        repoRoot,
        prompt: 'procedure を読んで完了して',
        timeoutSeconds: 60,
      });

      expect(result.finalReport).toBe('完了しました。');
      const loadedProcedureSummaries = parseRound2UserContextJsonSection<unknown[]>(
        vi.mocked(llm.callSupervisorLLM).mock.calls[2]?.[1] as string,
        'Loaded Procedure Summaries'
      );
      expect(loadedProcedureSummaries).toEqual([
        expect.objectContaining({
          jobType: 'minor_code_edit',
          path: 'procedures/minor_code_edit.md',
          digest: expect.stringMatching(/^sha256:/),
          useWhen: expect.stringContaining('小さい変更タスク'),
          procedure: expect.arrayContaining([
            '対象パスが分かっている場合は read_file で確認し、周辺ディレクトリ一覧は取らない。',
          ]),
        }),
      ]);
      expect(
        vi
          .mocked(repo.createRunEvent)
          .mock.calls.some(
            (call) =>
              call[1]?.payloadJson?.agentEventType === 'procedure.loaded' &&
              call[1]?.payloadJson?.payload?.source === 'read_procedure'
          )
      ).toBe(true);
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
});
