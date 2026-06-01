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
  startedAt: unknown;
  endedAt?: unknown | null;
  finishedAt?: unknown | null;
  logContent?: string | null;
  diffPatch?: string | null;
  testResults?: unknown | null;
  contextEval?: unknown | null;
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

export type RunDetails = TaskRun & {
  events: unknown[];
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
  action: 'complete' | 'request_follow_up' | 'cancel' | 'accept_risk';
  note?: string;
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
    { value: 'gpt-5.2', label: 'gpt-5.2' },
  ],
};
