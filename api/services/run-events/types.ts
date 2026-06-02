export const RUN_EVENT_TYPES = [
  'run.created',
  'run.context_compiled',
  'run.runtime_started',
  'run.runtime_finished',
  'run.outcome_decided',
  'run.recovered',
  'turn.started',
  'turn.finished',
  'model.request_started',
  'model.response_delta',
  'model.response_finished',
  'supervisor.decision',
  'tool.call_started',
  'tool.call_progress',
  'tool.call_finished',
  'tool.policy_blocked',
  'verification.started',
  'verification.finished',
  'git.status_collected',
  'git.diff_collected',
  'safety.budget_reached',
  'safety.policy_violation',
  'safety.repeated_failure',
  'human.review_submitted',
  'system.warning',
  'system.error',
] as const;

export type RunEventType = (typeof RUN_EVENT_TYPES)[number];
export type RunEventSeverity = 'debug' | 'info' | 'warning' | 'error' | 'checkpoint';
export type RunEventActor =
  | 'system'
  | 'runtime'
  | 'supervisor'
  | 'worker'
  | 'tool'
  | 'verifier'
  | 'human';

export interface RunEventBase<TType extends RunEventType = RunEventType> {
  version: 1;
  id?: string;
  runId: string;
  taskId?: string;
  seq?: number;
  timestamp: string;
  type: TType;
  severity: RunEventSeverity;
  actor: RunEventActor;
  message: string;
  data?: Record<string, unknown>;
}

export type RunEventJsonlHeader = {
  type: 'nightworkers_run';
  version: 1;
  runId: string;
  taskId: string;
  repositoryId?: string | null;
  createdAt: string;
  cwd?: string | null;
  workerKind?: string | null;
  exportedAt: string;
};

export type RunEventJsonlLine = {
  type: 'run_event';
  version: 1;
  runId: string;
  seq: number;
  event: RunEventBase;
  reviewResult?: unknown;
};

export type RunSummaryJsonlLine = {
  type: 'run_summary';
  version: 1;
  runId: string;
  status: string;
  summary?: string | null;
  finalReport?: string | null;
  diffBytes: number;
  eventCount: number;
};
