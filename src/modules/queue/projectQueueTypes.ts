export type ProjectQueueRepository = {
  id: string;
  name: string;
};

export type ProjectQueueSession = {
  id: string;
  repositoryId: string;
  title: string;
  status: string;
  createdBy?: string | null;
  updatedAt: unknown;
};

export type ProjectQueueEntryStatus =
  | 'queued'
  | 'claimed'
  | 'processing'
  | 'needs_human'
  | 'awaiting_commit_decision'
  | 'execution_completed'
  | 'execution_archived'
  | 'failed'
  | 'cancelled';

export type ProjectQueueEntry = {
  id: string;
  taskId: string;
  repositoryId: string;
  status: ProjectQueueEntryStatus;
  queuePosition?: number | null;
  processorSlot?: number | null;
  activeRunId?: string | null;
  statusReason?: string | null;
  executionType?: 'normal' | 'exclusive' | 'sequence';
  executionLockKey?: string | null;
  sequenceGroupId?: string | null;
  sequenceOrder?: number | null;
  schedulingReason?: string | null;
  updatedAt: unknown;
  task: ProjectQueueSession;
  repository: ProjectQueueRepository;
};

export type ProjectQueueProcessorLane = {
  slot: number;
  entry: ProjectQueueEntry | null;
};

export type ProjectQueueDashboard = {
  settings: { processorCount: number };
  processors: ProjectQueueProcessorLane[];
  queued: ProjectQueueEntry[];
  completed: ProjectQueueEntry[];
  notQueued: Array<{ task: ProjectQueueSession; repository: ProjectQueueRepository }>;
};

export type ProjectQueueSessionView = {
  task: ProjectQueueSession;
  emailState:
    | 'draft'
    | 'plan_ready'
    | 'queued'
    | 'running'
    | 'needs_input'
    | 'review_needed'
    | 'done'
    | 'failed';
  phase: string;
  queueEntry?: unknown;
};

export type ProjectQueueTaskStatus =
  | 'unclassified'
  | 'plan_mode'
  | 'ready_for_queue'
  | 'queued'
  | 'running'
  | 'review_required'
  | 'needs_human'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ProjectQueueLaneId = 'unclassified' | 'planned' | 'executing' | 'complete';

export type ProjectQueueViewMode = 'board' | 'table';

export type ProjectQueueTask = {
  id: string;
  sessionId: string;
  projectId: string;
  title: string;
  status: ProjectQueueTaskStatus;
  phase: string;
  updatedAt: unknown;
  queueEntryId?: string;
  queueEntryStatus?: ProjectQueueEntryStatus;
  queuePosition?: number | null;
  processorSlot?: number | null;
  activeRunId?: string | null;
  statusReason?: string | null;
  executionType?: 'normal' | 'exclusive' | 'sequence';
  canMoveToPlanned?: boolean;
};

export type ProjectQueueLanes = Record<ProjectQueueLaneId, ProjectQueueTask[]>;

export type BuildProjectQueueTasksInput = {
  project: ProjectQueueRepository;
  sessions: ProjectQueueSession[];
  sessionViews: ProjectQueueSessionView[];
  implementationQueue: ProjectQueueDashboard | null;
};

export type ProjectQueueScreenProps = BuildProjectQueueTasksInput & {
  isLoading: boolean;
  onOpenSession: (sessionId: string) => void;
  onRequeueEntry: (entryId: string, note?: string) => Promise<void>;
  onQueueSession: (sessionId: string) => Promise<void>;
  onUpdateQueueEntry: (
    entryId: string,
    input: { queuePosition?: number | null; priority?: number }
  ) => Promise<void>;
};
