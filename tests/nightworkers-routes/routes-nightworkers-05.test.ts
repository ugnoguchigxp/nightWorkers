import crypto from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import app from '../../api/app';
import { ensureNightWorkersSchema } from '../../api/db/bootstrap';
import * as repo from '../../api/modules/nightworkers/nightworkers.repository';
import { recordLlmUsage } from '../../api/services/llm-usage';

const sameOriginHeaders = { Origin: 'http://localhost:39174' };

beforeAll(async () => {
  await ensureNightWorkersSchema();
});

describe('NightWorkers task run todo routes', () => {
  it('returns persisted todos with run details in sequence order', async () => {
    const createdRepo = await repo.createRepository({
      name: 'TEST: Todo Route Workspace',
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: Todo task',
      description: 'Todo task description',
      status: 'running',
    });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: createdRepo.id,
      status: 'running',
      workerKind: 'native-local',
      timeoutSeconds: 60,
      startedAt: new Date('2026-06-02T00:00:00.000Z'),
    });

    const second = await repo.createTaskRunTodo({
      runId: run.id,
      seq: 2,
      title: 'Run verification',
      description: 'Check the implementation',
      taskType: 'verification',
      status: 'pending',
      dependsOn: [1],
    });
    const first = await repo.createTaskRunTodo({
      runId: run.id,
      seq: 1,
      title: 'Implement persistence',
      description: 'Add todo persistence',
      taskType: 'code_change',
      status: 'running',
      procedureId: 'code-change',
      procedureSnapshot: { id: 'code-change', digest: 'sha256:test' },
      contextSnapshot: { digest: 'context:test' },
    });

    await repo.updateTaskRunTodo(first.id, {
      status: 'passed',
      completionGateResult: { passed: true },
      completedAt: new Date('2026-06-02T00:01:00.000Z'),
    });

    const runDetailRes = await app.request(`http://localhost/api/runs/${run.id}`, {
      method: 'GET',
    });
    expect(runDetailRes.status).toBe(200);
    const runDetail = await runDetailRes.json();
    expect(runDetail.todos.map((todo: any) => todo.id)).toEqual([first.id, second.id]);
    expect(runDetail.todos[0]).toMatchObject({
      seq: 1,
      title: 'Implement persistence',
      taskType: 'code_change',
      status: 'passed',
      procedureId: 'code-change',
      procedureSnapshot: { id: 'code-change', digest: 'sha256:test' },
      contextSnapshot: { digest: 'context:test' },
      completionGateResult: { passed: true },
      dependsOn: [],
    });
    expect(runDetail.todos[1]).toMatchObject({
      seq: 2,
      taskType: 'verification',
      status: 'pending',
      dependsOn: [1],
    });
  });

  it('enforces one todo per run sequence and cascades todos with run deletion', async () => {
    const createdRepo = await repo.createRepository({
      name: 'TEST: Todo Constraint Workspace',
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: Todo constraint task',
      status: 'running',
    });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: createdRepo.id,
      status: 'running',
      workerKind: 'native-local',
      timeoutSeconds: 60,
    });

    await repo.createTaskRunTodo({
      runId: run.id,
      seq: 1,
      title: 'Only first seq',
      taskType: 'investigation',
    });

    await expect(
      repo.createTaskRunTodo({
        runId: run.id,
        seq: 1,
        title: 'Duplicate seq',
        taskType: 'verification',
      })
    ).rejects.toThrow();

    await repo.deleteTask(task.id);
    expect(await repo.listTaskRunTodosForRun(run.id)).toEqual([]);
  });

  it('returns task LLM token usage summary', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: LLM Usage ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: LLM usage task',
      status: 'draft',
    });

    await recordLlmUsage({
      taskId: task.id,
      runId: null,
      callId: crypto.randomUUID(),
      provider: 'openai',
      model: 'gpt-test',
      label: 'supervisor',
      round: 1,
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 10,
        reasoningOutputTokens: 4,
        totalTokens: 120,
        mode: 'measured',
        rawUsage: { prompt_tokens: 100, completion_tokens: 20 },
      },
      promptPartTokenEstimates: {
        systemPromptTokens: 30,
        userPromptTokens: 70,
        stateCardTokens: 12,
      },
      durationMs: 42,
    });

    const res = await app.request(`http://localhost/api/tasks/${task.id}/llm-usage`, {
      headers: sameOriginHeaders,
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      taskId: task.id,
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: 10,
      reasoningOutputTokens: 4,
      totalTokens: 120,
      stateCardTokens: 12,
      usageMode: 'mixed',
      callCount: 1,
      measuredCallCount: 1,
      estimatedCallCount: 0,
    });
  });
});
