import crypto from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import app from '../../api/app';
import { ensureNightWorkersSchema } from '../../api/db/bootstrap';
import * as repo from '../../api/modules/nightworkers/nightworkers.repository';

const sameOriginHeaders = { Origin: 'http://localhost:39174' };

beforeAll(async () => {
  await ensureNightWorkersSchema();
});

describe('NightWorkers task routes', () => {
  it('deletes a task and its dependent workbench data', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: Task Delete Workspace ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: Task delete target',
      description: 'Delete target',
      status: 'draft',
    });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: createdRepo.id,
      status: 'completed',
      workerKind: 'native-local',
      timeoutSeconds: 60,
    });
    await repo.createTaskMessage({
      taskId: task.id,
      runId: run.id,
      role: 'user',
      content: 'Delete this task',
      messageType: 'text',
    });
    await repo.createRunEvent({
      version: 1,
      runId: run.id,
      taskId: task.id,
      timestamp: '2026-06-03T00:00:00.000Z',
      type: 'verification.finished',
      severity: 'checkpoint',
      actor: 'verifier',
      message: 'Verification finished',
      payload: {},
    });

    const deleteRes = await app.request(`http://localhost/api/tasks/${task.id}`, {
      method: 'DELETE',
      headers: sameOriginHeaders,
    });

    expect(deleteRes.status).toBe(200);
    const deleteBody = await deleteRes.json();
    expect(deleteBody.id).toBe(task.id);
    expect(await repo.getTask(task.id)).toBeUndefined();
    expect(await repo.listTaskRunsForTask(task.id)).toEqual([]);
    expect(await repo.listTaskMessages(task.id)).toEqual([]);
  });
});
