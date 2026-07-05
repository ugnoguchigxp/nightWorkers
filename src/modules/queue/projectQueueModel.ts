import type {
  BuildProjectQueueTasksInput,
  ProjectQueueDashboard,
  ProjectQueueEntry,
  ProjectQueueEntryStatus,
  ProjectQueueLaneId,
  ProjectQueueLanes,
  ProjectQueueSession,
  ProjectQueueSessionView,
  ProjectQueueTask,
  ProjectQueueTaskStatus,
} from './projectQueueTypes';

const ATTENTION_EMAIL_STATES = new Set(['needs_input', 'failed']);
const COMPLETED_EMAIL_STATES = new Set(['done']);
const REVIEW_EMAIL_STATES = new Set(['review_needed']);
const ACTIVE_NON_REQUEUEABLE_ENTRY_STATUSES = new Set<ProjectQueueEntryStatus>([
  'queued',
  'claimed',
  'processing',
  'awaiting_commit_decision',
]);
const LANE_ORDER: ProjectQueueLaneId[] = ['unclassified', 'planned', 'executing', 'complete'];
const TABLE_STATUS_RANK: Record<ProjectQueueTaskStatus, number> = {
  running: 0,
  needs_human: 1,
  review_required: 1,
  failed: 1,
  queued: 2,
  ready_for_queue: 2,
  plan_mode: 3,
  unclassified: 3,
  cancelled: 4,
  completed: 4,
};

type TaskCandidate = {
  task: ProjectQueueSession;
  sessionView?: ProjectQueueSessionView;
};

export function buildProjectQueueTasks({
  project,
  sessions,
  sessionViews,
  implementationQueue,
}: BuildProjectQueueTasksInput): ProjectQueueTask[] {
  const taskById = new Map<string, TaskCandidate>();
  const sessionViewByTaskId = new Map(
    sessionViews
      .filter((view) => view.task.repositoryId === project.id)
      .map((view) => [view.task.id, view] as const)
  );
  const planReadyTaskIds = new Set(
    (implementationQueue?.notQueued || [])
      .filter((item) => item.repository.id === project.id)
      .map((item) => item.task.id)
  );

  for (const task of sessions) {
    if (task.repositoryId !== project.id) continue;
    taskById.set(task.id, { task, sessionView: sessionViewByTaskId.get(task.id) });
  }
  for (const view of sessionViewByTaskId.values()) {
    taskById.set(view.task.id, { task: view.task, sessionView: view });
  }
  for (const entry of projectQueueEntries(implementationQueue, project.id)) {
    taskById.set(entry.task.id, {
      task: entry.task,
      sessionView: sessionViewByTaskId.get(entry.task.id),
    });
  }
  for (const item of implementationQueue?.notQueued || []) {
    if (item.repository.id !== project.id) continue;
    taskById.set(item.task.id, {
      task: item.task,
      sessionView: sessionViewByTaskId.get(item.task.id),
    });
  }

  const projected = new Map<string, ProjectQueueTask>();
  for (const candidate of taskById.values()) {
    projected.set(candidate.task.id, createBaseTask(candidate));
  }

  for (const item of implementationQueue?.notQueued || []) {
    if (item.repository.id !== project.id) continue;
    const base = createBaseTask(taskById.get(item.task.id));
    projected.set(item.task.id, {
      ...base,
      status: 'ready_for_queue',
      phase: base.phase === 'Unclassified' ? 'Plan Complete' : base.phase,
      canMoveToPlanned: true,
    });
  }

  for (const entry of implementationQueue?.completed || []) {
    if (entry.repository.id !== project.id) continue;
    projected.set(
      entry.task.id,
      withEntry(
        createBaseTask(taskById.get(entry.task.id), entry),
        entry,
        statusFromQueueEntry(entry.status)
      )
    );
  }
  for (const entry of implementationQueue?.queued || []) {
    if (entry.repository.id !== project.id || entry.status !== 'queued') continue;
    projected.set(
      entry.task.id,
      withEntry(createBaseTask(taskById.get(entry.task.id), entry), entry, 'queued')
    );
  }
  for (const entry of projectQueueEntries(implementationQueue, project.id)) {
    const status = statusFromQueueEntry(entry.status);
    if (!['needs_human', 'review_required', 'failed', 'cancelled'].includes(status)) continue;
    projected.set(
      entry.task.id,
      withEntry(createBaseTask(taskById.get(entry.task.id), entry), entry, status)
    );
  }
  for (const view of sessionViewByTaskId.values()) {
    if (!ATTENTION_EMAIL_STATES.has(view.emailState) && !REVIEW_EMAIL_STATES.has(view.emailState)) {
      continue;
    }
    const current =
      projected.get(view.task.id) ?? createBaseTask({ task: view.task, sessionView: view });
    if (current.queueEntryStatus) continue;
    if (current.status === 'running' || current.status === 'completed') continue;
    projected.set(view.task.id, {
      ...current,
      status: REVIEW_EMAIL_STATES.has(view.emailState)
        ? 'review_required'
        : view.emailState === 'failed'
          ? 'failed'
          : 'needs_human',
      phase: String(view.phase),
      queuePosition: null,
      canMoveToPlanned: canQueueSessionWithoutEntry(view, planReadyTaskIds),
    });
  }
  for (const processor of implementationQueue?.processors || []) {
    const entry = processor.entry;
    if (!entry || entry.repository.id !== project.id) continue;
    if (entry.status !== 'claimed' && entry.status !== 'processing') continue;
    projected.set(
      entry.task.id,
      withEntry(
        createBaseTask(taskById.get(entry.task.id), entry),
        { ...entry, processorSlot: processor.slot },
        'running'
      )
    );
  }

  return Array.from(projected.values()).map((task) =>
    task.status === 'queued' ? task : { ...task, queuePosition: null }
  );
}

export function groupProjectQueueTasks(tasks: ProjectQueueTask[]): ProjectQueueLanes {
  const lanes: ProjectQueueLanes = {
    unclassified: [],
    planned: [],
    executing: [],
    complete: [],
  };
  for (const task of tasks) {
    if (task.status === 'unclassified' || task.status === 'plan_mode')
      lanes.unclassified.push(task);
    else if (task.status === 'ready_for_queue' || task.status === 'queued')
      lanes.planned.push(task);
    else if (task.status === 'running') lanes.executing.push(task);
    else lanes.complete.push(task);
  }
  lanes.unclassified.sort(compareUpdatedDesc);
  lanes.planned.sort(compareQueuePosition);
  lanes.executing.sort(compareProcessorSlot);
  lanes.complete.sort((a, b) => {
    if (a.status !== b.status) return TABLE_STATUS_RANK[a.status] - TABLE_STATUS_RANK[b.status];
    return compareUpdatedDesc(a, b);
  });
  return lanes;
}

export function getProjectQueueLaneOrder() {
  return LANE_ORDER;
}

export function sortProjectQueueTasksForTable(tasks: ProjectQueueTask[]) {
  return [...tasks].sort((a, b) => {
    const statusDiff = TABLE_STATUS_RANK[a.status] - TABLE_STATUS_RANK[b.status];
    if (statusDiff !== 0) return statusDiff;
    if (a.status === 'running') return compareProcessorSlot(a, b);
    if (a.status === 'queued') return compareQueuePosition(a, b);
    return compareUpdatedDesc(a, b);
  });
}

export function getProjectQueueStatusLabel(status: ProjectQueueTaskStatus) {
  if (status === 'unclassified') return 'Unclassified';
  if (status === 'plan_mode') return 'Plan Mode';
  if (status === 'ready_for_queue') return 'Ready for Queue';
  if (status === 'queued') return 'Implementation Queue';
  if (status === 'running') return 'Running';
  if (status === 'review_required') return 'Review Required';
  if (status === 'needs_human') return 'Needs Human';
  if (status === 'failed') return 'Failed';
  if (status === 'cancelled') return 'Cancelled';
  return 'Completed';
}

export function getProjectQueuePriorityLabel(task: ProjectQueueTask) {
  if (task.status !== 'queued' || typeof task.queuePosition !== 'number') return '';
  return `#${task.queuePosition}`;
}

export function compareProjectQueuePriority(a: ProjectQueueTask, b: ProjectQueueTask) {
  const aValue = a.status === 'queued' ? a.queuePosition : null;
  const bValue = b.status === 'queued' ? b.queuePosition : null;
  if (aValue == null && bValue == null) return 0;
  if (aValue == null) return 1;
  if (bValue == null) return -1;
  return aValue - bValue;
}

export function projectQueueTimestamp(value: unknown) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }
  return 0;
}

function createBaseTask(candidate?: TaskCandidate, entry?: ProjectQueueEntry): ProjectQueueTask {
  const task = candidate?.task ?? entry?.task;
  if (!task) throw new Error('Project Queue task requires a Task or queue entry.');
  const phase = candidate?.sessionView?.phase
    ? String(candidate.sessionView.phase)
    : 'Unclassified';
  const needsPlan =
    task.createdBy === 'project-evaluation' &&
    candidate?.sessionView?.emailState !== 'plan_ready' &&
    candidate?.sessionView?.emailState !== 'queued' &&
    candidate?.sessionView?.emailState !== 'running' &&
    candidate?.sessionView?.emailState !== 'done' &&
    candidate?.sessionView?.emailState !== 'review_needed';
  return {
    id: task.id,
    sessionId: task.id,
    projectId: task.repositoryId,
    title: task.title,
    status: COMPLETED_EMAIL_STATES.has(candidate?.sessionView?.emailState || '')
      ? 'completed'
      : REVIEW_EMAIL_STATES.has(candidate?.sessionView?.emailState || '')
        ? 'review_required'
        : candidate?.sessionView?.emailState === 'plan_ready'
          ? 'ready_for_queue'
          : needsPlan
            ? 'plan_mode'
            : 'unclassified',
    phase: needsPlan ? 'Plan Mode' : phase,
    updatedAt: entry?.updatedAt ?? task.updatedAt,
  };
}

function withEntry(
  task: ProjectQueueTask,
  entry: ProjectQueueEntry,
  status: ProjectQueueTaskStatus
): ProjectQueueTask {
  return {
    ...task,
    status,
    phase: status === 'queued' ? task.phase : task.phase || entry.status,
    updatedAt: entry.updatedAt ?? task.updatedAt,
    queueEntryId: entry.id,
    queueEntryStatus: entry.status,
    queuePosition: status === 'queued' ? entry.queuePosition : null,
    processorSlot: status === 'running' ? entry.processorSlot : null,
    activeRunId: entry.activeRunId,
    statusReason: entry.statusReason,
    executionType: entry.executionType ?? 'normal',
    canMoveToPlanned:
      ['review_required', 'needs_human', 'failed', 'cancelled'].includes(status) &&
      isRequeueableEntryStatus(entry.status) &&
      entry.task.status !== 'cancelled',
  };
}

function isRequeueableEntryStatus(status: ProjectQueueEntryStatus) {
  return !ACTIVE_NON_REQUEUEABLE_ENTRY_STATUSES.has(status);
}

function canQueueSessionWithoutEntry(view: ProjectQueueSessionView, planReadyTaskIds: Set<string>) {
  if (view.queueEntry) return false;
  if (planReadyTaskIds.has(view.task.id)) return true;
  return view.task.status === 'ready' || view.task.status === 'queued';
}

function statusFromQueueEntry(status: ProjectQueueEntryStatus): ProjectQueueTaskStatus {
  if (status === 'queued') return 'queued';
  if (status === 'claimed' || status === 'processing') return 'running';
  if (status === 'needs_human') return 'needs_human';
  if (status === 'awaiting_commit_decision' || status === 'execution_completed') {
    return 'review_required';
  }
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return 'completed';
}

function projectQueueEntries(
  dashboard: ProjectQueueDashboard | null,
  projectId: string
): ProjectQueueEntry[] {
  if (!dashboard) return [];
  const processorEntries = dashboard.processors
    .map((processor) => processor.entry)
    .filter((entry): entry is ProjectQueueEntry => Boolean(entry));
  return [...dashboard.queued, ...dashboard.completed, ...processorEntries].filter(
    (entry) => entry.repository.id === projectId
  );
}

function compareQueuePosition(a: ProjectQueueTask, b: ProjectQueueTask) {
  const diff =
    (a.queuePosition ?? Number.MAX_SAFE_INTEGER) - (b.queuePosition ?? Number.MAX_SAFE_INTEGER);
  if (diff !== 0) return diff;
  return compareUpdatedDesc(a, b);
}

function compareProcessorSlot(a: ProjectQueueTask, b: ProjectQueueTask) {
  const diff =
    (a.processorSlot ?? Number.MAX_SAFE_INTEGER) - (b.processorSlot ?? Number.MAX_SAFE_INTEGER);
  if (diff !== 0) return diff;
  return compareUpdatedDesc(a, b);
}

function compareUpdatedDesc(a: ProjectQueueTask, b: ProjectQueueTask) {
  return projectQueueTimestamp(b.updatedAt) - projectQueueTimestamp(a.updatedAt);
}
