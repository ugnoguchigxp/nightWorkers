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
