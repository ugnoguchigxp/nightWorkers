import { beforeAll, describe, expect, it } from 'vitest';
import app from '../api/app';
import { ensureNightWorkersSchema } from '../api/db/bootstrap';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';

beforeAll(async () => {
  await ensureNightWorkersSchema();
});

describe('NightWorkers repositories routes', () => {
  it('registers a workspace repository successfully with valid data', async () => {
    const res = await app.request('http://localhost/api/repositories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'TEST: Valid Workspace',
        localPath: '/Users/y.noguchi/Code/nightWorkers',
        branch: 'main',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.name).toBe('TEST: Valid Workspace');
    expect(body.localPath).toBe('/Users/y.noguchi/Code/nightWorkers');
  });

  it('returns 400 Bad Request if name is missing', async () => {
    const res = await app.request('http://localhost/api/repositories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        localPath: '/Users/y.noguchi/Code/nightWorkers',
        branch: 'main',
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 Bad Request if localPath is missing', async () => {
    const res = await app.request('http://localhost/api/repositories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'TEST: Missing Path Workspace',
        branch: 'main',
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('deletes a workspace repository successfully', async () => {
    const createRes = await app.request('http://localhost/api/repositories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'TEST: To Be Deleted',
        localPath: '/Users/y.noguchi/Code/nightWorkers',
        branch: 'main',
      }),
    });
    expect(createRes.status).toBe(201);
    const repo = await createRes.json();

    const deleteRes = await app.request(`http://localhost/api/repositories/${repo.id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    expect(deleteRes.status).toBe(200);
    const deleteBody = await deleteRes.json();
    expect(deleteBody.id).toBe(repo.id);

    const getRes = await app.request(`http://localhost/api/repositories/${repo.id}`, {
      method: 'GET',
    });
    expect(getRes.status).toBe(404);
  });
});

describe('NightWorkers reviewer evaluation routes', () => {
  it('persists agent reviewer evaluations without changing run status', async () => {
    const createdRepo = await repo.createRepository({
      name: 'TEST: Reviewer Route Workspace',
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: Reviewer task',
      description: 'Reviewer task description',
      status: 'needs_review',
    });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: createdRepo.id,
      status: 'needs_review',
      workerKind: 'native-local',
      timeoutSeconds: 60,
      summary: 'ready for reviewer',
      finalReport: 'Task finished',
      startedAt: new Date('2026-06-02T00:00:00.000Z'),
    });
    await repo.updateTaskRun(run.id, {
      diffPatch: 'diff --git a/file.txt b/file.txt\n+done',
    });
    await repo.createRunEvent({
      version: 1,
      runId: run.id,
      taskId: task.id,
      timestamp: '2026-06-02T00:00:01.000Z',
      type: 'verification.finished',
      severity: 'checkpoint',
      actor: 'verifier',
      message: 'Verification passed',
      data: { passed: true, command: 'pnpm test' },
    });

    const listRes = await app.request('http://localhost/api/review-rubrics');
    expect(listRes.status).toBe(200);
    expect((await listRes.json()).map((rubric: any) => rubric.id)).toContain('basic-coding-run');

    const reviewRes = await app.request(
      `http://localhost/api/runs/${run.id}/reviewer-evaluations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rubricId: 'basic-coding-run',
          mode: 'deterministic_only',
          persist: true,
        }),
      }
    );

    expect(reviewRes.status).toBe(200);
    const body = await reviewRes.json();
    expect(body.reviewResult.reviewer.type).toBe('agent');
    expect(body.finalReviewerVerdict).toBe('approved');
    expect(body.reviewResult.statusBefore).toBe('needs_review');
    expect(body.reviewResult.statusAfter).toBe('needs_review');

    const latestRun = await repo.getTaskRun(run.id);
    expect(latestRun?.status).toBe('needs_review');
    const events = await repo.listTaskEventsForRun(run.id);
    expect(
      events.some(
        (event) => (event.payloadJson as any)?.runEvent?.type === 'review.evaluation_finished'
      )
    ).toBe(true);

    const replayRes = await app.request(
      `http://localhost/api/runs/${run.id}/reviewer-evaluations/replay`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rubricId: 'basic-coding-run', mode: 'deterministic_only' }),
      }
    );
    expect(replayRes.status).toBe(200);
    const replayBody = await replayRes.json();
    expect(replayBody.reviewResult.reviewer.type).toBe('agent');
    expect(replayBody.reviewResult.statusAfter).toBe('needs_review');

    const invalidReplayRes = await app.request(
      `http://localhost/api/runs/${run.id}/reviewer-evaluations/replay`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonl: '{not-json' }),
      }
    );
    expect(invalidReplayRes.status).toBe(400);
    expect((await invalidReplayRes.json()).code).toBe('INVALID_REPLAY_JSONL');
  });
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
});
