import type { CodexOptions, ThreadOptions } from '@openai/codex-sdk';
import {
  buildNightWorkersCodexToolApprovalConfig,
  getNightWorkersCodexToolNames,
} from '../../../mcp/nightworkers-tool-manifest';
import type { AgentRunContext } from '../types';

type CodexRuntimeConfigInput = {
  accessToken?: string;
  env?: NodeJS.ProcessEnv;
  enableNightworkersMcp?: boolean;
};

type CodexConfigValue = string | number | boolean | CodexConfigValue[] | CodexConfigObject;
type CodexConfigObject = {
  [key: string]: CodexConfigValue;
};

export type CodexRuntimeMcpConfigSource = 'inline_configured' | 'global_inherited' | 'disabled';

export type CodexRuntimeMcpConfigState = {
  source: CodexRuntimeMcpConfigSource;
  expectedTools: string[];
  hasInlineNightWorkersMcp: boolean;
  serverName: 'nightworkers' | null;
};

const NIGHTWORKERS_MCP_SERVER_NAME = 'nightworkers';

export function buildCodexRuntimeSdkOptions(input: CodexRuntimeConfigInput = {}): CodexOptions {
  const env = input.env ?? process.env;
  const mcpServers = input.enableNightworkersMcp === false ? {} : buildNightWorkersMcpServers(env);
  const sdkOptions: CodexOptions = {};
  if (input.enableNightworkersMcp === false) {
    sdkOptions.config = {
      features: { mcp: false },
      mcp_servers: {},
    };
  } else if (Object.keys(mcpServers).length > 0) {
    sdkOptions.config = {
      features: { mcp: true },
      mcp_servers: mcpServers,
    };
  }
  const sanitizedEnv = Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => {
      const [key, value] = entry;
      return typeof value === 'string' && !isCodexParentSessionEnv(key);
    })
  );
  sdkOptions.env = {
    ...sanitizedEnv,
    ...(input.accessToken ? { CODEX_ACCESS_TOKEN: input.accessToken } : {}),
  };
  return sdkOptions;
}

export function resolveCodexRuntimeMcpConfigState(
  input: Pick<CodexRuntimeConfigInput, 'env' | 'enableNightworkersMcp'> = {}
): CodexRuntimeMcpConfigState {
  const env = input.env ?? process.env;
  const expectedTools = getNightWorkersCodexToolNames();
  if (input.enableNightworkersMcp === false) {
    return {
      source: 'disabled',
      expectedTools,
      hasInlineNightWorkersMcp: false,
      serverName: null,
    };
  }
  const hasInlineNightWorkersMcp = Boolean(env.NIGHTWORKERS_CODEX_MCP_COMMAND);
  return {
    source: hasInlineNightWorkersMcp ? 'inline_configured' : 'global_inherited',
    expectedTools,
    hasInlineNightWorkersMcp,
    serverName: hasInlineNightWorkersMcp ? NIGHTWORKERS_MCP_SERVER_NAME : null,
  };
}

export function buildCodexRuntimeThreadOptions(context: AgentRunContext): ThreadOptions {
  const codexOptions =
    context.runtimeOptions?.codex && typeof context.runtimeOptions.codex === 'object'
      ? (context.runtimeOptions.codex as Record<string, unknown>)
      : {};
  const model = typeof codexOptions.model === 'string' ? codexOptions.model : undefined;
  const configuredEffort =
    typeof codexOptions.thinkingDepth === 'string'
      ? codexOptions.thinkingDepth
      : process.env.CODEX_MODEL_REASONING_EFFORT;
  const modelReasoningEffort = toCodexReasoningEffort(configuredEffort) ?? 'medium';
  return {
    model,
    sandboxMode: 'workspace-write',
    approvalPolicy: 'never',
    networkAccessEnabled: false,
    webSearchMode: 'disabled',
    workingDirectory: context.repoRoot,
    skipGitRepoCheck: true,
    modelReasoningEffort,
  };
}

function buildNightWorkersMcpServers(env: NodeJS.ProcessEnv): CodexConfigObject {
  const command = env.NIGHTWORKERS_CODEX_MCP_COMMAND;
  if (!command) return {};
  const args = splitArgs(env.NIGHTWORKERS_CODEX_MCP_ARGS || '');
  const serverEnv: Record<string, string> = {};
  for (const key of NIGHTWORKERS_MCP_ENV_KEYS) {
    const value = env[key];
    if (typeof value === 'string') serverEnv[key] = value;
  }
  return {
    [NIGHTWORKERS_MCP_SERVER_NAME]: {
      command,
      args,
      env: serverEnv,
      tools: buildNightWorkersCodexToolApprovalConfig(),
    },
  };
}

const NIGHTWORKERS_MCP_ENV_KEYS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'NODE_ENV',
  'PORT',
  'LOG_LEVEL',
  'NIGHTWORKERS_DESKTOP',
  'NIGHTWORKERS_RUNTIME_DIR',
  'NIGHTWORKERS_RESOURCE_DIR',
  'NIGHTWORKERS_TASK_ID',
  'NIGHTWORKERS_RUN_ID',
];

function splitArgs(value: string): string[] {
  return value
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean);
}

function isCodexParentSessionEnv(key: string) {
  return (
    key === 'CODEX_THREAD_ID' ||
    key === 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE' ||
    key === 'CODEX_SHELL' ||
    key === 'CODEX_CI'
  );
}

function toCodexReasoningEffort(
  value: string | undefined
): 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | null {
  if (value === 'minimal' || value === 'low' || value === 'medium' || value === 'high') {
    return value;
  }
  if (value === 'very_high' || value === 'xhigh') return 'xhigh';
  return null;
}
