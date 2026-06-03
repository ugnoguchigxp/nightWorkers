import { describe, expect, it } from 'vitest';
import {
  dedupeAndSortRunEvents,
  getRealtimeMessageDedupeKey,
  mergeRunEvents,
} from '../src/modules/nightworkers/realtimeEvents';
import type { TaskEvent } from '../src/modules/nightworkers/types';

function event(id: string, runId: string, seq: number): TaskEvent {
  return {
    id,
    runId,
    seq,
    message: id,
    timestamp: `2026-06-02T00:00:${String(seq).padStart(2, '0')}.000Z`,
  };
}

describe('NightWorkers realtime event reconciliation', () => {
  it('dedupes by event id and sorts by seq', () => {
    const merged = dedupeAndSortRunEvents([
      event('evt-2', 'run-1', 2),
      { ...event('evt-1', 'run-1', 1), message: 'rest copy' },
      { ...event('evt-1', 'run-1', 1), message: 'ws copy' },
    ]);

    expect(merged.map((e) => e.id)).toEqual(['evt-1', 'evt-2']);
    expect(merged[0]?.message).toBe('ws copy');
  });

  it('keeps buffered events scoped to the latest run only', () => {
    const merged = mergeRunEvents({
      latestRunId: 'run-2',
      restEvents: [event('run-2-rest', 'run-2', 2)],
      bufferedEventsByRun: {
        'run-1': [event('run-1-ws', 'run-1', 1)],
        'run-2': [event('run-2-ws', 'run-2', 1)],
      },
    });

    expect(merged.map((e) => e.id)).toEqual(['run-2-ws', 'run-2-rest']);
  });

  it('builds stable websocket message dedupe keys from task sequence metadata', () => {
    expect(
      getRealtimeMessageDedupeKey({
        type: 'task_llm_delta',
        taskId: 'task-1',
        seq: 3,
        timestamp: '2026-06-03T00:00:00.000Z',
      })
    ).toBe('task-1:task_llm_delta:3:2026-06-03T00:00:00.000Z');
    expect(getRealtimeMessageDedupeKey({ type: 'task_llm_delta', taskId: 'task-1' })).toBeNull();
  });
});
