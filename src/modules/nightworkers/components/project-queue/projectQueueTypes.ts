import type {
  ImplementationQueueDashboard,
  ImplementationQueueEntryStatus,
  Repository,
  Task,
  WorkbenchSessionView,
} from '../../types';

export type ProjectQueueTaskStatus =
  | 'unclassified'
  | 'planned'
  | 'executing'
  | 'attention'
  | 'completed';

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
  queueEntryStatus?: ImplementationQueueEntryStatus;
  queuePosition?: number | null;
  processorSlot?: number | null;
  activeRunId?: string | null;
  statusReason?: string | null;
  canMoveToPlanned?: boolean;
};

export type ProjectQueueLanes = Record<ProjectQueueLaneId, ProjectQueueTask[]>;

export type BuildProjectQueueTasksInput = {
  project: Repository;
  sessions: Task[];
  sessionViews: WorkbenchSessionView[];
  implementationQueue: ImplementationQueueDashboard | null;
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
