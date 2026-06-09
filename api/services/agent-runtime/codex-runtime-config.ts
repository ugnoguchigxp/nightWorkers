import type { CodexOptions, ThreadOptions } from '@openai/codex-sdk';
import type { AgentRunContext } from './types';

type CodexRuntimeConfigInput = {
  accessToken?: string;
  env?: NodeJS.ProcessEnv;
  enableNightworkersMcp?: boolean;
};

export function buildCodexRuntimeSdkOptions(input: CodexRuntimeConfigInput = {}): CodexOptions {
  const env = input.env ?? process.env;
  const mcpServers = input.enableNightworkersMcp === false ? {} : buildNightWorkersMcpServers(env);
  const sdkOptions: CodexOptions = {
    config: {
      features: {
        mcp: Object.keys(mcpServers).length > 0,
      },
      mcp_servers: mcpServers as any,
    },
  };
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

export function buildCodexRuntimeThreadOptions(context: AgentRunContext): ThreadOptions {
  const codexOptions =
    context.runtimeOptions?.codex && typeof context.runtimeOptions.codex === 'object'
      ? (context.runtimeOptions.codex as Record<string, unknown>)
      : {};
  const model = typeof codexOptions.model === 'string' ? codexOptions.model : undefined;
  const configuredEffort = process.env.CODEX_MODEL_REASONING_EFFORT;
  const modelReasoningEffort = isCodexReasoningEffort(configuredEffort)
    ? configuredEffort
    : 'medium';
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

function buildNightWorkersMcpServers(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const command = env.NIGHTWORKERS_CODEX_MCP_COMMAND;
  if (!command) return {};
  const args = splitArgs(env.NIGHTWORKERS_CODEX_MCP_ARGS || '');
  const serverEnv: Record<string, string> = {};
  if (env.NIGHTWORKERS_TASK_ID) serverEnv.NIGHTWORKERS_TASK_ID = env.NIGHTWORKERS_TASK_ID;
  if (env.NIGHTWORKERS_RUN_ID) serverEnv.NIGHTWORKERS_RUN_ID = env.NIGHTWORKERS_RUN_ID;
  return {
    nightworkers: {
      command,
      args,
      env: serverEnv,
    },
  };
}

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

function isCodexReasoningEffort(
  value: string | undefined
): value is 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' {
  return (
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
  );
}
