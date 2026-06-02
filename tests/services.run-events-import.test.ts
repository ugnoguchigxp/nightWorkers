import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importRunJsonlToRun, prepareRunJsonlImport } from '../api/services/run-events/importer';
import { serializeRunToJsonl } from '../api/services/run-events/jsonl-export';

const repoMocks = vi.hoisted(() => ({
  getTaskRun: vi.fn(),
  listTaskEventsForRun: vi.fn(),
  createRunEvent: vi.fn(),
}));

vi.mock('../api/modules/nightworkers/nightworkers.repository', () => repoMocks);

beforeEach(() => {
  vi.clearAllMocks();
});

function sourceJsonl() {
  const sourceRun = {
    id: '11111111-1111-4111-8111-111111111116',
    taskId: '22222222-2222-4222-8222-222222222227',
    repositoryId: null,
    status: 'needs_review',
    workerKind: 'native-local',
    startedAt: new Date('2026-06-02T00:00:00.000Z'),
    diffPatch: '',
    summary: 'ready',
    finalReport: null,
    finalJudgment: null,
  } as any;
  const events = [
    {
      id: '33333333-3333-4333-8333-333333333371',
      taskRunId: sourceRun.id,
      seq: 1,
      actor: 'runtime',
      eventType: 'state_change',
      type: 'info',
      message: 'started',
      payloadJson: {
        runEvent: {
          version: 1,
          id: '33333333-3333-4333-8333-333333333371',
          runId: sourceRun.id,
          taskId: sourceRun.taskId,
          seq: 1,
          timestamp: '2026-06-02T00:00:01.000Z',
          type: 'run.runtime_started',
          severity: 'info',
          actor: 'runtime',
          message: 'started',
        },
      },
      timestamp: new Date('2026-06-02T00:00:01.000Z'),
    },
    {
      id: '33333333-3333-4333-8333-333333333372',
      taskRunId: sourceRun.id,
      seq: 2,
      actor: 'supervisor',
      eventType: 'run_outcome_decided',
      type: 'info',
      message: 'needs review',
      payloadJson: {
        runEvent: {
          version: 1,
          id: '33333333-3333-4333-8333-333333333372',
          runId: sourceRun.id,
          taskId: sourceRun.taskId,
          seq: 2,
          timestamp: '2026-06-02T00:00:02.000Z',
          type: 'run.outcome_decided',
          severity: 'checkpoint',
          actor: 'supervisor',
          message: 'needs review',
          data: { status: 'needs_review', reason: 'supervisor_completed' },
        },
        reviewResult: { verdict: 'approved' },
      },
      timestamp: new Date('2026-06-02T00:00:02.000Z'),
    },
  ] as any[];

  return serializeRunToJsonl({ run: sourceRun, events });
}

describe('run-events import preparation', () => {
  it('supports validate_only and replay_only without DB writes', () => {
    const validate = prepareRunJsonlImport({ text: sourceJsonl(), mode: 'validate_only' });
    const replay = prepareRunJsonlImport({ text: sourceJsonl(), mode: 'replay_only' });

    expect(validate.insertedEventCount).toBe(0);
    expect(validate.parsedEventCount).toBe(2);
    expect(replay.replay.terminal.status).toBe('needs_review');
  });

  it('returns diagnostics for invalid JSONL', () => {
    const result = prepareRunJsonlImport({ text: '{"type":"run_event"}' });

    expect(result.diagnostics.some((item) => item.level === 'error')).toBe(true);
    expect(result.insertedEventCount).toBe(0);
  });
});

describe('run-events import snapshot', () => {
  it('imports events into a target run idempotently and rewrites target run/task ids', async () => {
    const targetRun = {
      id: '44444444-4444-4444-8444-444444444444',
      taskId: '55555555-5555-4555-8555-555555555555',
      status: 'running',
    };
    repoMocks.getTaskRun.mockResolvedValue(targetRun);
    repoMocks.createRunEvent.mockResolvedValue({});
    repoMocks.listTaskEventsForRun.mockResolvedValueOnce([]);

    const first = await importRunJsonlToRun(targetRun.id, sourceJsonl());
    const insertedSourceKeys = repoMocks.createRunEvent.mock.calls.map(
      ([, options]) => options.payloadJson.importMeta.sourceKey
    );
    repoMocks.listTaskEventsForRun.mockResolvedValueOnce(
      insertedSourceKeys.map((sourceKey) => ({
        id: crypto.randomUUID(),
        payloadJson: { importMeta: { sourceKey } },
      }))
    );
    const second = await importRunJsonlToRun(targetRun.id, sourceJsonl());

    expect(first.insertedEventCount).toBe(2);
    expect(first.skippedDuplicateCount).toBe(0);
    expect(second.insertedEventCount).toBe(0);
    expect(second.skippedDuplicateCount).toBe(2);
    expect(repoMocks.createRunEvent).toHaveBeenCalledTimes(2);
    expect(repoMocks.getTaskRun).toHaveBeenCalledWith(targetRun.id);
    for (const [event, options] of repoMocks.createRunEvent.mock.calls) {
      expect(event.runId).toBe(targetRun.id);
      expect(event.taskId).toBe(targetRun.taskId);
      expect(options.payloadJson.importMeta.sourceRunId).toBe(
        '11111111-1111-4111-8111-111111111116'
      );
      expect(options.payloadJson.importMeta.sourceKey).toEqual(expect.any(String));
    }
  });
});
