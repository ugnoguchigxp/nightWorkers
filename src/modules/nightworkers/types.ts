export type Repository = {
  id: string;
  name: string;
  localPath: string;
  branch: string;
  allowed: boolean;
  queueEnabled: boolean;
  maxConcurrentSessions: number;
  safetyPolicy?: unknown | null;
  createdAt: unknown;
  updatedAt: unknown;
};

export type Task = {
  id: string;
  repositoryId: string;
  title: string;
  description?: string | null;
  objective?: string | null;
  acceptanceCriteria?: string | null;
  status: string;
  compiledPrompt?: string | null;
  timeoutSeconds: number;
  priority: number;
  createdBy?: string | null;
  createdAt: unknown;
  updatedAt: unknown;
};

export type TaskRun = {
  id: string;
  taskId: string;
  repositoryId?: string | null;
  status: string;
  workerKind: string;
  timeoutSeconds: number;
  contextSnapshot?: unknown | null;
  summary?: string | null;
  finalReport?: string | null;
  finalJudgment?: unknown | null;
  startedAt: unknown;
  endedAt?: unknown | null;
  finishedAt?: unknown | null;
  logContent?: string | null;
  diffPatch?: string | null;
  testResults?: unknown | null;
  createdAt: unknown;
  updatedAt: unknown;
  events?: TaskEvent[];
  reviews?: ReviewResult[];
  todos?: TaskRunTodo[];
};

export type ImplementationQueueEntryStatus =
  | 'queued'
  | 'claimed'
  | 'processing'
  | 'needs_human'
  | 'awaiting_commit_decision'
  | 'execution_completed'
  | 'execution_archived'
  | 'failed'
  | 'cancelled';

export type ImplementationQueueEntry = {
  id: string;
  taskId: string;
  repositoryId: string;
  status: ImplementationQueueEntryStatus;
  priority: number;
  queuePosition?: number | null;
  processorSlot?: number | null;
  activeRunId?: string | null;
  claimedAt?: unknown | null;
  lastHeartbeatAt?: unknown | null;
  archivedAt?: unknown | null;
  statusReason?: string | null;
  createdAt: unknown;
  updatedAt: unknown;
};

export type ImplementationQueueItem = ImplementationQueueEntry & {
  task: Task;
  repository: Repository;
};

export type ImplementationProcessorLane = {
  slot: number;
  entry: ImplementationQueueItem | null;
};

export type ImplementationQueueDashboard = {
  settings: { processorCount: number };
  processors: ImplementationProcessorLane[];
  queued: ImplementationQueueItem[];
  completed: ImplementationQueueItem[];
  notQueued: Array<{ task: Task; repository: Repository }>;
};

export type TodoWorkflowSettings = {
  id: string;
  requirePerTodoReview: boolean;
  requirePerTodoFix: boolean;
  requireFinalVerification: boolean;
  askCommitOnCompletion: boolean;
  hookPolicyJson?: unknown | null;
  createdAt: unknown;
  updatedAt: unknown;
};

export type WorkbenchSessionGroup = 'processing' | 'queue' | 'archive';

export type WorkbenchMovableSessionGroup = 'processing' | 'queue' | 'archive';

export type WorkbenchPhase =
  | 'Analyzing'
  | 'Prompt Preparing'
  | 'Queued'
  | 'Implementing'
  | 'Verifying'
  | 'Reviewing'
  | 'Improving'
  | 'Needs Human'
  | 'Completed'
  | 'Archived';

export type WorkbenchProgressBasisKind =
  | 'task_status'
  | 'run_status'
  | 'todo_status'
  | 'run_event'
  | 'review_result'
  | 'prompt_snapshot'
  | 'artifact';

export type WorkbenchProgressBlocker = {
  kind: 'needs_human' | 'policy' | 'verification' | 'timeout' | 'review' | 'runtime';
  message: string;
  evidenceRef?: string;
};

export type WorkbenchProgressSnapshot = {
  percent: number;
  phase: WorkbenchPhase;
  basis: Array<{
    kind: WorkbenchProgressBasisKind;
    refId?: string;
    label: string;
  }>;
  blockers: WorkbenchProgressBlocker[];
};

export type WorkbenchArtifactKind =
  | 'app_blueprint'
  | 'component_design'
  | 'design_delta'
  | 'spec'
  | 'implementation_plan'
  | 'context_pack'
  | 'diff'
  | 'source_preview'
  | 'test_result'
  | 'review_result'
  | 'run_ledger'
  | 'todo_plan'
  | 'final_report'
  | 'pr_reference';

export type ProjectFileEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
};

export type ProjectFileContent = {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
};

export type WorkbenchArtifactRef = {
  id: string;
  taskId: string;
  runId?: string;
  kind: WorkbenchArtifactKind;
  title: string;
  summary?: string;
  source:
    | { type: 'artifact_row'; artifactId: string }
    | { type: 'run_field'; runId: string; field: string }
    | { type: 'task_message'; messageId: string }
    | { type: 'run_event'; eventId: string }
    | { type: 'review_result'; reviewId: string };
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type WorkbenchSessionView = {
  task: Task;
  group: WorkbenchSessionGroup;
  queuePosition?: number;
  phase: WorkbenchPhase;
  progress: WorkbenchProgressSnapshot;
  latestRun?: TaskRun;
  latestEventSummary?: string;
  reviewNeed?: string;
  artifactCounts: Partial<Record<WorkbenchArtifactKind, number>>;
  badges: string[];
};

export type TaskType =
  | 'code_change'
  | 'test_change'
  | 'documentation'
  | 'review'
  | 'investigation'
  | 'verification';

export type TodoStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'needs_human';

export type TaskRunTodo = {
  id: string;
  runId: string;
  seq: number;
  title: string;
  description?: string | null;
  taskType: TaskType;
  status: TodoStatus;
  procedureId?: string | null;
  procedureSnapshot?: unknown | null;
  contextSnapshot?: unknown | null;
  completionGateResult?: unknown | null;
  dependsOn?: Array<string | number> | null;
  statusReason?: string | null;
  startedAt?: unknown | null;
  completedAt?: unknown | null;
  createdAt: unknown;
  updatedAt: unknown;
};

export type TaskMessage = {
  id: string;
  taskId: string;
  runId?: string | null;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  messageType?: 'text' | 'chart' | 'browser' | 'playwright' | 'flow' | 'markdown_document' | null;
  metadataJson?: any;
  createdAt: unknown;
};

export type WorkbenchChatIntent =
  | 'intake'
  | 'draft'
  | 'draft_spec'
  | 'create_task'
  | 'queue'
  | 'run_task'
  | 'adjust_running'
  | 'review_followup'
  | 'learning_capture'
  | 'design_component'
  | 'design_blueprint_data';

export type RunDetails = TaskRun & {
  todos: TaskRunTodo[];
  events: TaskEvent[];
  reviews: ReviewResult[];
};

export type TaskEvent = {
  id: string;
  taskRunId?: string;
  runId?: string;
  seq?: number;
  type?: string;
  actor?: string;
  eventType?: string | null;
  message: string;
  payloadJson?: {
    runEvent?: {
      version: 1;
      id?: string;
      runId: string;
      taskId?: string;
      seq?: number;
      timestamp: string;
      type: string;
      severity: 'debug' | 'info' | 'warning' | 'error' | 'checkpoint';
      actor: 'system' | 'runtime' | 'supervisor' | 'worker' | 'tool' | 'verifier' | 'human';
      message: string;
      data?: Record<string, unknown>;
    };
    legacyPayload?: unknown;
    [key: string]: unknown;
  };
  timestamp?: unknown;
  createdAt?: unknown;
};

export type ThinkingDepth = 'low' | 'medium' | 'high' | 'very_high';

export type ThinkingDepthOption = {
  value: ThinkingDepth;
  label: string;
};

export type ModelOption = {
  value: string;
  label: string;
};

export type LlmProvider = 'azure' | 'openai' | 'bedrock' | 'codex';

export type LlmSettings = {
  ACTIVE_LLM_PROVIDER: LlmProvider;
  AZURE_OPENAI_ENABLED: boolean;
  AZURE_OPENAI_API_KEY: string;
  AZURE_OPENAI_ENDPOINT: string;
  AZURE_OPENAI_DEPLOYMENT_NAME: string;
  AZURE_OPENAI_API_VERSION: string;
  OPENAI_ENABLED: boolean;
  OPENAI_API_KEY: string;
  OPENAI_BASE_URL: string;
  OPENAI_MODEL: string;
  AWS_BEDROCK_ENABLED: boolean;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_REGION: string;
  AWS_BEDROCK_MODEL: string;
  CODEX_ENABLED: boolean;
  CODEX_ACCESS_TOKEN: string;
  CODEX_MODEL: string;
  SESSION_QUEUE_MAX_CONCURRENCY: number;
};

export type McpServerTransport = 'stdio' | 'sse' | 'streamable_http';

export type McpServerConfig = {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpServerTransport;
  command?: string;
  args: string[];
  url?: string;
  cwd?: string;
  env: Record<string, string>;
  toolPrefix: string;
  createdAt: string;
  updatedAt: string;
  lastStatus?: {
    ok: boolean;
    checkedAt: string;
    message: string;
    toolCount?: number;
  };
};

export type McpServerInput = {
  name: string;
  enabled: boolean;
  transport: McpServerTransport;
  command?: string;
  args?: string[];
  url?: string;
  cwd?: string;
  env?: Record<string, string>;
  toolPrefix: string;
};

export type McpServerTestResult = {
  ok: boolean;
  message: string;
  toolCount?: number;
};

export type McpServerImportResult = {
  servers: McpServerConfig[];
  results: Array<{
    serverId: string;
    ok: boolean;
    message: string;
    toolCount?: number;
  }>;
};

export type AgentHookEvent =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Stop'
  | 'SessionEnd';

export type AgentHookHandler =
  | {
      type: 'command';
      command: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
      timeoutSeconds?: number;
      failClosed?: boolean;
    }
  | {
      type: 'http';
      url: string;
      headers?: Record<string, string>;
      allowedEnvVars?: string[];
      timeoutSeconds?: number;
      failClosed?: boolean;
    };

export type AgentHookConfig = {
  id: string;
  name: string;
  enabled: boolean;
  event: AgentHookEvent;
  matcher?: string;
  handler: AgentHookHandler;
  createdAt: string;
  updatedAt: string;
  lastRun?: {
    ok: boolean;
    checkedAt: string;
    message: string;
    durationMs?: number;
  };
};

export type AgentHookInput = {
  name: string;
  enabled: boolean;
  event: AgentHookEvent;
  matcher?: string;
  handler: AgentHookHandler;
};

export type AgentHookTestResult = {
  ok: boolean;
  message: string;
  durationMs?: number;
};

export type CreateProjectInput = {
  name: string;
  localPath: string;
  branch?: string;
};

export type UpdateProjectInput = {
  queueEnabled?: boolean;
  maxConcurrentSessions?: number;
};

export type CreateSessionInput = {
  repositoryId: string;
  title: string;
  description: string;
  objective: string;
  acceptanceCriteria: string;
};

export type ReviewAction = 'complete' | 'cancel';

export type ReviewVerdict = 'approved' | 'changes_requested' | 'cancelled';

export type ReviewEvidenceRef =
  | { kind: 'run_event'; eventId: string; seq?: number; eventType?: string }
  | { kind: 'diff'; runId: string; bytes?: number; hasChanges?: boolean }
  | { kind: 'final_report'; runId: string }
  | { kind: 'verification'; eventId?: string; passed?: boolean; command?: string }
  | { kind: 'policy'; eventId?: string; code?: string; message?: string }
  | { kind: 'artifact'; artifactId: string; artifactKind?: string }
  | { kind: 'changed_file'; path: string; added?: number; deleted?: number };

export type ReviewFinding = {
  severity: 'info' | 'warning' | 'blocking';
  title: string;
  body?: string;
  filePath?: string;
  line?: number;
  evidenceRefs?: ReviewEvidenceRef[];
};

export type ReviewOutcome = {
  status:
    | 'needs_review'
    | 'completed'
    | 'needs_human'
    | 'failed'
    | 'blocked'
    | 'timed_out'
    | 'cancelled';
  reason:
    | 'supervisor_completed'
    | 'supervisor_needs_human'
    | 'budget_exceeded'
    | 'tool_failure_limit'
    | 'policy_violation'
    | 'hook_blocked'
    | 'verification_failed'
    | 'runner_crashed'
    | 'human_review';
  summary: string;
};

export type ReviewResult = {
  version: 1;
  id: string;
  runId: string;
  taskId: string;
  reviewer: {
    type: 'human' | 'system' | 'agent';
    id?: string;
    label?: string;
  };
  action: ReviewAction;
  verdict: ReviewVerdict;
  note?: string;
  statusBefore: string;
  statusAfter: string;
  outcome: ReviewOutcome;
  evidenceRefs: ReviewEvidenceRef[];
  findings: ReviewFinding[];
  humanCallouts: ReviewFinding[];
  agentFollowUps: string[];
  suggestedNextTasks: string[];
  createdAt: string;
};

export const THINKING_DEPTH_OPTIONS: ThinkingDepthOption[] = [
  { value: 'low', label: '低い' },
  { value: 'medium', label: '標準' },
  { value: 'high', label: '高い' },
  { value: 'very_high', label: '非常に高い' },
];

export const DEFAULT_MODEL_OPTIONS: ModelOption[] = [
  { value: 'gpt-5.5', label: 'gpt-5.5' },
  { value: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
  { value: 'gpt-5-mini', label: 'gpt-5-mini' },
];

export const PROVIDER_MODEL_OPTIONS: Record<LlmProvider, ModelOption[]> = {
  azure: [
    { value: 'gpt-5.5', label: 'gpt-5.5' },
    { value: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
    { value: 'gpt-5-mini', label: 'gpt-5-mini' },
  ],
  openai: [
    { value: 'gpt-5.5', label: 'gpt-5.5' },
    { value: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
    { value: 'gpt-5-mini', label: 'gpt-5-mini' },
    { value: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
  ],
  bedrock: [
    {
      value: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      label: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    },
  ],
  codex: [
    { value: 'gpt-5.5', label: 'gpt-5.5' },
    { value: 'gpt-5.4', label: 'gpt-5.4' },
    { value: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
    { value: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
    { value: 'gpt-5.3-codex-spark', label: 'gpt-5.3-codex-spark' },
  ],
};
