import type { repositories, taskEvents, taskRuns } from '../../db/schema';
import type {
  RunEventBase,
  RunEventJsonlHeader,
  RunEventJsonlLine,
  RunEventType,
  RunSummaryJsonlLine,
} from './types';

type RunRow = typeof taskRuns.$inferSelect;
type RepoRow = typeof repositories.$inferSelect;
type EventRow = typeof taskEvents.$inferSelect;

type RunWithEvents = {
  run: RunRow;
  repository?: RepoRow | null;
  events: EventRow[];
};

const LEGACY_TO_CANONICAL: Record<string, RunEventType> = {
  supervisor_decision: 'supervisor.decision',
  tool_call: 'tool.call_progress',
  tool_result: 'tool.call_finished',
  final_report: 'run.runtime_finished',
  run_outcome_decided: 'run.outcome_decided',
  warning: 'system.warning',
  error: 'system.error',
  checkpoint: 'verification.finished',
  state_change: 'run.recovered',
  info: 'model.response_delta',
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

function fallbackRunEvent(event: EventRow, run: RunRow): RunEventBase {
  const type =
    (event.eventType && LEGACY_TO_CANONICAL[event.eventType]) ||
    LEGACY_TO_CANONICAL[event.type] ||
    'system.warning';
  return {
    version: 1,
    id: event.id,
    runId: run.id,
    taskId: run.taskId,
    seq: event.seq,
    timestamp: event.timestamp.toISOString(),
    type,
    severity: event.type === 'error' ? 'error' : event.type === 'warning' ? 'warning' : 'info',
    actor: (event.actor as RunEventBase['actor']) || 'system',
    message: event.message,
    data: {},
  };
}

export function serializeRunEventForJsonl(event: EventRow, run: RunRow): string {
  const canonical = (event.payloadJson as any)?.runEvent as RunEventBase | undefined;
  const runEvent = canonical ?? fallbackRunEvent(event, run);
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
