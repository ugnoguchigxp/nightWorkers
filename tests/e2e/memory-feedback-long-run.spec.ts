import { expect, test } from '@playwright/test';
import * as repo from '../../api/modules/nightworkers/nightworkers.repository';
import { evaluateMemoryFeedback } from '../../api/services/memory-feedback/effectiveness';
import { parseRunJsonl } from '../../api/services/run-events/jsonl-parse';
import { replayRunJsonl } from '../../api/services/run-events/replay';
import { cleanupScenarioRecords } from './agent-outcome/api-fixtures';
import { readTestFixture } from './helpers';

const sameOriginHeaders = { Origin: 'http://localhost:39174' };

async function expectOkResponse(
  response: { ok: () => boolean; status: () => number; text: () => Promise<string> },
  label: string
) {
  if (response.ok()) return;
  throw new Error(`${label} failed: ${response.status()} ${await response.text()}`);
}

test.describe('Memory Feedback Long-Run Harness @memory-feedback', () => {
  test.describe.configure({ mode: 'serial' });

  test('provider-free deterministic lane generates, registers, injects, and evaluates', async ({
    request,
  }) => {
    const previousContextStill = process.env.CONTEXT_STILL_ENABLED;
    process.env.CONTEXT_STILL_ENABLED = 'false';
    const handles: { repositoryId?: string; taskId?: string } = {};

    try {
      const repository = await repo.createRepository({
        name: `Memory feedback long-run ${Date.now()}`,
        localPath: process.cwd(),
        branch: 'main',
        allowed: true,
      });
      handles.repositoryId = repository.id;
      const task = await repo.createTask({
        repositoryId: repository.id,
        title: 'Memory feedback long-run deterministic task',
        description: 'Exercise memory feedback learning and follow-up evaluation',
        status: 'failed',
        timeoutSeconds: 60,
      });
      handles.taskId = task.id;
      const baselineRun = await repo.createTaskRun({
        taskId: task.id,
        repositoryId: repository.id,
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

      const generateRes = await request.post(`/api/runs/${baselineRun.id}/memory-candidates`, {
        headers: sameOriginHeaders,
        data: {},
      });
      await expectOkResponse(generateRes, 'generate memory candidates');
      const candidates = (await generateRes.json()) as Array<{ id: string; title: string }>;
      expect(candidates).toHaveLength(1);
      const candidateId = candidates[0]?.id;
      expect(candidateId).toBeTruthy();

      const approveRes = await request.post(
        `/api/runs/${baselineRun.id}/memory-candidates/${candidateId}/approve`,
        { headers: sameOriginHeaders, data: { note: 'approved for deterministic lane' } }
      );
      await expectOkResponse(approveRes, 'approve memory candidate');
      expect((await approveRes.json()).status).toBe('approved');

      const registerRes = await request.post(
        `/api/runs/${baselineRun.id}/memory-candidates/${candidateId}/register`,
        { headers: sameOriginHeaders, data: {} }
      );
      await expectOkResponse(registerRes, 'register memory candidate');
      expect((await registerRes.json()).registration.status).toBe('degraded');

      const followupRun = await repo.createTaskRun({
        taskId: task.id,
        repositoryId: repository.id,
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
        message: 'Context compile included memory source refs.',
        data: {
          runId: followupRun.id,
          source: 'context-still',
          degraded: false,
          compiledContextDigest: 'deterministic-lane-digest',
          includedSourceRefs: [{ kind: 'candidate', candidateId, sourceRunId: baselineRun.id }],
          charCount: 128,
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
        data: { passed: true, command: 'pnpm test' },
      });

      const evaluateRes = await request.post(
        `/api/runs/${followupRun.id}/memory-feedback/evaluate`,
        {
          headers: sameOriginHeaders,
          data: { baselineRunId: baselineRun.id, candidateIds: [candidateId] },
        }
      );
      await expectOkResponse(evaluateRes, 'evaluate memory feedback');
      const evaluation = await evaluateRes.json();
      expect(evaluation.verdict).toBe('effective');
      expect(evaluation.reasons).not.toHaveLength(0);
      expect(evaluation.evidenceEventIds).not.toHaveLength(0);

      const exportRes = await request.get(`/api/runs/${followupRun.id}/export.jsonl`);
      await expectOkResponse(exportRes, 'export follow-up JSONL');
      expect(await exportRes.text()).toContain('memory.feedback_evaluated');
    } finally {
      await cleanupScenarioRecords(request, handles);
      if (previousContextStill === undefined) delete process.env.CONTEXT_STILL_ENABLED;
      else process.env.CONTEXT_STILL_ENABLED = previousContextStill;
    }
  });

  test('JSONL replay lane restores memory events and stable effectiveness', async () => {
    const baseline = replayRunJsonl(
      parseRunJsonl(await readTestFixture('memory-feedback', 'baseline-verification-failed.jsonl'))
    );
    const followup = replayRunJsonl(
      parseRunJsonl(await readTestFixture('memory-feedback', 'followup-effective.jsonl'))
    );
    const evaluation = evaluateMemoryFeedback({
      baselineRun: baseline,
      followupRun: followup,
      candidateIds: ['44444444-4444-4444-8444-444444444444'],
    });

    expect(baseline.memoryEvents.map((event) => event.type)).toContain(
      'memory.candidate_generated'
    );
    expect(followup.memoryEvents.map((event) => event.type)).toContain('memory.context_injected');
    expect(followup.memoryEvents.map((event) => event.type)).toContain('memory.feedback_evaluated');
    expect(evaluation.verdict).toBe('effective');
    expect(evaluation.reasons).not.toHaveLength(0);
    expect(evaluation.evidenceEventIds).not.toHaveLength(0);
  });
});
