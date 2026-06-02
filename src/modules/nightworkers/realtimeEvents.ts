import type { TaskEvent } from './types';

export function dedupeAndSortRunEvents(events: TaskEvent[]): TaskEvent[] {
  const uniq = new Map<string, TaskEvent>();
  const anonymous: TaskEvent[] = [];
  for (const event of events) {
    if (event?.id) {
      uniq.set(event.id, event);
    } else {
      anonymous.push(event);
    }
  }
  return [...Array.from(uniq.values()), ...anonymous].sort((a, b) => {
    const sa = typeof a.seq === 'number' ? a.seq : Number.MAX_SAFE_INTEGER;
    const sb = typeof b.seq === 'number' ? b.seq : Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return toMs(a.timestamp || a.createdAt) - toMs(b.timestamp || b.createdAt);
  });
}

export function mergeRunEvents(input: {
  latestRunId?: string | null;
  restEvents?: TaskEvent[];
  bufferedEventsByRun: Record<string, TaskEvent[]>;
}): TaskEvent[] {
  const { latestRunId, restEvents = [], bufferedEventsByRun } = input;
  if (!latestRunId) return dedupeAndSortRunEvents(restEvents);
  return dedupeAndSortRunEvents([...restEvents, ...(bufferedEventsByRun[latestRunId] || [])]);
}

function toMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
  }
  return Number.MAX_SAFE_INTEGER;
}
