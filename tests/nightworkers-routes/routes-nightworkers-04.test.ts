import { beforeAll, describe, expect, it } from 'vitest';
import app from '../../api/app';
import { ensureNightWorkersSchema } from '../../api/db/bootstrap';
import * as repo from '../../api/modules/nightworkers/nightworkers.repository';

const _sameOriginHeaders = { Origin: 'http://localhost:39174' };

beforeAll(async () => {
  await ensureNightWorkersSchema();
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
