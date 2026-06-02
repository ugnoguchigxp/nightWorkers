import type { repositories, taskEvents, taskRuns } from '../../db/schema';
import { canonicalizeTaskEvent } from './canonicalize';
import type { RunEventJsonlHeader, RunEventJsonlLine, RunSummaryJsonlLine } from './types';

type RunRow = typeof taskRuns.$inferSelect;
type RepoRow = typeof repositories.$inferSelect;
type EventRow = typeof taskEvents.$inferSelect;

type RunWithEvents = {
  run: RunRow;
  repository?: RepoRow | null;
  events: EventRow[];
};

export function buildRunJsonlHeader(run: RunRow, repository?: RepoRow | null): RunEventJsonlHeader {
  return {
    type: 'nightworkers_run',
    version: 1,
    runId: run.id,
    taskId: run.taskId,
    repositoryId: run.repositoryId ?? null,
    createdAt: run.startedAt.toISOString(),
    cwd: repository?.localPath ?? null,
    workerKind: run.workerKind,
    exportedAt: new Date().toISOString(),
  };
}

export function serializeRunEventForJsonl(event: EventRow, run: RunRow): string {
  const payload = (event.payloadJson as any) || {};
  const runEvent = canonicalizeTaskEvent(event, run);
  const line: RunEventJsonlLine = {
    type: 'run_event',
    version: 1,
    runId: run.id,
    seq: event.seq,
    event: {
      ...runEvent,
      id: runEvent.id ?? event.id,
      seq: runEvent.seq ?? event.seq,
      runId: runEvent.runId || run.id,
      taskId: runEvent.taskId || run.taskId,
    },
    ...(payload.reviewResult ? { reviewResult: payload.reviewResult } : {}),
  };
  return JSON.stringify(line);
}

export function buildRunJsonlSummary(run: RunRow, events: EventRow[]): RunSummaryJsonlLine {
  return {
    type: 'run_summary',
    version: 1,
    runId: run.id,
    status: run.status,
    summary: run.summary,
    finalReport: run.finalReport,
    finalJudgment: run.finalJudgment,
    diffBytes: Buffer.byteLength(run.diffPatch || '', 'utf8'),
    eventCount: events.length,
  };
}

export function serializeRunToJsonl(input: RunWithEvents): string {
  const sortedEvents = [...input.events]
    .filter((event) => typeof event.seq === 'number')
    .sort((a, b) => a.seq - b.seq);
  const lines = [
    JSON.stringify(buildRunJsonlHeader(input.run, input.repository)),
    ...sortedEvents.map((event) => serializeRunEventForJsonl(event, input.run)),
    JSON.stringify(buildRunJsonlSummary(input.run, sortedEvents)),
  ];
  return `${lines.join('\n')}\n`;
}
