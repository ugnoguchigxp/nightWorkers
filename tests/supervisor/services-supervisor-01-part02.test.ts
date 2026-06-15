import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../../api/modules/nightworkers/nightworkers.repository';
import * as llm from '../../api/services/structured-llm';
import { runSupervisorLoop } from '../../api/services/supervisor/supervisor-loop';
import { parseRound2UserContextJsonSection } from '../../api/services/supervisor/user-context';

const execFileAsync = promisify(execFile);

vi.mock('../../api/services/structured-llm', () => ({
  callSupervisorLLM: vi.fn(),
}));

vi.mock('../../api/modules/nightworkers/nightworkers.repository', () => ({
  getTaskRun: vi.fn(),
  getTask: vi.fn(),
  createRunEvent: vi.fn(),
  createTaskMessage: vi.fn(),
  updateTaskRun: vi.fn(),
  updateTaskStatus: vi.fn(),
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
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
  });

  it('allows major_code_edit to create a run-internal TodoList before edits', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-major-todos-'));
    await fs.writeFile(path.join(repoRoot, 'README.md'), 'existing workspace\n');
    const createdTodos = [
      {
        id: 'todo-1',
        runId: 'run-1',
        seq: 1,
        title: '実装対象を確認する',
        taskType: 'investigation',
        status: 'running',
        procedureId: 'investigation',
      },
      {
        id: 'todo-2',
        runId: 'run-1',
        seq: 2,
        title: '実装を変更する',
        taskType: 'code_edit',
        status: 'pending',
        procedureId: 'major_code_edit',
      },
    ];
    let currentTodos = [] as unknown[];
    vi.mocked(repo.replaceTaskRunTodosForRun).mockResolvedValue(createdTodos as never);
    vi.mocked(repo.replaceTaskRunTodosForRun).mockImplementation(async () => {
      currentTodos = createdTodos;
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
                title: '実装対象を確認する',
              },
              {
                seq: 2,
                title: '実装を変更する',
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
            title: '実装対象を確認する',
            status: 'running',
          }),
          expect.objectContaining({
            seq: 2,
            title: '実装を変更する',
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
      expect(secondRound2ExecutionState.todoPlan).toEqual([
        expect.objectContaining({ id: 'todo-1', seq: 1, status: 'running' }),
        expect.objectContaining({ id: 'todo-2', seq: 2, status: 'pending' }),
      ]);
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
        'todo-2',
        expect.objectContaining({ status: 'passed' })
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
          arguments: { message: 'bootstrap を含む TodoList を作成しました。' },
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

      expect(result.finalReport).toBe('bootstrap を含む TodoList を作成しました。');
      expect(repo.replaceTaskRunTodosForRun).toHaveBeenCalledTimes(1);
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
