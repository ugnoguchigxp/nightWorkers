import { describe, expect, it } from 'vitest';
import { buildReviewEvidencePackFromRun } from '../api/services/review-rubrics/evidence-pack';
import { listRubrics, loadRubric } from '../api/services/review-rubrics/loader';
import {
  reviewEvidencePackSchema,
  reviewerDraftSchema,
  rubricDefinitionSchema,
} from '../shared/schemas/nightworkers.schema';

describe('review rubric schemas and loader', () => {
  it('rejects invalid severity, executable fields, and unknown evidence selectors', () => {
    const base = loadRubric('basic-coding-run').rubric;

    expect(
      rubricDefinitionSchema.safeParse({
        ...base,
        criteria: [{ ...base.criteria[0], severity: 'critical' }],
      }).success
    ).toBe(false);

    expect(
      rubricDefinitionSchema.safeParse({
        ...base,
        executable: 'node plugin.js',
      }).success
    ).toBe(false);

    expect(
      rubricDefinitionSchema.safeParse({
        ...base,
        criteria: [
          {
            ...base.criteria[0],
            evidenceSelectors: [{ kind: 'shell', command: 'pnpm test' }],
          },
        ],
      }).success
    ).toBe(false);
  });

  it('loads built-in rubrics with deterministic digest metadata', () => {
    const first = loadRubric('basic-coding-run');
    const second = loadRubric('basic-coding-run');

    expect(listRubrics().map((item) => item.rubric.id)).toContain('basic-coding-run');
    expect(first.digest).toBe(second.digest);
    expect(first.criteriaCount).toBe(first.rubric.criteria.length);
    expect(() => loadRubric('missing')).toThrow(/Unknown review rubric/);
  });

  it('validates evidence packs and reviewer drafts', () => {
    expect(
      reviewEvidencePackSchema.safeParse({
        version: 1,
        runId: 'run-1',
        taskId: 'task-1',
        status: 'needs_review',
        diff: { hasChanges: false, bytes: 0, changedFiles: [] },
        verification: [],
        policy: [],
        reviewResults: [],
        selectedEvents: [],
        eventTypes: [],
        diagnostics: [],
      }).success
    ).toBe(true);

    expect(
      reviewerDraftSchema.safeParse({
        version: 1,
        verdict: 'approved',
        summary: 'ok',
        findings: [],
        humanCallouts: [],
        agentFollowUps: [],
        suggestedNextTasks: [],
      }).success
    ).toBe(true);
  });
});

describe('review evidence pack builder', () => {
  it('extracts diff, verification, policy, review, and redacted evidence', () => {
    const run = {
      id: '11111111-1111-4111-8111-111111111111',
      taskId: '22222222-2222-4222-8222-222222222222',
      status: 'needs_review',
      diffPatch: 'diff --git a/src/a.ts b/src/a.ts\n+new',
      finalReport: 'Done with api_key=secret-value',
      summary: 'ready',
    } as any;
    const events = [
      {
        id: '33333333-3333-4333-8333-333333333333',
        taskRunId: run.id,
        seq: 1,
        actor: 'verifier',
        eventType: 'checkpoint',
        type: 'checkpoint',
        message: 'pnpm test passed',
        payloadJson: {
          runEvent: {
            version: 1,
            runId: run.id,
            taskId: run.taskId,
            seq: 1,
            timestamp: '2026-06-02T00:00:01.000Z',
            type: 'verification.finished',
            severity: 'checkpoint',
            actor: 'verifier',
            message: 'pnpm test passed',
            data: { passed: true, command: 'pnpm test' },
          },
        },
        timestamp: new Date('2026-06-02T00:00:01.000Z'),
      },
      {
        id: '33333333-3333-4333-8333-333333333334',
        taskRunId: run.id,
        seq: 2,
        actor: 'tool',
        eventType: 'error',
        type: 'error',
        message: 'Blocked token=raw-secret',
        payloadJson: {
          runEvent: {
            version: 1,
            runId: run.id,
            taskId: run.taskId,
            seq: 2,
            timestamp: '2026-06-02T00:00:02.000Z',
            type: 'tool.policy_blocked',
            severity: 'error',
            actor: 'tool',
            message: 'Blocked token=raw-secret',
            data: { code: 'DENY', message: 'Blocked token=raw-secret' },
          },
        },
        timestamp: new Date('2026-06-02T00:00:02.000Z'),
      },
      {
        id: '33333333-3333-4333-8333-333333333335',
        taskRunId: run.id,
        seq: 3,
        actor: 'human',
        eventType: 'state_change',
        type: 'info',
        message: 'reviewed',
        payloadJson: {
          reviewResult: {
            note: 'contains api_key=review-secret',
            findings: [{ body: 'token=review-token' }],
          },
        },
        timestamp: new Date('2026-06-02T00:00:03.000Z'),
      },
    ] as any[];

    const pack = buildReviewEvidencePackFromRun(run, events);

    expect(pack.diff).toEqual(
      expect.objectContaining({ hasChanges: true, changedFiles: ['src/a.ts'] })
    );
    expect(pack.finalReport).toContain('[REDACTED]');
    expect(pack.verification).toHaveLength(1);
    expect(pack.policy[0].message).toContain('[REDACTED]');
    expect(JSON.stringify(pack.reviewResults)).toContain('[REDACTED]');
    expect(JSON.stringify(pack.reviewResults)).not.toContain('review-secret');
  });
});
