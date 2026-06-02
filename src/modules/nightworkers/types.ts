export type Repository = {
  id: string;
  name: string;
  localPath: string;
  branch: string;
  allowed: boolean;
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
  contextEval?: unknown | null;
  createdAt: unknown;
  updatedAt: unknown;
  events?: TaskEvent[];
  reviews?: ReviewResult[];
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

export type RunDetails = TaskRun & {
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
};

export type CreateProjectInput = {
  name: string;
  localPath: string;
  branch: string;
};

export type CreateSessionInput = {
  repositoryId: string;
  title: string;
  description: string;
  objective: string;
  acceptanceCriteria: string;
};

export type ReviewRunInput = {
  runId: string;
  action: ReviewAction;
  note?: string;
  evidenceRefs?: ReviewEvidenceRef[];
  findings?: ReviewFinding[];
  humanCallouts?: ReviewFinding[];
  agentFollowUps?: string[];
  suggestedNextTasks?: string[];
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
