import { describe, expect, it } from 'vitest';
import app from '../api/app';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';

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

describe('NightWorkers review routes', () => {
  it('persists structured review results and returns run reviews', async () => {
    const createdRepo = await repo.createRepository({
      name: 'TEST: Review Route Workspace',
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: Review task',
      description: 'Review task description',
      status: 'needs_review',
    });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: createdRepo.id,
      status: 'needs_review',
      workerKind: 'native-local',
      timeoutSeconds: 60,
      summary: 'ready for review',
      finalReport: 'Task finished',
      startedAt: new Date('2026-06-02T00:00:00.000Z'),
    });
    await repo.updateTaskRun(run.id, {
      diffPatch: 'diff --git a/file.txt b/file.txt',
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
    await repo.createRunEvent({
      version: 1,
      runId: run.id,
      taskId: task.id,
      timestamp: '2026-06-02T00:00:02.000Z',
      type: 'tool.policy_blocked',
      severity: 'error',
      actor: 'tool',
      message: 'Policy block detected',
      data: { code: 'DENY', message: 'blocked' },
    });

    const reviewRes = await app.request(`http://localhost/api/runs/${run.id}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'complete',
        note: 'Looks good',
      }),
    });

    expect(reviewRes.status).toBe(200);
    const reviewBody = await reviewRes.json();
    expect(reviewBody.ok).toBe(true);
    expect(reviewBody.status).toBe('completed');
    expect(reviewBody.outcome.status).toBe('completed');
    expect(reviewBody.reviewResult.verdict).toBe('approved');
    expect(reviewBody.reviewResult.evidenceRefs.some((ref: any) => ref.kind === 'diff')).toBe(true);
    expect(
      reviewBody.reviewResult.evidenceRefs.some((ref: any) => ref.kind === 'verification')
    ).toBe(true);
    expect(reviewBody.reviewResult.evidenceRefs.some((ref: any) => ref.kind === 'policy')).toBe(
      true
    );

    const runDetailRes = await app.request(`http://localhost/api/runs/${run.id}`, {
      method: 'GET',
    });
    expect(runDetailRes.status).toBe(200);
    const runDetail = await runDetailRes.json();
    expect(runDetail.reviews).toHaveLength(1);
    expect(runDetail.reviews[0].id).toBe(reviewBody.reviewResult.id);

    const events = await repo.listTaskEventsForRun(run.id);
    const reviewEvent = events.find(
      (event) => event.payloadJson && (event.payloadJson as any).reviewResult
    );
    expect(reviewEvent).toBeDefined();
  });
});
