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
    expect(String((dispatch.result.payload as any).digest)).toMatch(/^sha256:/);
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
          title: 'Implement MCP TodoList tool',
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
      'implementation',
      'review',
      'verification',
      'knowledge_capture',
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
});
