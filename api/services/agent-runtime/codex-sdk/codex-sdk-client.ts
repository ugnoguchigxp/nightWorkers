import { Codex } from '@openai/codex-sdk';
import type { AgentRunContext } from '../types';
import {
  buildCodexRuntimeSdkOptions,
  buildCodexRuntimeThreadOptions,
} from './codex-sdk-runtime-config';

export type CodexRuntimeThread = {
  runStreamed(
    prompt: string,
    options: { signal: AbortSignal }
  ): Promise<{ events: AsyncIterable<unknown> }>;
};

export type CodexThreadFactory = (
  context: AgentRunContext
) => Promise<CodexRuntimeThread> | CodexRuntimeThread;

export async function createCodexRuntimeThread(input: {
  context: AgentRunContext;
  threadFactory?: CodexThreadFactory;
}): Promise<CodexRuntimeThread> {
  if (input.threadFactory) return input.threadFactory(input.context);
  const codexOptions = buildCodexRuntimeSdkOptions({
    accessToken: process.env.CODEX_ACCESS_TOKEN || '',
    env: {
      ...process.env,
      NIGHTWORKERS_TASK_ID: input.context.taskId,
      NIGHTWORKERS_RUN_ID: input.context.runId,
      NIGHTWORKERS_EXECUTION_MODE: readCodexRuntimeExecutionMode(input.context),
    },
  });
  const codex = new Codex(codexOptions);
  const threadOptions = buildCodexRuntimeThreadOptions(input.context);
  return codex.startThread(threadOptions);
}

function readCodexRuntimeExecutionMode(context: AgentRunContext) {
  const value = context.runtimeOptions?.executionMode;
  if (typeof value === 'string') return value;
  const snapshotValue = context.contextSnapshot.executionMode;
  return typeof snapshotValue === 'string' ? snapshotValue : 'implementation';
}
