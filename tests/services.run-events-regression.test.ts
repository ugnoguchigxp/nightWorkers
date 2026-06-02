import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRunJsonl } from '../api/services/run-events/jsonl-parse';
import { replayRunJsonl } from '../api/services/run-events/replay';

const fixturesDir = path.resolve(import.meta.dirname, 'fixtures/run-events');

const cases = [
  {
    file: 'basic-needs-review.jsonl',
    expected: {
      eventCount: 3,
      status: 'needs_review',
      hasDiff: true,
      hasPolicyBlock: false,
      hasReviewResult: false,
      hasVerification: false,
    },
  },
  {
    file: 'policy-blocked-needs-human.jsonl',
    expected: {
      eventCount: 3,
      status: 'needs_human',
      hasDiff: false,
      hasPolicyBlock: true,
      hasReviewResult: false,
      hasVerification: false,
    },
  },
  {
    file: 'review-completed.jsonl',
    expected: {
      eventCount: 4,
      status: 'completed',
      hasDiff: true,
      hasPolicyBlock: false,
      hasReviewResult: true,
      hasVerification: true,
    },
  },
  {
    file: 'verification-failed.jsonl',
    expected: {
      eventCount: 3,
      status: 'failed',
      hasDiff: false,
      hasPolicyBlock: false,
      hasReviewResult: false,
      hasVerification: true,
    },
  },
];

describe('run-events JSONL fixture regression', () => {
  it.each(cases)('replays $file as the expected outcome', ({ file, expected }) => {
    const text = fs.readFileSync(path.join(fixturesDir, file), 'utf8');
    const parsed = parseRunJsonl(text);
    const replay = replayRunJsonl(parsed);

    expect(parsed.diagnostics).toHaveLength(0);
    expect(parsed.summary?.eventCount).toBe(expected.eventCount);
    expect(replay.eventCount).toBe(expected.eventCount);
    expect(replay.terminal.status).toBe(expected.status);
    expect(replay.evidence).toEqual(
      expect.objectContaining({
        hasDiff: expected.hasDiff,
        hasPolicyBlock: expected.hasPolicyBlock,
        hasReviewResult: expected.hasReviewResult,
        hasVerification: expected.hasVerification,
      })
    );
  });
});
