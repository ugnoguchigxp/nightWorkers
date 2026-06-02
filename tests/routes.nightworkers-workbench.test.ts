import crypto from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import app from '../api/app';
import { ensureNightWorkersSchema } from '../api/db/bootstrap';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import * as service from '../api/modules/nightworkers/nightworkers.service';

const sameOriginHeaders = { Origin: 'http://localhost:39174' };

beforeAll(async () => {
  await ensureNightWorkersSchema();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NightWorkers workbench routes', () => {
  it('creates a draft workbench session without starting a run', async () => {
    const project = await repo.createRepository({
      name: 'TEST: Workbench Project',
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });

    const res = await app.request('http://localhost/api/workbench/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({
        repositoryId: project.id,
        title: 'Workbench draft',
      }),
    });

    expect(res.status).toBe(201);
    const task = await res.json();
    expect(task.status).toBe('draft');
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
  });

  it('stores discuss messages without creating a run', async () => {
    const { task } = await createWorkbenchTask();

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'まず方針を相談したい', intent: 'discuss' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run).toBeNull();
    expect(body.messages.some((message: any) => message.role === 'user')).toBe(true);
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
  });

  it('drafts a markdown spec message and queues only after validation passes', async () => {
    const { task } = await createWorkbenchTask();

    const draftRes = await app.request(
      `http://localhost/api/workbench/sessions/${task.id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
        body: JSON.stringify({ prompt: 'チャット中心の作業台を仕様にして', intent: 'draft_spec' }),
      }
    );

    expect(draftRes.status).toBe(200);
    const draftBody = await draftRes.json();
    expect(draftBody.task.status).toBe('ready');
    expect(
      draftBody.messages.some((message: any) => message.messageType === 'markdown_document')
    ).toBe(true);

    const queueRes = await app.request(`http://localhost/api/workbench/sessions/${task.id}/queue`, {
      method: 'POST',
      headers: sameOriginHeaders,
    });
    expect(queueRes.status).toBe(200);
    const queued = await queueRes.json();
    expect(queued.status).toBe('queued');
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
  });

  it('returns a validation error instead of changing task status for incomplete drafts', async () => {
    const { task } = await createWorkbenchTask({ title: 'New Session' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/queue`, {
      method: 'POST',
      headers: sameOriginHeaders,
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('TASK_DRAFT_INCOMPLETE');
    expect((await repo.getTask(task.id))?.status).toBe('draft');
  });

  it('rejects workbench run requests until the task is ready or queued', async () => {
    const { task } = await createWorkbenchTask({ title: 'New Session' });

    const directRunRes = await app.request(
      `http://localhost/api/workbench/sessions/${task.id}/run`,
      {
        method: 'POST',
        headers: sameOriginHeaders,
      }
    );
    expect(directRunRes.status).toBe(409);
    expect((await directRunRes.json()).code).toBe('TASK_NOT_READY_TO_RUN');

    const intentRunRes = await app.request(
      `http://localhost/api/workbench/sessions/${task.id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
        body: JSON.stringify({ prompt: '実行して', intent: 'run_task' }),
      }
    );
    expect(intentRunRes.status).toBe(409);
    expect((await intentRunRes.json()).code).toBe('TASK_NOT_READY_TO_RUN');
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
  });

  it('allows workbench run requests for queued tasks through the runtime path', async () => {
    const { task } = await createWorkbenchTask({ status: 'queued' });
    const startSpy = vi.spyOn(service, 'startWorkbenchTaskRun').mockResolvedValue({
      id: crypto.randomUUID(),
      taskId: task.id,
      repositoryId: task.repositoryId,
      status: 'context_compiling',
      workerKind: 'native-local',
      timeoutSeconds: 3600,
      startedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/run`, {
      method: 'POST',
      headers: sameOriginHeaders,
    });

    expect(res.status).toBe(201);
    expect(startSpy).toHaveBeenCalledWith(task.id);
  });
});

async function createWorkbenchTask(input: { title?: string; status?: string } = {}) {
  const project = await repo.createRepository({
    name: `TEST: Workbench Project ${crypto.randomUUID()}`,
    localPath: '/Users/y.noguchi/Code/nightWorkers',
    branch: 'main',
  });
  const task = await repo.createTask({
    repositoryId: project.id,
    title: input.title || 'Workbench task',
    objective: 'Implement chat-first workbench',
    acceptanceCriteria: 'Discuss, draft, queue, and run are separate actions',
    status: input.status || 'draft',
  });
  return { project, task };
}
