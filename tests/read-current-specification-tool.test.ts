import { describe, expect, it } from 'vitest';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import { getAllowedToolsForJobType } from '../api/services/supervisor/prompt';
import { executeWorkerTool } from '../api/services/worker-tools/dispatcher';
import { listRecentSpecificationsTool } from '../api/services/worker-tools/read-current-specification';
import { todoListTool } from '../api/services/worker-tools/todo-list';

describe('read_current_specification worker tool', () => {
  it('reads the latest draft_spec markdown for a task without external MCP settings', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: read spec ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: read current specification',
      description: 'Read specification artifact',
      status: 'draft',
    });

    await repo.createTaskMessage({
      taskId: task.id,
      role: 'assistant',
      content: '# Blueprint\n\nNot the spec.',
      messageType: 'markdown_document',
      payloadJson: {
        intent: 'app_blueprint',
        appBlueprint: { id: 'bp-1', name: 'Blueprint' },
      },
    });
    await repo.createTaskMessage({
      taskId: task.id,
      role: 'assistant',
      content: '# DB Design\n\nNot the spec.',
      messageType: 'markdown_document',
      payloadJson: {
        intent: 'app_blueprint',
        artifactType: 'blueprint_db_design',
        appBlueprint: { id: 'db-1', name: 'DB Design' },
      },
    });
    const specMessage = await repo.createTaskMessage({
      taskId: task.id,
      role: 'assistant',
      content: '# Specification\n\nUse this document.',
      messageType: 'markdown_document',
      payloadJson: {
        intent: 'draft_spec',
        title: 'Specification',
        questionnaireSessionId: '11111111-1111-4111-8111-111111111111',
        generation: {
          source: 'llm',
          context: {
            blueprintSummaryIncluded: true,
            dbDdlReferenceIncluded: true,
          },
        },
        markdownDocumentData: {
          title: 'Specification',
          content: '# Specification\n\nUse this document.',
        },
      },
    });

    const dispatch = await executeWorkerTool({
      toolName: 'read_current_specification',
      args: {},
      repoRoot: '/Users/y.noguchi/Code/nightWorkers',
      taskId: task.id,
      readFiles: [],
    });

    expect(dispatch.result.ok).toBe(true);
    expect(dispatch.result.payload).toMatchObject({
      taskId: task.id,
      found: true,
      messageId: specMessage.id,
      title: 'Specification',
      content: '# Specification\n\nUse this document.',
      sources: {
        questionnaireSessionId: '11111111-1111-4111-8111-111111111111',
        blueprintSummaryIncluded: true,
        dbDdlReferenceIncluded: true,
      },
    });
    expect(String((dispatch.result.payload as never).digest)).toMatch(/^sha256:/);
  });

  it('returns found=false when no specification has been generated', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: no spec ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: no current specification',
      description: 'No specification artifact',
      status: 'draft',
    });

    const dispatch = await executeWorkerTool({
      toolName: 'read_current_specification',
      args: { taskId: task.id },
      repoRoot: '/Users/y.noguchi/Code/nightWorkers',
      readFiles: [],
    });

    expect(dispatch.result.ok).toBe(true);
    expect(dispatch.result.payload).toMatchObject({
      taskId: task.id,
      found: false,
      content: '',
      messageId: null,
    });
  });

  it('lists recent draft specifications for Codex MCP discovery', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: list specs ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: listed current specification',
      status: 'draft',
    });

    const specMessage = await repo.createTaskMessage({
      taskId: task.id,
      role: 'assistant',
      content: '# Listed Specification\n\nUse this document.',
      messageType: 'markdown_document',
      payloadJson: {
        intent: 'draft_spec',
        markdownDocumentData: {
          title: 'Listed Specification',
          content: '# Listed Specification\n\nUse this document.',
        },
      },
    });

    const result = await listRecentSpecificationsTool({ limit: 20 });

    expect(result.ok).toBe(true);
    expect(result.payload.specifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: task.id,
          taskTitle: 'TEST: listed current specification',
          messageId: specMessage.id,
          title: 'Listed Specification',
        }),
      ])
    );
  });

  it('is available to implementation-oriented supervisor jobs', () => {
    const majorTools = getAllowedToolsForJobType('major_code_edit').map((tool) => tool.name);
    expect(getAllowedToolsForJobType('minor_code_edit').map((tool) => tool.name)).toContain(
      'read_current_specification'
    );
    expect(majorTools).toContain('read_current_specification');
    expect(majorTools).toContain('import_project');
    expect(majorTools).toContain('todo_list');
    expect(majorTools.filter((tool) => tool.startsWith('todo_'))).toEqual(['todo_list']);
  });
});

describe('todo_list worker tool', () => {
  it('persists LLM-decomposed implementation Todos with fixed NightWorkers gates', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: replace todos ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: replace TodoList',
      description: 'Create a standard implementation TodoList',
      status: 'running',
    });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: createdRepo.id,
      status: 'running',
    });

    const result = await todoListTool({
      runId: run.id,
      operation: 'replace',
      todos: [
        {
          seq: 1,
          title: 'Inspect current implementation',
          taskType: 'inspection',
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.payload).toMatchObject({
      runId: run.id,
      taskId: task.id,
      action: 'todo_list',
      operation: 'replace',
    });
    expect(result.payload.todos.map((todo) => todo.taskType)).toEqual([
      'initial_instructions',
      'context_compile',
      'inspection',
      'review',
      'verification',
      'knowledge_capture',
      'completion_report',
    ]);
    expect(result.payload.todos[0]).toMatchObject({ seq: 1, status: 'running' });

    const persisted = await repo.listTaskRunTodosForRun(run.id);
    expect(persisted.map((todo) => todo.taskType)).toEqual(
      result.payload.todos.map((todo) => todo.taskType)
    );
  });

  it('replaces and advances persisted NightWorkers Todos', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: todo list ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: persisted TodoList',
      description: 'Advance a standard implementation TodoList',
      status: 'running',
    });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: createdRepo.id,
      status: 'running',
    });

    const replaced = await todoListTool({
      runId: run.id,
      operation: 'replace',
      todos: [{ seq: 1, title: 'Inspect implementation' }],
    });

    expect(replaced.ok).toBe(true);
    expect(replaced.payload.todos[0]).toMatchObject({
      seq: 1,
      taskType: 'initial_instructions',
      status: 'running',
    });

    const completed = await todoListTool({
      runId: run.id,
      operation: 'done',
      seq: 1,
    });

    expect(completed.ok).toBe(true);
    expect(completed.payload.todos[0]).toMatchObject({
      seq: 1,
      status: 'passed',
    });
    expect(completed.payload.todos[1]).toMatchObject({
      seq: 2,
      taskType: 'context_compile',
      status: 'running',
    });

    const persisted = await repo.listTaskRunTodosForRun(run.id);
    expect(persisted[0]).toMatchObject({ seq: 1, status: 'passed' });
    expect(persisted[0].completedAt).toBeTruthy();
    expect(persisted[1]).toMatchObject({ seq: 2, status: 'running' });
    expect(persisted[1].startedAt).toBeTruthy();
  });

  it('preserves terminal Todos when replacing the full plan', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: todo replace preserves done ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: replace preserves completed TodoList rows',
      description: 'A full TodoList refresh must not reopen completed work',
      status: 'running',
    });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: createdRepo.id,
      status: 'running',
    });

    await todoListTool({
      runId: run.id,
      operation: 'replace',
      todos: [{ seq: 1, title: 'Inspect implementation' }],
    });
    await todoListTool({ runId: run.id, operation: 'done', seq: 1 });

    const beforeReplace = await repo.listTaskRunTodosForRun(run.id);
    const completedInitialInstructions = beforeReplace[0];
    expect(completedInitialInstructions).toMatchObject({
      seq: 1,
      taskType: 'initial_instructions',
      status: 'passed',
    });
    expect(beforeReplace[1]).toMatchObject({
      seq: 2,
      taskType: 'context_compile',
      status: 'running',
    });

    const replacedAgain = await todoListTool({
      runId: run.id,
      operation: 'replace',
      todoListReplaceReason: 'estimate_changed',
      todos: [
        { seq: 1, title: 'Reconsider existing implementation' },
        { seq: 2, title: 'Apply refined implementation' },
      ],
    });

    expect(replacedAgain.ok).toBe(true);
    const persisted = await repo.listTaskRunTodosForRun(run.id);
    expect(persisted[0]).toMatchObject({
      id: completedInitialInstructions.id,
      seq: 1,
      title: 'initial_instructions を実行する',
      taskType: 'initial_instructions',
      status: 'passed',
    });
    expect(persisted[0].completedAt?.getTime()).toBe(
      completedInitialInstructions.completedAt?.getTime()
    );
    expect(persisted[1]).toMatchObject({
      seq: 2,
      taskType: 'context_compile',
      status: 'running',
    });
    expect(persisted.map((todo) => ({ seq: todo.seq, status: todo.status }))).toEqual([
      { seq: 1, status: 'passed' },
      { seq: 2, status: 'running' },
      { seq: 3, status: 'pending' },
      { seq: 4, status: 'pending' },
      { seq: 5, status: 'pending' },
      { seq: 6, status: 'pending' },
      { seq: 7, status: 'pending' },
      { seq: 8, status: 'pending' },
    ]);
  });

  it('rejects todo_list operation=replace during a running Todo without a replanning reason', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: todo replace reason ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: replace requires reason',
      description: 'A running Todo must not be completed by replacing the TodoList',
      status: 'running',
    });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: createdRepo.id,
      status: 'running',
    });

    await todoListTool({
      runId: run.id,
      operation: 'replace',
      todos: [{ seq: 1, title: 'Implement feature' }],
    });

    const result = await todoListTool({
      runId: run.id,
      operation: 'replace',
      todos: [{ seq: 1, title: 'Different implementation split' }],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: 'TODO_LIST_REPLACE_REASON_REQUIRED' });
    expect(result.error?.message).toContain('todo_list operation=replace');
    expect(result.error?.message).toContain('todo_list operation=done');
  });

  it('leaves the final knowledge registration and completion report Todos pending without running them', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: todo final closeout ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: final closeout TodoList',
      description: 'Auto-complete final closeout',
      status: 'running',
    });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: createdRepo.id,
      status: 'running',
    });

    await todoListTool({
      runId: run.id,
      operation: 'replace',
      todos: [{ seq: 1, title: 'Implement feature' }],
    });
    for (const seq of [1, 2, 3, 4, 5]) {
      const result = await todoListTool({ runId: run.id, operation: 'done', seq });
      expect(result.ok).toBe(true);
    }

    const persisted = await repo.listTaskRunTodosForRun(run.id);
    expect(persisted.at(-2)).toMatchObject({
      seq: 6,
      title: '知識登録を行う',
      taskType: 'knowledge_capture',
      procedureId: 'contextstill.register_candidates',
      status: 'pending',
    });
    expect(persisted.at(-1)).toMatchObject({
      seq: 7,
      title: '完了報告を行う',
      taskType: 'completion_report',
      procedureId: 'final_completion_report',
      status: 'pending',
    });
    expect(persisted.some((todo) => todo.status === 'running')).toBe(false);
    expect(persisted.at(-2)?.startedAt).toBeFalsy();
    expect(persisted.at(-2)?.completedAt).toBeFalsy();
    expect(persisted.at(-1)?.startedAt).toBeFalsy();
    expect(persisted.at(-1)?.completedAt).toBeFalsy();
  });

  it('starts the final completion report Todo when explicitly requested', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: todo completion start ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: start completion report Todo',
      description: 'Explicit final closeout start should persist',
      status: 'running',
    });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: createdRepo.id,
      status: 'running',
    });

    await todoListTool({
      runId: run.id,
      operation: 'replace',
      todos: [{ seq: 1, title: 'Implement feature' }],
    });
    for (const seq of [1, 2, 3, 4, 5]) {
      const result = await todoListTool({ runId: run.id, operation: 'done', seq });
      expect(result.ok).toBe(true);
    }

    const beforeStart = await repo.listTaskRunTodosForRun(run.id);
    const knowledgeTodo = beforeStart.find(
      (todo) => todo.taskType === 'knowledge_capture' && todo.seq === 6
    );
    expect(knowledgeTodo).toBeTruthy();
    await repo.updateTaskRunTodo(knowledgeTodo!.id, {
      status: 'passed',
      startedAt: new Date(),
      completedAt: new Date(),
    });

    const started = await todoListTool({ runId: run.id, operation: 'start', seq: 7 });

    expect(started.ok).toBe(true);
    expect(started.payload.currentTodo).toMatchObject({
      seq: 7,
      taskType: 'completion_report',
      procedureId: 'final_completion_report',
      status: 'running',
    });
    const persisted = await repo.listTaskRunTodosForRun(run.id);
    expect(persisted[6]).toMatchObject({
      seq: 7,
      taskType: 'completion_report',
      status: 'running',
    });
    expect(persisted[6].startedAt).toBeTruthy();
  });

  it('returns attempted todo diagnostics when complete fails', async () => {
    const failed = await todoListTool({
      runId: 'missing-run',
      operation: 'done',
      seq: 1,
    });

    expect(failed.ok).toBe(false);
    expect(failed.error).toMatchObject({ code: 'RUN_NOT_FOUND' });
    expect(failed.payload).toMatchObject({
      runId: 'missing-run',
      taskId: '',
      action: 'todo_list',
      operation: 'done',
      diagnostics: {
        errorCode: 'RUN_NOT_FOUND',
        attemptedAction: {
          action: 'todo_list',
          operation: 'done',
          seq: 1,
        },
      },
    });
  });

  it('does not start a later Todo while an earlier Todo is still open', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: todo order ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: ordered TodoList',
      description: 'Do not skip open todos',
      status: 'running',
    });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: createdRepo.id,
      status: 'running',
    });

    await todoListTool({ runId: run.id, operation: 'replace', todos: [{ title: 'Implement' }] });
    await todoListTool({ runId: run.id, operation: 'done', seq: 1 });
    await todoListTool({ runId: run.id, operation: 'done', seq: 2 });

    const result = await todoListTool({ runId: run.id, operation: 'start', seq: 6 });

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: 'PREVIOUS_TODO_OPEN' });
    const persisted = await repo.listTaskRunTodosForRun(run.id);
    expect(persisted[2]).toMatchObject({ seq: 3, status: 'running' });
    expect(persisted[5]).toMatchObject({ seq: 6, status: 'pending' });
  });

  it('does not auto-start an earlier pending Todo after completing a later Todo', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: todo no rewind ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: no backward auto-start',
      description: 'Complete a later todo',
      status: 'running',
    });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: createdRepo.id,
      status: 'running',
    });
    await repo.createTaskRunTodo({
      runId: run.id,
      seq: 1,
      title: 'Already done',
      taskType: 'implementation',
      status: 'passed',
    });
    await repo.createTaskRunTodo({
      runId: run.id,
      seq: 2,
      title: 'Earlier pending',
      taskType: 'verification',
      status: 'pending',
    });
    await repo.createTaskRunTodo({
      runId: run.id,
      seq: 3,
      title: 'Later running',
      taskType: 'knowledge_capture',
      status: 'running',
    });

    const result = await todoListTool({ runId: run.id, operation: 'done', seq: 3 });

    expect(result.ok).toBe(true);
    const persisted = await repo.listTaskRunTodosForRun(run.id);
    expect(persisted.map((todo) => ({ seq: todo.seq, status: todo.status }))).toEqual([
      { seq: 1, status: 'passed' },
      { seq: 2, status: 'pending' },
      { seq: 3, status: 'passed' },
    ]);
  });

  it('does not restart a terminal Todo', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: terminal todo ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: terminal TodoList',
      description: 'Terminal todos stay closed',
      status: 'running',
    });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: createdRepo.id,
      status: 'running',
    });
    await repo.createTaskRunTodo({
      runId: run.id,
      seq: 1,
      title: 'Failed verification',
      taskType: 'verification',
      status: 'failed',
    });

    const result = await todoListTool({ runId: run.id, operation: 'start', seq: 1 });

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: 'TODO_NOT_STARTABLE' });
    const persisted = await repo.listTaskRunTodosForRun(run.id);
    expect(persisted[0]).toMatchObject({ seq: 1, status: 'failed' });
  });

  it('treats done for an already passed Todo as idempotent success', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: todo idempotent done ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: idempotent done',
      description: 'Repeated done should not fail',
      status: 'running',
    });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: createdRepo.id,
      status: 'running',
    });

    await todoListTool({ runId: run.id, operation: 'replace', todos: [{ title: 'Implement' }] });
    const firstDone = await todoListTool({ runId: run.id, operation: 'done', seq: 1 });
    const secondDone = await todoListTool({ runId: run.id, operation: 'done', seq: 1 });

    expect(firstDone.ok).toBe(true);
    expect(secondDone.ok).toBe(true);
    expect(secondDone.payload.transition).toMatchObject({
      completedSeq: 1,
      nextCurrentSeq: 2,
    });
    const persisted = await repo.listTaskRunTodosForRun(run.id);
    expect(persisted[0]).toMatchObject({ seq: 1, status: 'passed' });
    expect(persisted[1]).toMatchObject({ seq: 2, status: 'running' });
  });

  it('does not let stale auto-advance reopen a passed Todo', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: stale auto advance ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: stale auto advance',
      description: 'Completed todos stay terminal',
      status: 'running',
    });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: createdRepo.id,
      status: 'running',
    });
    const todo7 = await repo.createTaskRunTodo({
      runId: run.id,
      seq: 7,
      title: 'LLM コードレビューを実施する',
      taskType: 'review',
      procedureId: 'llm_code_review',
      status: 'passed',
      startedAt: new Date('2026-06-13T11:37:14.000Z'),
      completedAt: new Date('2026-06-13T11:37:53.000Z'),
    });
    await repo.createTaskRunTodo({
      runId: run.id,
      seq: 8,
      title: '品質ゲート verify コマンドを通す',
      taskType: 'verification',
      procedureId: 'quality_gate_verify',
      status: 'running',
      startedAt: new Date('2026-06-13T11:37:53.000Z'),
    });

    const staleStart = await repo.startTaskRunTodoIfStillPendingAndNoEarlierOpen({
      id: todo7.id,
      runId: run.id,
      afterSeq: 6,
      startedAt: new Date('2026-06-13T11:40:29.000Z'),
    });

    expect(staleStart).toBeNull();
    const persisted = await repo.listTaskRunTodosForRun(run.id);
    expect(persisted.map((todo) => ({ seq: todo.seq, status: todo.status }))).toEqual([
      { seq: 7, status: 'passed' },
      { seq: 8, status: 'running' },
    ]);
    expect(persisted[0].completedAt).toBeTruthy();
  });

  it('does not auto-start a later pending Todo when an earlier Todo is still open', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: guarded auto advance ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: guarded auto advance',
      description: 'Earlier open todos block later auto-start',
      status: 'running',
    });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: createdRepo.id,
      status: 'running',
    });
    await repo.createTaskRunTodo({
      runId: run.id,
      seq: 7,
      title: 'Earlier pending',
      taskType: 'review',
      status: 'pending',
    });
    await repo.createTaskRunTodo({
      runId: run.id,
      seq: 8,
      title: 'Current verification',
      taskType: 'verification',
      status: 'running',
    });
    await repo.createTaskRunTodo({
      runId: run.id,
      seq: 9,
      title: 'Later implementation',
      taskType: 'implementation',
      status: 'pending',
    });

    const result = await todoListTool({ runId: run.id, operation: 'done', seq: 8 });

    expect(result.ok).toBe(true);
    const persisted = await repo.listTaskRunTodosForRun(run.id);
    expect(persisted.map((todo) => ({ seq: todo.seq, status: todo.status }))).toEqual([
      { seq: 7, status: 'pending' },
      { seq: 8, status: 'passed' },
      { seq: 9, status: 'pending' },
    ]);
  });
});

describe('task_events sequencing', () => {
  it('allocates unique run-local seq values for concurrent event creation', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: event seq ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: event seq',
      status: 'running',
    });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: createdRepo.id,
      status: 'running',
    });

    const events = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        repo.createTaskEvent({
          taskRunId: run.id,
          type: 'info',
          eventType: 'test_event',
          actor: 'system',
          message: `event ${index}`,
          timestamp: new Date(),
        })
      )
    );

    const seqs = events.map((event) => event.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    expect(new Set(seqs).size).toBe(12);
  });
});
