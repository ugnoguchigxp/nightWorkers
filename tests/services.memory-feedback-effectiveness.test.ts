import { describe, expect, it } from 'vitest';
import { evaluateMemoryFeedback } from '../api/services/memory-feedback/effectiveness';

const baselineRunId = '11111111-1111-4111-8111-111111111111';
const followupRunId = '22222222-2222-4222-8222-222222222222';
const taskId = '33333333-3333-4333-8333-333333333333';
const candidateId = '44444444-4444-4444-8444-444444444444';

function event(type: any, data: Record<string, unknown> = {}) {
  return {
    version: 1 as const,
    runId: type === 'memory.context_injected' ? followupRunId : baselineRunId,
    taskId,
    timestamp: '2026-06-02T00:00:00.000Z',
    type,
    severity: 'info' as const,
    actor: 'system' as const,
    message: type,
    data,
  };
}

describe('memory feedback effectiveness evaluator', () => {
  it('returns not_injected when follow-up has no exact candidate ref', () => {
    expect(
      evaluateMemoryFeedback({
        baselineRun: { runId: baselineRunId, events: [event('tool.policy_blocked')] },
        followupRun: { runId: followupRunId, events: [] },
        candidateIds: [candidateId],
      }).verdict
    ).toBe('not_injected');
  });

  it('returns effective when the injected follow-up avoids baseline failure', () => {
    const result = evaluateMemoryFeedback({
      baselineRun: { runId: baselineRunId, events: [event('tool.policy_blocked')] },
      followupRun: {
        runId: followupRunId,
        terminal: { status: 'completed' },
        events: [
          event('memory.context_injected', {
            includedSourceRefs: [{ kind: 'candidate', candidateId, confidence: 'high' }],
          }),
          event('verification.finished', { passed: true }),
        ],
      },
      candidateIds: [candidateId],
    });

    expect(result.verdict).toBe('effective');
    expect(result.reasons[0]).toContain('Candidate was injected');
  });

  it('returns ineffective when failure repeats after injection', () => {
    expect(
      evaluateMemoryFeedback({
        baselineRun: { runId: baselineRunId, events: [event('tool.policy_blocked')] },
        followupRun: {
          runId: followupRunId,
          events: [
            event('memory.context_injected', {
              includedSourceRefs: [{ kind: 'candidate', candidateId, confidence: 'high' }],
            }),
            event('tool.policy_blocked'),
          ],
        },
        candidateIds: [candidateId],
      }).verdict
    ).toBe('ineffective');
  });

  it('returns inconclusive when injection exists but evidence cannot be compared', () => {
    expect(
      evaluateMemoryFeedback({
        baselineRun: { runId: baselineRunId, events: [] },
        followupRun: {
          runId: followupRunId,
          events: [
            event('memory.context_injected', {
              includedSourceRefs: [{ kind: 'candidate', candidateId, confidence: 'high' }],
            }),
          ],
        },
        candidateIds: [candidateId],
      }).verdict
    ).toBe('inconclusive');
  });
});
