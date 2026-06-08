import { describe, expect, it } from 'vitest';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import { getAllowedToolsForJobType } from '../api/services/supervisor/prompt';
import { executeWorkerTool } from '../api/services/worker-tools/dispatcher';

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

  it('is available to implementation-oriented supervisor jobs', () => {
    expect(getAllowedToolsForJobType('minor_code_edit').map((tool) => tool.name)).toContain(
      'read_current_specification'
    );
    expect(getAllowedToolsForJobType('major_code_edit').map((tool) => tool.name)).toContain(
      'read_current_specification'
    );
  });
});
