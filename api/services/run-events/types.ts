export const RUN_EVENT_TYPES = [
  'run.created',
  'run.prompt_prepared',
  'run.runtime_started',
  'run.runtime_finished',
  'run.outcome_decided',
  'run.finalizing_started',
  'run.final_judgment_created',
  'run.recovered',
  'turn.started',
  'turn.finished',
  'model.request_started',
  'model.provider_activity_detected',
  'model.provider_tool_call_detected',
  'model.provider_activity_rejected',
  'model.retry_scheduled',
  'model.retry_started',
  'model.response_delta',
  'model.response_finished',
  'model.response_repaired',
  'model.response_parse_failed',
  'supervisor.decision',
  'tool.call_started',
  'tool.call_progress',
  'tool.call_finished',
  'tool.policy_blocked',
  'hook.started',
  'hook.finished',
  'hook.blocked',
  'hook.failed',
  'verification.started',
  'verification.finished',
  'git.status_collected',
  'git.diff_collected',
  'safety.budget_reached',
  'safety.policy_violation',
  'safety.repeated_failure',
  'human.review_submitted',
  'review.rubric_loaded',
  'review.evaluation_started',
  'review.llm_started',
  'review.llm_finished',
  'review.evaluation_finished',
  'system.info',
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
  finalJudgment?: unknown;
  todos?: Array<{
    id: string;
    seq: number;
    title: string;
    taskType: string;
    status: string;
    procedureId?: string | null;
    statusReason?: string | null;
    completionGateResult?: unknown;
  }>;
  diffBytes: number;
  eventCount: number;
};

export type JsonlDiagnostic = {
  level: 'warning' | 'error';
  line: number;
  code:
    | 'invalid_json'
    | 'invalid_schema'
    | 'missing_header'
    | 'duplicate_header'
    | 'duplicate_summary'
    | 'event_before_header'
    | 'seq_out_of_order'
    | 'duplicate_seq'
    | 'run_id_mismatch'
    | 'unsupported_version';
  message: string;
};

export type ParsedRunJsonl = {
  header?: RunEventJsonlHeader;
  events: RunEventJsonlLine[];
  summary?: RunSummaryJsonlLine;
  diagnostics: JsonlDiagnostic[];
};

export type ReplayResult = {
  sourceRunId: string;
  eventCount: number;
  events: RunEventBase[];
  todos: RunSummaryJsonlLine['todos'];
  terminal: {
    status?: string;
    reason?: string;
    summary?: string;
  };
  evidence: {
    hasRuntimeStarted: boolean;
    hasRuntimeFinished: boolean;
    hasOutcomeDecided: boolean;
    hasDiff: boolean;
    hasVerification: boolean;
    hasPolicyBlock: boolean;
    hasReviewResult: boolean;
    hasTodos: boolean;
  };
  reviewResults: unknown[];
  policyEvents: RunEventBase[];
  verificationEvents: RunEventBase[];
  diagnostics: JsonlDiagnostic[];
};

export type JsonlImportMode = 'validate_only' | 'replay_only' | 'import_snapshot';

export type JsonlImportResult = {
  mode: JsonlImportMode;
  sourceRunId: string;
  targetRunId?: string;
  parsedEventCount: number;
  insertedEventCount: number;
  skippedDuplicateCount: number;
  replay: ReplayResult;
  diagnostics: JsonlDiagnostic[];
};
