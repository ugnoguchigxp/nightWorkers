import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateMemoryFeedback } from '../api/services/memory-feedback/effectiveness';
import { parseRunJsonl } from '../api/services/run-events/jsonl-parse';
import { replayRunJsonl } from '../api/services/run-events/replay';

const fixtureDir = path.join(process.cwd(), 'tests', 'fixtures', 'memory-feedback');
const candidateId = '44444444-4444-4444-8444-444444444444';

function replayFixture(name: string) {
  const parsed = parseRunJsonl(readFileSync(path.join(fixtureDir, name), 'utf8'));
  return replayRunJsonl(parsed);
}

describe('memory feedback JSONL replay', () => {
  it('reconstructs candidate, injection, and evaluation events from fixtures', () => {
    const baseline = replayFixture('baseline-verification-failed.jsonl');
    const followup = replayFixture('followup-effective.jsonl');

    expect(baseline.diagnostics).toHaveLength(0);
    expect(followup.diagnostics).toHaveLength(0);
    expect(baseline.memoryEvents.map((event) => event.type)).toEqual([
      'memory.candidate_generated',
      'memory.candidate_approved',
      'memory.register_finished',
    ]);
    expect(followup.memoryEvents.map((event) => event.type)).toEqual([
      'memory.context_injected',
      'memory.feedback_evaluated',
    ]);
    expect(baseline.memoryEvents[0]?.data?.candidateId).toBe(candidateId);
    expect(followup.memoryEvents[0]?.data?.includedSourceRefs).toEqual([
      expect.objectContaining({ candidateId, confidence: 'high' }),
    ]);
    expect(followup.memoryEvents[1]?.data?.verdict).toBe('effective');
  });

  it('keeps the effectiveness report stable after JSONL replay', () => {
    const baseline = replayFixture('baseline-verification-failed.jsonl');
    const followup = replayFixture('followup-effective.jsonl');
    const evaluation = evaluateMemoryFeedback({
      baselineRun: baseline,
      followupRun: followup,
      candidateIds: [candidateId],
    });

    expect(evaluation).toEqual({
      baselineRunId: baseline.sourceRunId,
      followupRunId: followup.sourceRunId,
      candidateIds: [candidateId],
      verdict: 'effective',
      reasons: [
        'Candidate was injected and follow-up evidence no longer repeats the baseline failure.',
      ],
      evidenceEventIds: [
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
      ],
    });
  });
});
