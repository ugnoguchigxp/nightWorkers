import { describe, expect, it } from 'vitest';
import app from '../api/app';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';

describe('NightWorkers memory feedback routes', () => {
  it('generates, approves, registers, exports, and evaluates memory feedback events', async () => {
    const previous = process.env.CONTEXT_STILL_ENABLED;
    process.env.CONTEXT_STILL_ENABLED = 'false';

    const createdRepo = await repo.createRepository({
      name: 'TEST: Memory Feedback Workspace',
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: Memory feedback task',
      description: 'Exercise memory feedback control plane',
      status: 'failed',
    });
    const baselineRun = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: createdRepo.id,
      status: 'failed',
      workerKind: 'native-local',
      timeoutSeconds: 60,
      summary: 'verification failed',
      startedAt: new Date('2026-06-02T00:00:00.000Z'),
    });
    await repo.createRunEvent({
      version: 1,
      runId: baselineRun.id,
      taskId: task.id,
      timestamp: '2026-06-02T00:00:01.000Z',
      type: 'verification.finished',
      severity: 'checkpoint',
      actor: 'verifier',
      message: 'Verification failed',
      data: { passed: false, command: 'pnpm test' },
    });

    const generateRes = await app.request(
      `http://localhost/api/runs/${baselineRun.id}/memory-candidates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }
    );
    expect(generateRes.status).toBe(201);
    const candidates = await generateRes.json();
    expect(candidates).toHaveLength(1);
    const candidateId = candidates[0].id;

    const unapprovedRegisterRes = await app.request(
      `http://localhost/api/runs/${baselineRun.id}/memory-candidates/${candidateId}/register`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }
    );
    expect(unapprovedRegisterRes.status).toBe(409);

    const approveRes = await app.request(
      `http://localhost/api/runs/${baselineRun.id}/memory-candidates/${candidateId}/approve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: 'approved for deterministic test' }),
      }
    );
    expect(approveRes.status).toBe(200);
    expect((await approveRes.json()).status).toBe('approved');

    const registerRes = await app.request(
      `http://localhost/api/runs/${baselineRun.id}/memory-candidates/${candidateId}/register`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }
    );
    expect(registerRes.status).toBe(200);
    const registerBody = await registerRes.json();
    expect(registerBody.registration.status).toBe('degraded');
    expect(registerBody.candidate.status).toBe('failed');

    const exportRes = await app.request(
      `http://localhost/api/runs/${baselineRun.id}/export.jsonl`,
      { method: 'GET' }
    );
    expect(exportRes.status).toBe(200);
    expect(await exportRes.text()).toContain('memory.register_finished');

    const followupRun = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: createdRepo.id,
      status: 'completed',
      workerKind: 'native-local',
      timeoutSeconds: 60,
      summary: 'verification passed',
      startedAt: new Date('2026-06-02T00:01:00.000Z'),
    });
    await repo.createRunEvent({
      version: 1,
      runId: followupRun.id,
      taskId: task.id,
      timestamp: '2026-06-02T00:01:01.000Z',
      type: 'memory.context_injected',
      severity: 'info',
      actor: 'system',
      message: 'candidate injected',
      data: {
        runId: followupRun.id,
        source: 'context-still',
        degraded: false,
        compiledContextDigest: 'digest',
        includedSourceRefs: [{ kind: 'candidate', candidateId, sourceRunId: baselineRun.id }],
        charCount: 100,
      },
    });
    await repo.createRunEvent({
      version: 1,
      runId: followupRun.id,
      taskId: task.id,
      timestamp: '2026-06-02T00:01:02.000Z',
      type: 'verification.finished',
      severity: 'checkpoint',
      actor: 'verifier',
      message: 'Verification passed',
      data: { passed: true },
    });

    const evaluateRes = await app.request(
      `http://localhost/api/runs/${followupRun.id}/memory-feedback/evaluate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baselineRunId: baselineRun.id, candidateIds: [candidateId] }),
      }
    );
    expect(evaluateRes.status).toBe(200);
    expect((await evaluateRes.json()).verdict).toBe('effective');

    if (previous === undefined) delete process.env.CONTEXT_STILL_ENABLED;
    else process.env.CONTEXT_STILL_ENABLED = previous;
  });
});
