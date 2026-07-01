import type {
  CodexContractWarningSummary,
  CodexMcpDiagnosticsSummary,
  ImplementationQueueEntry,
  ReviewResult,
  Task,
  TaskEvent,
  TaskMessage,
  TaskRun,
  TaskRunTodo,
  WorkbenchArtifactKind,
  WorkbenchArtifactRef,
  WorkbenchPhase,
  WorkbenchProgressBlocker,
  WorkbenchProgressSnapshot,
  WorkbenchSessionGroup,
  WorkbenchSessionView,
} from './types';
import { buildWorkbenchArtifactRefs } from './workbenchArtifactSelectors';
import {
  getRunEventType,
  higherWarningSeverity,
  isRecord,
  readNonEmptyString,
  readPositiveInteger,
  readRecord,
  readRecordArray,
  readStringArray,
  readWarningSeverity,
  taskMessageMetadata,
  toMs,
  warningSeverityRank,
} from './workbenchSelectorUtils';

const PROCESSING_TASK_STATUSES = new Set([
  'context_compiling',
  'compiling_context',
  'running',
  'finalizing',
  'verifying',
  'needs_review',
  'needs_human',
  'blocked',
  'timed_out',
]);
const QUEUE_TASK_STATUSES = new Set(['ready', 'queued']);
const ARCHIVE_TASK_STATUSES = new Set(['cancelled', 'failed']);
const COMPLETED_SESSION_ARCHIVE_DELAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_RUN_STATUSES = new Set([
  'context_compiling',
  'compiling_context',
  'running',
  'finalizing',
]);

export type SessionEvidence = {
  latestRun?: TaskRun;
  queueEntry?: ImplementationQueueEntry;
  planReady?: boolean;
  todos?: TaskRunTodo[];
  events?: TaskEvent[];
  reviews?: ReviewResult[];
  messages?: TaskMessage[];
};

type SessionGroupOptions = {
  now?: unknown;
};

export function getSessionGroup(
  task: Task,
  latestRun?: TaskRun,
  options: SessionGroupOptions = {}
): WorkbenchSessionGroup {
  if (latestRun && ACTIVE_RUN_STATUSES.has(latestRun.status)) return 'processing';
  if (PROCESSING_TASK_STATUSES.has(task.status)) return 'processing';
  if (QUEUE_TASK_STATUSES.has(task.status)) return 'queue';
  if (task.status === 'completed') {
    return isCompletedSessionArchiveReady(task, options.now) ? 'archive' : 'processing';
  }
  if (ARCHIVE_TASK_STATUSES.has(task.status)) return 'archive';
  return 'processing';
}

export function getSessionPhase(task: Task, evidence: SessionEvidence = {}): WorkbenchPhase {
  const latestRun = evidence.latestRun;
  const events = evidence.events || [];
  const todos = evidence.todos || [];
  const reviews = evidence.reviews || [];

  if (task.status === 'needs_human' || task.status === 'blocked' || task.status === 'timed_out') {
    return 'Needs Attention';
  }
  if (latestRun && ['needs_human', 'blocked', 'timed_out'].includes(latestRun.status)) {
    return 'Needs Attention';
  }
  if (isReviewNeededSession(task, evidence)) return 'Reviewing';
  if (task.status === 'completed') return 'Completed';
  if (task.status === 'cancelled' || task.status === 'failed') return 'Archived';
  if (task.status === 'queued' || task.status === 'ready') return 'Queued';
  if (evidence.queueEntry?.status === 'queued') return 'Queued';
  if (task.status === 'context_compiling' || latestRun?.status === 'context_compiling') {
    return 'Prompt Preparing';
  }
  if (latestRun?.status === 'needs_review' || task.status === 'needs_review') return 'Reviewing';
  if (reviews.some((review) => review.verdict === 'changes_requested')) return 'Improving';
  if (
    latestRun?.status === 'verifying' ||
    task.status === 'verifying' ||
    events.some((event) => getRunEventType(event).startsWith('verification.'))
  ) {
    return 'Verifying';
  }
  if (
    latestRun?.status === 'running' ||
    task.status === 'running' ||
    todos.some((todo) => todo.status === 'running')
  ) {
    return 'Implementing';
  }
  return 'Analyzing';
}

export function getSessionEmailState(
  task: Task,
  evidence: SessionEvidence = {}
): WorkbenchSessionView['emailState'] {
  const latestRun = evidence.latestRun;
  const queueStatus = evidence.queueEntry?.status;
  if (
    task.status === 'needs_human' ||
    task.status === 'blocked' ||
    task.status === 'timed_out' ||
    ['needs_human', 'blocked', 'timed_out'].includes(latestRun?.status || '') ||
    queueStatus === 'needs_human'
  ) {
    return 'needs_input';
  }
  if (
    task.status === 'failed' ||
    task.status === 'cancelled' ||
    latestRun?.status === 'failed' ||
    queueStatus === 'failed' ||
    queueStatus === 'cancelled'
  ) {
    return 'failed';
  }
  if (isReviewNeededSession(task, evidence)) return 'review_needed';
  if (task.status === 'completed' || queueStatus === 'execution_archived') return 'done';
  if (
    ACTIVE_RUN_STATUSES.has(latestRun?.status || '') ||
    PROCESSING_TASK_STATUSES.has(task.status) ||
    ['claimed', 'processing', 'awaiting_commit_decision'].includes(queueStatus || '')
  ) {
    return 'running';
  }
  if (task.status === 'queued' || queueStatus === 'queued') return 'queued';
  if (
    task.status === 'ready' ||
    evidence.planReady ||
    hasImplementationPlanEvidence(evidence.messages || [])
  ) {
    return 'plan_ready';
  }
  return 'draft';
}

export function getSessionPrimaryAction(
  state: WorkbenchSessionView['emailState']
): WorkbenchSessionView['primaryAction'] {
  if (state === 'plan_ready') return 'queue';
  if (state === 'queued') return 'remove';
  if (state === 'running') return 'open_run';
  if (state === 'needs_input') return 'respond';
  if (state === 'review_needed') return 'review';
  if (state === 'failed') return 'inspect';
  return 'open';
}

export function getSessionProgress(
  task: Task,
  evidence: SessionEvidence = {}
): WorkbenchProgressSnapshot {
  const latestRun = evidence.latestRun;
  const todos = evidence.todos || [];
  const events = evidence.events || [];
  const reviews = evidence.reviews || [];
  const messages = evidence.messages || [];
  const basis: WorkbenchProgressSnapshot['basis'] = [
    { kind: 'task_status', refId: task.id, label: `Task status: ${task.status}` },
  ];
  const blockers: WorkbenchProgressBlocker[] = [];
  let percent = 0;

  if (messages.some((message) => message.role === 'user') || task.description?.trim()) {
    percent = Math.max(percent, 10);
    basis.push({ kind: 'artifact', refId: task.id, label: 'User message persisted' });
  }
  if (task.objective?.trim() || task.acceptanceCriteria?.trim()) {
    percent = Math.max(percent, 20);
    basis.push({ kind: 'artifact', refId: task.id, label: 'Task draft has objective or criteria' });
  }
  if (task.compiledPrompt?.trim() || latestRun?.contextSnapshot) {
    percent = Math.max(percent, 30);
    basis.push({
      kind: 'prompt_snapshot',
      refId: latestRun?.id,
      label: 'Runtime prompt snapshot exists',
    });
  }
  if (latestRun) {
    percent = Math.max(percent, 50);
    basis.push({
      kind: 'run_status',
      refId: latestRun.id,
      label: `Latest run: ${latestRun.status}`,
    });
  }
  if (todos.length > 0 || events.some((event) => getRunEventType(event) === 'turn.started')) {
    percent = Math.max(percent, 65);
    basis.push({
      kind: 'todo_status',
      refId: latestRun?.id,
      label: 'Todo plan or implementation event exists',
    });
  }
  if (
    latestRun?.testResults ||
    events.some((event) => getRunEventType(event).startsWith('verification.'))
  ) {
    percent = Math.max(percent, 75);
    basis.push({ kind: 'run_event', refId: latestRun?.id, label: 'Verification evidence exists' });
  }
  if (
    reviews.some((review) => review.verdict === 'approved') ||
    latestRun?.status === 'needs_review'
  ) {
    percent = Math.max(percent, 85);
    basis.push({ kind: 'review_result', refId: reviews[0]?.id, label: 'Review evidence exists' });
  }
  if (task.status === 'completed') percent = 100;

  if (task.status === 'needs_human') {
    blockers.push({
      kind: 'needs_human',
      message: 'Task requires human input',
      evidenceRef: task.id,
    });
  }
  if (task.status === 'blocked') {
    blockers.push({ kind: 'runtime', message: 'Task is blocked', evidenceRef: task.id });
  }
  if (task.status === 'timed_out' || latestRun?.status === 'timed_out') {
    blockers.push({
      kind: 'timeout',
      message: 'Run timed out',
      evidenceRef: latestRun?.id || task.id,
    });
  }
  if (task.status === 'failed' || latestRun?.status === 'failed') {
    blockers.push({
      kind: 'runtime',
      message: 'Latest execution failed',
      evidenceRef: latestRun?.id || task.id,
    });
  }
  for (const event of events) {
    const type = getRunEventType(event);
    if (type === 'tool.policy_blocked' || type === 'safety.policy_violation') {
      blockers.push({ kind: 'policy', message: event.message, evidenceRef: event.id });
    }
    if (type === 'verification.finished' && hasFailedVerification(event)) {
      blockers.push({ kind: 'verification', message: event.message, evidenceRef: event.id });
    }
  }

  return {
    percent,
    phase: getSessionPhase(task, evidence),
    basis,
    blockers,
  };
}

export function getSessionBadges(input: {
  task: Task;
  progress: WorkbenchProgressSnapshot;
  latestRun?: TaskRun;
  contractWarnings?: CodexContractWarningSummary;
  mcpDiagnostics?: CodexMcpDiagnosticsSummary;
}): string[] {
  const badges: string[] = [];
  if (input.progress.blockers.length > 0) badges.push(input.progress.blockers[0].kind);
  if (input.latestRun?.testResults) badges.push('tests');
  if (input.latestRun?.diffPatch?.trim()) badges.push('diff');
  if (input.contractWarnings?.totalCount) {
    badges.push(
      input.contractWarnings.errorCount > 0
        ? `contract:${input.contractWarnings.errorCount} error`
        : `contract:${input.contractWarnings.warningCount} warning`
    );
  }
  if (input.mcpDiagnostics?.degraded) badges.push('mcp:degraded');
  if (input.task.priority > 0) badges.push(`P${input.task.priority}`);
  return badges;
}

export function buildWorkbenchSessionView(
  task: Task,
  evidence: SessionEvidence = {}
): WorkbenchSessionView {
  const progress = getSessionProgress(task, evidence);
  const latestEvent = (evidence.events || []).at(-1);
  const emailState = getSessionEmailState(task, evidence);
  const codexContractWarnings = getCodexContractWarningSummary(
    evidence.latestRun,
    evidence.events || []
  );
  const codexMcpDiagnostics = getCodexMcpDiagnosticsSummary(evidence.latestRun);
  return {
    task,
    group: getSessionGroup(task, evidence.latestRun),
    emailState,
    primaryAction: getSessionPrimaryAction(emailState),
    queueEntry: evidence.queueEntry,
    phase: progress.phase,
    progress,
    latestRun: evidence.latestRun,
    latestEventSummary: latestEvent?.message,
    reviewNeed: progress.blockers.find((blocker) => blocker.kind === 'review')?.message,
    artifactCounts: countArtifacts(
      buildWorkbenchArtifactRefs({
        task,
        latestRun: evidence.latestRun,
        todos: evidence.todos || [],
        reviews: evidence.reviews || [],
        messages: evidence.messages || [],
      })
    ),
    badges: getSessionBadges({
      task,
      progress,
      latestRun: evidence.latestRun,
      contractWarnings: codexContractWarnings,
      mcpDiagnostics: codexMcpDiagnostics,
    }),
    codexContractWarnings,
    codexMcpDiagnostics,
  };
}

export function getCodexContractWarningSummary(
  latestRun?: TaskRun,
  events: TaskEvent[] = []
): CodexContractWarningSummary | undefined {
  const snapshotWarnings = readCodexContractSnapshotWarnings(latestRun);
  const eventWarnings = readCodexContractEventWarnings(events);
  const snapshotKeys = new Set(snapshotWarnings.map(codexContractWarningIdentityKey));
  const warnings = [
    ...snapshotWarnings,
    ...eventWarnings.filter(
      (warning) => !snapshotKeys.has(codexContractWarningIdentityKey(warning))
    ),
  ];
  if (warnings.length === 0) return undefined;
  const byCode = new Map<string, CodexContractWarningSummary['items'][number]>();
  for (const warning of warnings) {
    const code = readNonEmptyString(warning.code);
    if (!code) continue;
    const severity = readWarningSeverity(warning.severity);
    const count = readPositiveInteger(warning.count) ?? 1;
    const existing = byCode.get(code);
    const changedFiles = readStringArray(warning.changedFiles);
    if (existing) {
      existing.count += count;
      existing.severity = higherWarningSeverity(existing.severity, severity);
      existing.changedFiles = [...new Set([...existing.changedFiles, ...changedFiles])];
      existing.command ||= readNonEmptyString(warning.command);
      existing.occurredAt ||= readNonEmptyString(warning.occurredAt) || undefined;
    } else {
      byCode.set(code, {
        code,
        severity,
        count,
        changedFiles,
        command: readNonEmptyString(warning.command),
        occurredAt: readNonEmptyString(warning.occurredAt) || undefined,
      });
    }
  }
  const items = [...byCode.values()].sort(
    (a, b) => warningSeverityRank(b.severity) - warningSeverityRank(a.severity) || b.count - a.count
  );
  const totalCount = items.reduce((sum, item) => sum + item.count, 0);
  return {
    totalCount,
    warningCount: items
      .filter((item) => item.severity === 'warning')
      .reduce((sum, item) => sum + item.count, 0),
    errorCount: items
      .filter((item) => item.severity === 'error')
      .reduce((sum, item) => sum + item.count, 0),
    items,
  };
}

function codexContractWarningIdentityKey(warning: Record<string, unknown>) {
  return [
    readNonEmptyString(warning.code) || '',
    readWarningSeverity(warning.severity),
    readNonEmptyString(warning.providerItemId) || '',
    readNonEmptyString(warning.toolName) || '',
    readNonEmptyString(warning.command) || '',
    readPositiveInteger(warning.todoSeq) ?? '',
    readStringArray(warning.changedFiles).sort().join(','),
  ].join('|');
}

export function getCodexMcpDiagnosticsSummary(
  latestRun?: TaskRun
): CodexMcpDiagnosticsSummary | undefined {
  const contract = readRuntimeContractSnapshot(latestRun);
  const mcp = readRecord(contract?.mcp);
  if (!mcp) return undefined;
  const configSource = readNonEmptyString(mcp.configSource);
  const degraded = mcp.degraded === true;
  const observedNightWorkersTools = readStringArray(mcp.observedNightWorkersTools);
  const expectedTools = readStringArray(mcp.expectedTools);
  const tone: CodexMcpDiagnosticsSummary['tone'] = degraded
    ? 'warning'
    : configSource === 'global_inherited'
      ? 'info'
      : 'neutral';
  const label = degraded
    ? 'MCP degraded'
    : configSource === 'global_inherited'
      ? 'MCP global inherited'
      : configSource
        ? `MCP ${configSource}`
        : 'MCP diagnostics';
  return {
    configSource,
    observedNightWorkersTools,
    expectedTools,
    degraded,
    tone,
    label,
  };
}

export function groupWorkbenchSessions(sessions: WorkbenchSessionView[]) {
  return {
    processing: sessions
      .filter((session) => session.group === 'processing')
      .sort(
        (a, b) =>
          b.task.priority - a.task.priority || toMs(b.task.updatedAt) - toMs(a.task.updatedAt)
      ),
    queue: sessions
      .filter((session) => session.group === 'queue')
      .sort(
        (a, b) =>
          b.task.priority - a.task.priority || toMs(b.task.updatedAt) - toMs(a.task.updatedAt)
      ),
    archive: sessions
      .filter((session) => session.group === 'archive')
      .sort((a, b) => toMs(b.task.updatedAt) - toMs(a.task.updatedAt)),
  };
}

function countArtifacts(refs: WorkbenchArtifactRef[]) {
  return refs.reduce<Partial<Record<WorkbenchArtifactKind, number>>>((acc, ref) => {
    acc[ref.kind] = (acc[ref.kind] || 0) + 1;
    return acc;
  }, {});
}

function readCodexContractSnapshotWarnings(latestRun?: TaskRun): Record<string, unknown>[] {
  const contract = readRuntimeContractSnapshot(latestRun);
  return readRecordArray(contract?.warnings);
}

function readRuntimeContractSnapshot(latestRun?: TaskRun): Record<string, unknown> | null {
  const contextSnapshot = readRecord(latestRun?.contextSnapshot);
  return readRecord(contextSnapshot?.runtimeContract) ?? readRecord(contextSnapshot?.codexContract);
}

function readCodexContractEventWarnings(events: TaskEvent[]): Record<string, unknown>[] {
  return events.flatMap((event) => {
    if (getRunEventType(event) !== 'system.warning') return [];
    const payload = isRecord(event.payloadJson) ? event.payloadJson : {};
    const runEvent = readRecord(payload.runEvent);
    const data = readRecord(runEvent?.data) || payload;
    const contractWarning = readRecord(data.contractWarning);
    if (contractWarning) return [contractWarning];
    return readNonEmptyString(data.code) ? [data] : [];
  });
}

function hasImplementationPlanEvidence(messages: TaskMessage[]) {
  return messages.some((message) => {
    if (message.messageType !== 'markdown_document') return false;
    const intent = String(taskMessageMetadata(message).intent);
    return (
      intent === 'implementation_plan' ||
      intent === 'feature_plan' ||
      intent === 'draft_spec' ||
      intent === 'app_blueprint'
    );
  });
}

function isReviewNeededSession(task: Task, evidence: SessionEvidence = {}) {
  const latestRun = evidence.latestRun;
  const queueStatus = evidence.queueEntry?.status;
  if (!latestRun) return task.status === 'needs_review' || queueStatus === 'execution_completed';
  const runTerminal = ['completed', 'needs_review'].includes(latestRun.status);
  const hasFinalReport = Boolean(latestRun.finalReport?.trim());
  const hasEvidence = Boolean(
    latestRun.diffPatch?.trim() ||
      latestRun.testResults ||
      evidence.events?.length ||
      latestRun.finalReport?.trim()
  );
  const accepted = (evidence.reviews || []).some(
    (review) => review.verdict === 'approved' || review.statusAfter === 'completed'
  );
  return (
    !accepted &&
    (task.status === 'needs_review' ||
      queueStatus === 'execution_completed' ||
      (runTerminal && hasFinalReport && hasEvidence))
  );
}

function hasFailedVerification(event: TaskEvent): boolean {
  const payload: Record<string, unknown> = isRecord(event.payloadJson) ? event.payloadJson : {};
  const runEvent: Record<string, unknown> = isRecord(payload.runEvent) ? payload.runEvent : {};
  const runEventData: Record<string, unknown> = isRecord(runEvent.data) ? runEvent.data : {};
  const data = Object.keys(runEventData).length > 0 ? runEventData : payload;
  return data.passed === false || data.status === 'failed';
}

function isCompletedSessionArchiveReady(task: Task, now: unknown = Date.now()) {
  const completedAtMs = toMs(task.updatedAt);
  const nowMs = toMs(now);
  if (!completedAtMs || !nowMs) return false;
  return nowMs - completedAtMs >= COMPLETED_SESSION_ARCHIVE_DELAY_MS;
}
