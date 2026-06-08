import type {
  ActivityArtifact,
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

type SessionEvidence = {
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
    return 'Needs Human';
  }
  if (latestRun && ['needs_human', 'blocked', 'timed_out'].includes(latestRun.status)) {
    return 'Needs Human';
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
}): string[] {
  const badges: string[] = [];
  if (input.progress.blockers.length > 0) badges.push(input.progress.blockers[0].kind);
  if (input.latestRun?.testResults) badges.push('tests');
  if (input.latestRun?.diffPatch?.trim()) badges.push('diff');
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
        events: evidence.events || [],
        reviews: evidence.reviews || [],
        messages: evidence.messages || [],
      })
    ),
    badges: getSessionBadges({ task, progress, latestRun: evidence.latestRun }),
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

export function buildWorkbenchArtifactRefs(input: {
  task: Task;
  latestRun?: TaskRun;
  todos?: TaskRunTodo[];
  events?: TaskEvent[];
  reviews?: ReviewResult[];
  messages?: TaskMessage[];
  activityArtifacts?: ActivityArtifact[];
}): WorkbenchArtifactRef[] {
  const refs: WorkbenchArtifactRef[] = [];
  const run = input.latestRun;
  const blueprintArtifactRows = (input.activityArtifacts || []).filter(isBlueprintActivityArtifact);
  const blueprintArtifactMessageIds = new Set(
    blueprintArtifactRows
      .map((artifact) => activityArtifactMetadata(artifact).messageId)
      .filter(
        (messageId): messageId is string => typeof messageId === 'string' && messageId.length > 0
      )
  );
  const blueprintArtifactIds = new Set(blueprintArtifactRows.map((artifact) => artifact.id));
  const blueprintMessages = (input.messages || []).filter(
    (message) =>
      message.messageType === 'markdown_document' &&
      isBlueprintArtifactMessage(message) &&
      !isMessageCoveredByActivityArtifact(
        message,
        blueprintArtifactMessageIds,
        blueprintArtifactIds
      )
  );
  const dbDesignMessages = (input.messages || []).filter(
    (message) =>
      message.messageType === 'markdown_document' && isBlueprintDbDesignArtifactMessage(message)
  );
  const decisionReviewMessages = (input.messages || []).filter(
    (message) =>
      message.messageType === 'markdown_document' &&
      message.metadataJson?.intent === 'design_decision_review'
  );
  const implementationPlanMessages = (input.messages || []).filter(
    (message) =>
      message.messageType === 'markdown_document' &&
      (message.metadataJson?.intent === 'implementation_plan' ||
        message.metadataJson?.intent === 'draft_spec')
  );
  if (
    blueprintArtifactRows.length > 0 ||
    blueprintMessages.length > 0 ||
    dbDesignMessages.length > 0 ||
    decisionReviewMessages.length > 0 ||
    implementationPlanMessages.length > 0
  ) {
    const latestWorkspaceMessage =
      [
        ...blueprintMessages,
        ...dbDesignMessages,
        ...decisionReviewMessages,
        ...implementationPlanMessages,
      ].sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))[0] || blueprintMessages.at(-1);
    const latestBlueprintArtifactRow = [...blueprintArtifactRows].sort(
      (a, b) => toMs(b.createdAt) - toMs(a.createdAt)
    )[0];
    const workspaceSource = latestWorkspaceMessage
      ? { type: 'task_message' as const, messageId: latestWorkspaceMessage.id }
      : latestBlueprintArtifactRow
        ? { type: 'artifact_row' as const, artifactId: latestBlueprintArtifactRow.id }
        : { type: 'task_message' as const, messageId: '' };
    refs.push({
      id: `blueprint-workspace-${input.task.id}`,
      taskId: input.task.id,
      kind: 'blueprint_workspace',
      title: 'Specification Workspace',
      summary: [
        `${blueprintArtifactRows.length + blueprintMessages.length} Blueprint artifact${
          blueprintArtifactRows.length + blueprintMessages.length === 1 ? '' : 's'
        }`,
        `${decisionReviewMessages.length} Decision Review${decisionReviewMessages.length === 1 ? '' : 's'}`,
        `${implementationPlanMessages.length} Implementation Plan${implementationPlanMessages.length === 1 ? '' : 's'}`,
      ].join(' · '),
      source: workspaceSource,
      createdAt: String(
        latestWorkspaceMessage?.createdAt ||
          latestBlueprintArtifactRow?.createdAt ||
          input.task.updatedAt
      ),
      metadata: {
        blueprintCount: blueprintArtifactRows.length + blueprintMessages.length,
        dbDesignCount: dbDesignMessages.length,
        decisionReviewCount: decisionReviewMessages.length,
        implementationPlanCount: implementationPlanMessages.length,
      },
    });
  }
  for (const artifact of blueprintArtifactRows) {
    refs.push(activityArtifactRef(input.task.id, artifact));
  }
  for (const message of input.messages || []) {
    if (message.messageType !== 'markdown_document') continue;
    if (
      isBlueprintArtifactMessage(message) &&
      isMessageCoveredByActivityArtifact(message, blueprintArtifactMessageIds, blueprintArtifactIds)
    ) {
      continue;
    }
    const kind = inferDocumentArtifactKind(message);
    refs.push({
      id: `message-${message.id}`,
      taskId: input.task.id,
      runId: message.runId || undefined,
      kind,
      title: artifactTitleForKind(kind, message),
      summary: message.content.slice(0, 160),
      source: { type: 'task_message', messageId: message.id },
      createdAt: String(message.createdAt),
      metadata: isBlueprintDbDesignArtifactMessage(message)
        ? { ...(message.metadataJson || {}), initialTab: 'db-design' }
        : message.metadataJson || undefined,
    });
  }
  if (run?.diffPatch?.trim())
    refs.push(runFieldRef(input.task.id, run, 'diff', 'Code Diff', 'diffPatch'));
  if (run?.testResults)
    refs.push(runFieldRef(input.task.id, run, 'test_result', 'Test Result', 'testResults'));
  for (const review of input.reviews || []) {
    refs.push({
      id: `review-${review.id}`,
      taskId: input.task.id,
      runId: review.runId,
      kind: 'review_result',
      title: `Review: ${review.verdict}`,
      summary: review.note || review.outcome.summary,
      source: { type: 'review_result', reviewId: review.id },
      createdAt: review.createdAt,
      metadata: { review },
    });
  }
  return refs.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
}

function activityArtifactRef(taskId: string, artifact: ActivityArtifact): WorkbenchArtifactRef {
  const metadata = activityArtifactMetadata(artifact);
  const appBlueprint = metadata.appBlueprint || parseArtifactContentJson(artifact.contentText);
  const title = String(appBlueprint?.name || metadata.title || 'App Blueprint');
  return {
    id: `artifact-${artifact.id}`,
    taskId,
    runId: artifact.runId || undefined,
    kind: 'app_blueprint',
    title: `Blueprint: ${title}`,
    summary:
      typeof appBlueprint?.description === 'string'
        ? appBlueprint.description
        : (artifact.contentText || '').slice(0, 160),
    source: { type: 'artifact_row', artifactId: artifact.id },
    createdAt: String(artifact.createdAt),
    metadata: {
      ...metadata,
      appBlueprint,
      artifactRef: { artifactId: artifact.id, kind: 'app_blueprint', version: 1 },
    },
  };
}

function isBlueprintActivityArtifact(artifact: ActivityArtifact): boolean {
  const metadata = activityArtifactMetadata(artifact);
  return (
    (artifact.kind === 'app_blueprint' || metadata.schemaName === 'app_blueprint') &&
    !isBlueprintDbDesignMetadata(metadata)
  );
}

function activityArtifactMetadata(artifact: ActivityArtifact): Record<string, any> {
  return artifact.metadataJson && typeof artifact.metadataJson === 'object'
    ? artifact.metadataJson
    : {};
}

function parseArtifactContentJson(content: string | null | undefined): any {
  if (!content?.trim()) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function isMessageCoveredByActivityArtifact(
  message: TaskMessage,
  artifactMessageIds: Set<string>,
  artifactIds: Set<string>
): boolean {
  const artifactId = message.metadataJson?.artifactRef?.artifactId;
  return (
    artifactMessageIds.has(message.id) ||
    (typeof artifactId === 'string' && artifactIds.has(artifactId))
  );
}

export function getRunEventType(event: TaskEvent): string {
  return event.payloadJson?.runEvent?.type || event.eventType || event.type || '';
}

function runFieldRef(
  taskId: string,
  run: TaskRun,
  kind: WorkbenchArtifactKind,
  title: string,
  field: string
): WorkbenchArtifactRef {
  return {
    id: `run-${run.id}-${field}`,
    taskId,
    runId: run.id,
    kind,
    title,
    source: { type: 'run_field', runId: run.id, field },
    createdAt: String(run.finishedAt || run.updatedAt || run.createdAt),
  };
}

function countArtifacts(refs: WorkbenchArtifactRef[]) {
  return refs.reduce<Partial<Record<WorkbenchArtifactKind, number>>>((acc, ref) => {
    acc[ref.kind] = (acc[ref.kind] || 0) + 1;
    return acc;
  }, {});
}

function inferDocumentArtifactKind(message: TaskMessage): WorkbenchArtifactKind {
  const intent = message.metadataJson?.intent;
  if (isBlueprintDbDesignArtifactMessage(message)) return 'blueprint_workspace';
  if (isBlueprintArtifactMessage(message)) return 'app_blueprint';
  if (intent === 'component_design' || message.metadataJson?.componentDesign)
    return 'component_design';
  if (intent === 'design_delta' || message.metadataJson?.designDelta) return 'design_delta';
  if (intent === 'draft_spec') return 'spec';
  if (intent === 'implementation_plan') return 'implementation_plan';
  return 'spec';
}

function isBlueprintArtifactMessage(message: TaskMessage): boolean {
  const metadata = message.metadataJson || {};
  return (
    (metadata.intent === 'app_blueprint' || metadata.appBlueprint) &&
    !isBlueprintDbDesignArtifactMessage(message)
  );
}

function isBlueprintDbDesignArtifactMessage(message: TaskMessage): boolean {
  const metadata = message.metadataJson || {};
  return isBlueprintDbDesignMetadata(metadata);
}

function isBlueprintDbDesignMetadata(metadata: Record<string, any>): boolean {
  return (
    metadata.artifactType === 'blueprint_db_design' ||
    metadata.source === 'blueprint-db-design' ||
    Boolean(metadata.dbDesignTarget)
  );
}

function hasImplementationPlanEvidence(messages: TaskMessage[]) {
  return messages.some((message) => {
    if (message.messageType !== 'markdown_document') return false;
    const intent = message.metadataJson?.intent;
    return (
      intent === 'implementation_plan' || intent === 'draft_spec' || intent === 'app_blueprint'
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

function artifactTitleForKind(kind: WorkbenchArtifactKind, message: TaskMessage): string {
  const metadataTitle = message.metadataJson?.title;
  if (typeof metadataTitle === 'string' && metadataTitle.trim()) {
    if (isBlueprintDbDesignArtifactMessage(message)) return `DB Design: ${metadataTitle}`;
    if (kind === 'blueprint_workspace') return `Specification Workspace: ${metadataTitle}`;
    if (kind === 'app_blueprint') return `Blueprint: ${metadataTitle}`;
    if (kind === 'component_design') return `Component: ${metadataTitle}`;
    if (kind === 'design_delta') return `Design Delta: ${metadataTitle}`;
    if (kind === 'implementation_plan') return metadataTitle;
    if (kind === 'spec' && message.metadataJson?.intent === 'design_decision_review')
      return metadataTitle;
  }
  if (kind === 'blueprint_workspace') return 'Specification Workspace';
  if (kind === 'app_blueprint') return 'App Blueprint';
  if (kind === 'component_design') return 'Component Design';
  if (kind === 'design_delta') return 'Design Delta';
  if (kind === 'implementation_plan') return 'Implementation Plan';
  return 'Spec';
}

function hasFailedVerification(event: TaskEvent): boolean {
  const data = event.payloadJson?.runEvent?.data || (event.payloadJson as any) || {};
  return data.passed === false || data.status === 'failed';
}

function isCompletedSessionArchiveReady(task: Task, now: unknown = Date.now()) {
  const completedAtMs = toMs(task.updatedAt);
  const nowMs = toMs(now);
  if (!completedAtMs || !nowMs) return false;
  return nowMs - completedAtMs >= COMPLETED_SESSION_ARCHIVE_DELAY_MS;
}

function toMs(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const date = new Date(value as any);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : 0;
}
