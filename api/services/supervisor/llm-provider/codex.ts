import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CodexOptions, Thread, ThreadEvent, Usage } from '@openai/codex-sdk';
import { createSupervisorResponseDeltaEmitter, traceProviderActivity } from './events';
import type { CallSupervisorOptions, NormalizedSupervisorLlmRequest } from './types';

const codexSupervisorFeatureOverrides = {
  mcp: false,
  image_generation: false,
  plugins: false,
  computer_use: false,
  browser_use: false,
  browser_use_external: false,
  in_app_browser: false,
  multi_agent: false,
  workspace_dependencies: false,
  tool_search: false,
} satisfies Record<string, boolean>;

export function buildCodexTurnPrompt(systemPrompt: string, userPrompt: string): string {
  return ['[システム指示]', systemPrompt, '', '[ユーザー入力]', userPrompt].join('\n');
}

export function buildCodexSupervisorSdkOptions(accessToken: string): CodexOptions {
  const sdkOptions: CodexOptions = {
    config: {
      features: codexSupervisorFeatureOverrides,
      mcp_servers: {},
    },
  };
  const sanitizedEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => {
      const [key, value] = entry;
      return typeof value === 'string' && !isCodexParentSessionEnv(key);
    })
  );
  sdkOptions.env = {
    ...sanitizedEnv,
    CODEX_HOME: prepareCodexSupervisorHome(),
    ...(accessToken ? { CODEX_ACCESS_TOKEN: accessToken } : {}),
  };
  return sdkOptions;
}

function isCodexParentSessionEnv(key: string) {
  return (
    key === 'CODEX_THREAD_ID' ||
    key === 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE' ||
    key === 'CODEX_SHELL' ||
    key === 'CODEX_CI'
  );
}

function prepareCodexSupervisorHome() {
  const targetHome =
    process.env.NIGHTWORKERS_CODEX_SUPERVISOR_HOME ||
    path.join(os.tmpdir(), 'nightworkers-codex-supervisor-home');
  fs.mkdirSync(targetHome, { recursive: true, mode: 0o700 });

  const sourceHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  copyCodexAuthFile(sourceHome, targetHome, 'auth.json');
  return targetHome;
}

function copyCodexAuthFile(sourceHome: string, targetHome: string, fileName: string) {
  const sourcePath = path.join(sourceHome, fileName);
  if (!fs.existsSync(sourcePath)) return;
  const targetPath = path.join(targetHome, fileName);
  fs.copyFileSync(sourcePath, targetPath);
  fs.chmodSync(targetPath, 0o600);
}

export function buildCodexSupervisorThreadOptions(
  model?: string,
  workingDirectory = process.cwd()
) {
  const configuredEffort = process.env.CODEX_MODEL_REASONING_EFFORT;
  const modelReasoningEffort = isCodexReasoningEffort(configuredEffort) ? configuredEffort : 'low';
  return {
    model,
    sandboxMode: 'workspace-write' as const,
    approvalPolicy: 'never' as const,
    networkAccessEnabled: false,
    webSearchMode: 'disabled' as const,
    workingDirectory,
    skipGitRepoCheck: true,
    modelReasoningEffort,
  };
}

export async function readCodexStreamedTurn(input: {
  thread: Thread;
  prompt: string;
  outputSchema?: unknown;
  signal: AbortSignal;
  options: CallSupervisorOptions;
  normalizedRequest?: NormalizedSupervisorLlmRequest;
}): Promise<{ content: string; usage: Usage | null }> {
  const { events } = await input.thread.runStreamed(input.prompt, {
    ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
    signal: input.signal,
  });
  let content = '';
  let usage: Usage | null = null;
  const latestAgentMessageTextById = new Map<string, string>();
  let latestAgentMessageText = '';
  const deltaEmitter = createSupervisorResponseDeltaEmitter({
    options: input.options,
    provider: 'codex',
    round: input.options.round,
  });

  const handleItemEvent = async (event: Extract<ThreadEvent, { type: `item.${string}` }>) => {
    const item = event.item;
    if (item.type !== 'agent_message') {
      if (input.normalizedRequest) {
        await traceProviderActivity({
          options: input.options,
          request: input.normalizedRequest,
          activityType: `codex.${item.type}`,
          toolName: item.type === 'mcp_tool_call' ? item.tool : null,
          preview: JSON.stringify(item),
        });
      }
      return;
    }
    const current = item.text || '';
    const previous = latestAgentMessageTextById.get(item.id) || '';
    latestAgentMessageTextById.set(item.id, current);
    if (current.trim()) latestAgentMessageText = current;
    if (current.startsWith(previous) && current.length > previous.length) {
      await deltaEmitter.push(current.slice(previous.length));
    }
    if (event.type === 'item.completed') content = current;
  };

  for await (const event of events) {
    if (
      event.type === 'item.started' ||
      event.type === 'item.updated' ||
      event.type === 'item.completed'
    ) {
      await handleItemEvent(event);
    } else if (event.type === 'turn.completed') {
      usage = event.usage;
    } else if (event.type === 'turn.failed') {
      throw new Error(event.error.message);
    } else if (event.type === 'error') {
      throw new Error(event.message);
    }
  }

  await deltaEmitter.flush();
  return { content: content || latestAgentMessageText, usage };
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
