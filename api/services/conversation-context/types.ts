export const CONVERSATION_CONTEXT_VERSION = 1 as const;

export type ConversationContextBuildReason =
  | 'intake_idle'
  | 'run_started'
  | 'run_finished'
  | 'manual_refresh';

export type RefreshConversationContextInput = {
  taskId: string;
  runId?: string | null;
  reason: ConversationContextBuildReason;
};

export type ConversationContextRefreshResult = {
  snapshot: ConversationContextSnapshotRecord;
};

export type ConversationContextOptions = {
  currentRunId?: string | null;
  maxTokens?: number;
  includeSmallTargetFile?: boolean;
  smallFileCharLimit?: number;
};

export type ConversationContextSnapshotRecord = {
  id: string;
  taskId: string;
  runId: string | null;
  version: number;
  jobType: string | null;
  latestUserMessageId: string | null;
  previousRunId: string | null;
  terminalState: string | null;
  tokenEstimate: number;
  snapshotJson: ConversationContextSnapshotV1;
  stateCardText: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ConversationContextSource = {
  task: {
    id: string;
    title: string;
    status: string;
    description: string | null;
    objective: string | null;
    repositoryPath: string;
  };
  messages: Array<{
    id: string;
    role: string;
    content: string;
    metadataJson: unknown;
    createdAt: Date;
  }>;
  runs: Array<{
    id: string;
    status: string;
    summary: string | null;
    finalReport: string | null;
    finalJudgment: unknown;
    contextSnapshot: unknown;
    startedAt: Date;
    finishedAt: Date | null;
    endedAt: Date | null;
  }>;
  previousSnapshot: ConversationContextSnapshotRecord | null;
};

export type ConversationContextSnapshotV1 = {
  version: typeof CONVERSATION_CONTEXT_VERSION;
  task: {
    id: string;
    status: string;
    latestUserMessageId: string | null;
    latestUserRequest: string;
    title: string;
  };
  classification: {
    jobType: string | null;
    goal: string | null;
    source: 'intake_metadata' | 'previous_run' | 'none';
  };
  continuity: {
    isContinuation: boolean;
    previousRunId: string | null;
    previousTerminalState: string | null;
    previousAction: string | null;
  };
  files: {
    target: string[];
    touched: string[];
    created: string[];
    modified: string[];
    deleted: string[];
  };
  runState: {
    lastError: string | null;
    lastFinalReport: string | null;
    lastToolFailure: string | null;
  };
  code: {
    snippets: Array<{
      path: string;
      reason: 'target_file_small' | 'relevant_hunk' | 'none';
      content: string;
      truncated: boolean;
    }>;
  };
  limits: {
    tokenEstimate: number;
    truncatedFields: string[];
  };
};

export type ConversationGitState = {
  nameStatus: Array<{
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed' | 'unknown';
  }>;
  diffStat: string | null;
  hunks: Array<{ path: string; content: string; truncated: boolean }>;
  errors: string[];
};
