import { describe, expect, it } from 'vitest';
import { runReviewReplayEvaluationFromJsonl } from '../api/services/review-rubrics/replay-evaluation';
import { parseRunJsonl } from '../api/services/run-events/jsonl-parse';
import { replayRunJsonl } from '../api/services/run-events/replay';

const runId = '11111111-1111-4111-8111-111111111111';
const taskId = '22222222-2222-4222-8222-222222222222';

function buildJsonl(options: {
  verification?: boolean;
  policy?: boolean;
  diffBytes?: number;
  finalReport?: string | null;
  finalJudgmentEvent?: boolean;
}) {
  const lines: unknown[] = [
    {
      type: 'nightworkers_run',
      version: 1,
      runId,
      taskId,
      createdAt: '2026-06-02T00:00:00.000Z',
      exportedAt: '2026-06-02T00:00:10.000Z',
    },
  ];
  if (options.finalJudgmentEvent !== false) {
    lines.push({
      type: 'run_event',
      version: 1,
      runId,
      seq: 1,
      event: {
        version: 1,
        runId,
        taskId,
        seq: 1,
        timestamp: '2026-06-02T00:00:01.000Z',
        type: 'run.final_judgment_created',
        severity: 'checkpoint',
        actor: 'system',
        message: 'Final judgment created',
      },
    });
  }
  if (options.verification) {
    lines.push({
      type: 'run_event',
      version: 1,
      runId,
      seq: 2,
      event: {
        version: 1,
        runId,
        taskId,
        seq: 2,
        timestamp: '2026-06-02T00:00:02.000Z',
        type: 'verification.finished',
        severity: 'checkpoint',
        actor: 'verifier',
        message: 'Verification passed',
        data: { passed: true, command: 'pnpm test' },
      },
    });
  }
  if (options.policy) {
    lines.push({
      type: 'run_event',
      version: 1,
      runId,
      seq: 3,
      event: {
        version: 1,
        runId,
        taskId,
        seq: 3,
        timestamp: '2026-06-02T00:00:03.000Z',
        type: 'tool.policy_blocked',
        severity: 'error',
        actor: 'tool',
        message: 'blocked',
        data: { code: 'DENY', message: 'blocked' },
      },
    });
  }
  lines.push({
    type: 'run_summary',
    version: 1,
    runId,
    status: 'needs_review',
    summary: 'Task finished',
    finalReport: options.finalReport === undefined ? 'Task finished' : options.finalReport,
    diffBytes: options.diffBytes ?? 42,
    eventCount: lines.length - 1,
  });
  return lines.map((line) => JSON.stringify(line)).join('\n');
}

describe('review rubric replay evaluation', () => {
  it('builds a reviewer result from JSONL without provider credentials', async () => {
    const result = await runReviewReplayEvaluationFromJsonl({
      jsonl: buildJsonl({ verification: true, diffBytes: 42 }),
      rubricId: 'basic-coding-run',
      mode: 'deterministic_only',
    });

    expect(result.reviewResult.reviewer.type).toBe('agent');
    expect(result.reviewResult.statusBefore).toBe('needs_review');
    expect(result.reviewResult.statusAfter).toBe('needs_review');
    expect(result.finalReviewerVerdict).toBe('approved');
    expect(result.events.map((event) => event.type)).toContain('review.evaluation_finished');
  });

  it('blocks missing verification and policy violation regardless of LLM availability', async () => {
    const result = await runReviewReplayEvaluationFromJsonl({
      jsonl: buildJsonl({ verification: false, policy: true, diffBytes: 42 }),
      rubricId: 'basic-coding-run',
      mode: 'llm_assisted',
    });

    expect(result.status).toBe('degraded');
    expect(result.finalReviewerVerdict).toBe('changes_requested');
    expect(result.reviewResult.findings.map((finding) => finding.title)).toEqual(
      expect.arrayContaining(['Verification result is present', 'No policy violation is present'])
    );
    expect(result.degradedReasons).toContain('llm_reviewer_provider_not_configured');
  });

  it('does not use run summary as final report evidence during replay', async () => {
    const result = await runReviewReplayEvaluationFromJsonl({
      jsonl: buildJsonl({
        verification: true,
        diffBytes: 42,
        finalReport: null,
        finalJudgmentEvent: false,
      }),
      rubricId: 'basic-coding-run',
      mode: 'deterministic_only',
    });

    expect(result.finalReviewerVerdict).toBe('changes_requested');
    expect(result.reviewResult.findings.map((finding) => finding.title)).toContain(
      'Final report is present'
    );
  });

  it('replays reviewer events without diagnostics', async () => {
    const evaluation = await runReviewReplayEvaluationFromJsonl({
      jsonl: buildJsonl({ verification: true, diffBytes: 42 }),
      rubricId: 'basic-coding-run',
      mode: 'deterministic_only',
    });
    const reviewerEvent = evaluation.events.at(-1);
    const jsonl = [
      JSON.stringify({
        type: 'nightworkers_run',
        version: 1,
        runId,
        taskId,
        createdAt: '2026-06-02T00:00:00.000Z',
        exportedAt: '2026-06-02T00:00:10.000Z',
      }),
      JSON.stringify({
        type: 'run_event',
        version: 1,
        runId,
        seq: 1,
        event: { ...reviewerEvent, seq: 1 },
        reviewResult: evaluation.reviewResult,
      }),
    ].join('\n');

    const parsed = parseRunJsonl(jsonl);
    const replay = replayRunJsonl(parsed);

    expect(parsed.diagnostics).toHaveLength(0);
    expect(replay.evidence.hasReviewResult).toBe(true);
    expect(replay.reviewResults).toHaveLength(1);
  });
});
