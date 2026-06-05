import type { CodexOptions, Thread, ThreadEvent, Usage } from '@openai/codex-sdk';
import type { CallSupervisorOptions } from './types';

const codexSupervisorFeatureOverrides = {
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
    },
  };
  if (!accessToken) return sdkOptions;

  const mergedEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => {
      const [, value] = entry;
      return typeof value === 'string';
    })
  );
  sdkOptions.env = {
    ...mergedEnv,
    CODEX_ACCESS_TOKEN: accessToken,
  };
  return sdkOptions;
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
}): Promise<{ content: string; usage: Usage | null }> {
  void input.options;

  const { events } = await input.thread.runStreamed(input.prompt, {
    ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
    signal: input.signal,
  });
  let content = '';
  let usage: Usage | null = null;
  const latestAgentMessageTextById = new Map<string, string>();
  let latestAgentMessageText = '';

  const handleItemEvent = (event: Extract<ThreadEvent, { type: `item.${string}` }>) => {
    const item = event.item;
    if (item.type !== 'agent_message') return;
    const current = item.text || '';
    latestAgentMessageTextById.set(item.id, current);
    if (current.trim()) latestAgentMessageText = current;
    if (event.type === 'item.completed') content = current;
  };

  for await (const event of events) {
    if (
      event.type === 'item.started' ||
      event.type === 'item.updated' ||
      event.type === 'item.completed'
    ) {
      handleItemEvent(event);
    } else if (event.type === 'turn.completed') {
      usage = event.usage;
    } else if (event.type === 'turn.failed') {
      throw new Error(event.error.message);
    } else if (event.type === 'error') {
      throw new Error(event.message);
    }
  }

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
