import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ThreadEvent } from '@openai/codex-sdk';
import { vi } from 'vitest';

const execFileAsync = promisify(execFile);

export function buildContext(
  input: {
    repoRoot?: string;
    codex?: Record<string, unknown>;
    executionMode?: 'planning' | 'implementation' | 'review' | 'runtime_debug' | 'general_answer';
    runtimeOptions?: Record<string, unknown>;
    ontologyContext?: unknown;
    latestUserMessage?: string;
    conversationContextUsage?: {
      latestUserMessageTokens: number;
      stateCardTokens: number;
      runtimeUserPromptTokens: number;
    };
    currentTodo?: {
      id: string;
      seq: number;
      title: string;
      taskType: string;
      status: string;
      procedureId?: string | null;
    };
    todoPlan?: Array<{
      id: string;
      seq: number;
      title: string;
      taskType: string;
      status: string;
      procedureId?: string | null;
    }>;
  } = {}
) {
  return {
    runId: 'run-codex',
    taskId: 'task-codex',
    repositoryId: 'repo-codex',
    repoRoot: input.repoRoot ?? process.cwd(),
    compiledPrompt: 'do work',
    latestUserMessage: input.latestUserMessage ?? 'do work',
    timeoutSeconds: 60,
    contextSnapshot: {
      compiledPrompt: 'do work',
      source: 'fallback' as const,
      ...(input.conversationContextUsage
        ? {
            conversationContext: {
              stateCardIncluded: true,
              usage: input.conversationContextUsage,
            },
          }
        : {}),
      ...(input.ontologyContext ? { ontologyContext: input.ontologyContext } : {}),
    },
    runtimeOptions:
      input.codex || input.executionMode || input.runtimeOptions
        ? {
            ...(input.codex ? { codex: input.codex } : {}),
            ...(input.executionMode ? { executionMode: input.executionMode } : {}),
            ...(input.runtimeOptions ?? {}),
          }
        : undefined,
    currentTodo: input.currentTodo,
    todoPlan: input.todoPlan,
  };
}

export function fakeThread(events: ThreadEvent[]) {
  return {
    runStreamed: vi.fn(async () => ({
      events: (async function* () {
        for (const event of events) yield event;
      })(),
    })),
  } as never;
}

export function fakeThreadThatThrows(events: ThreadEvent[], error: Error) {
  return {
    runStreamed: vi.fn(async () => ({
      events: (async function* () {
        for (const event of events) yield event;
        throw error;
      })(),
    })),
  } as never;
}

export async function git(cwd: string, args: string[]) {
  await execFileAsync('git', args, { cwd });
}
