import { describe, expect, it } from 'vitest';
import { buildReviewResult } from '../api/services/review-results/build-review-result';
import { collectDefaultReviewEvidence } from '../api/services/review-results/evidence-collector';

describe('review-results builder', () => {
  it('maps actions to review verdicts and preserves risk acceptance fallback', () => {
    const result = buildReviewResult({
      run: {
        id: 'run-1',
        taskId: 'task-1',
        status: 'needs_review',
        summary: 'ready for review',
      },
      request: {
        action: 'accept_risk',
        note: 'Ship with known lint warnings',
      },
      outcome: {
        status: 'needs_review',
        reason: 'human_review',
        summary: 'Human accepted current risk and kept run in review state.',
      },
      evidenceRefs: [],
      createdAt: '2026-06-02T00:00:00.000Z',
    });

    expect(result.verdict).toBe('risk_accepted');
    expect(result.riskAcceptance?.acceptedRisk).toBe('Ship with known lint warnings');
    expect(result.statusBefore).toBe('needs_review');
    expect(result.statusAfter).toBe('needs_review');
  });
});

describe('review-results evidence collector', () => {
  it('collects diff, final report, verification, and policy evidence', () => {
    const refs = collectDefaultReviewEvidence(
      {
        id: 'run-1',
        diffPatch: 'diff --git a/a b/a',
        finalReport: 'finished',
      },
      [
        {
          id: 'evt-1',
          seq: 1,
          type: 'verification.finished',
          eventType: 'checkpoint',
          payloadJson: {
            runEvent: {
              type: 'verification.finished',
              data: { passed: true, command: 'pnpm test' },
            },
          },
        } as any,
        {
          id: 'evt-2',
          seq: 2,
          type: 'tool.policy_blocked',
          eventType: 'error',
          message: 'blocked',
          payloadJson: {
            runEvent: {
              type: 'tool.policy_blocked',
              data: { code: 'DENY', message: 'blocked' },
            },
          },
        } as any,
      ]
    );

    expect(refs.some((ref) => ref.kind === 'diff')).toBe(true);
    expect(refs.some((ref) => ref.kind === 'final_report')).toBe(true);
    expect(refs.some((ref) => ref.kind === 'verification')).toBe(true);
    expect(refs.some((ref) => ref.kind === 'policy')).toBe(true);
  });
});
