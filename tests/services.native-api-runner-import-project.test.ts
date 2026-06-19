import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import {
  NativeApiRunner,
  type NativeApiToolTurnProvider,
} from '../api/services/agent-runtime/native-api-runner/native-api-runner';
import type { NativeApiSessionStore } from '../api/services/agent-runtime/native-api-runner/native-api-session-store';
import { getNativeApiToolDefinitions } from '../api/services/agent-runtime/native-api-runner/native-api-tool-registry';
import type { AgentRunContext, AgentRuntimeEvent } from '../api/services/agent-runtime/types';
import type { ProviderToolTurnResult } from '../api/services/structured-llm/tool-calls';
import { executeWorkerTool } from '../api/services/worker-tools/dispatcher';

vi.mock('../api/modules/nightworkers/nightworkers.repository', () => ({
  getTaskRun: vi.fn(),
  listTaskRunTodosForRun: vi.fn(),
}));

vi.mock('../api/services/worker-tools/dispatcher', () => ({
  executeWorkerTool: vi.fn(),
}));

describe('NativeApiRunner import_project flow', () => {
  let restoreSettings: (() => void) | null = null;

  beforeEach(() => {
    restoreSettings?.();
    restoreSettings = installRuntimeLlmSettings({
      ACTIVE_LLM_PROVIDER: 'local',
      providerEndpoints: [
        {
          id: 'local-api',
          name: 'Local API',
          kind: 'local',
          enabled: true,
          baseUrl: 'http://localhost:11434/v1',
          models: ['api-model'],
        },
      ],
      roleRoutes: [
        {
          role: 'implementation',
          primary: {
            providerEndpointId: 'local-api',
            model: 'api-model',
          },
          fallbacks: [],
        },
      ],
    });
    vi.clearAllMocks();
    vi.mocked(repo.getTaskRun).mockResolvedValue({ id: 'run-1', status: 'running' } as never);
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([] as never);
  });

  afterEach(() => {
    restoreSettings?.();
    restoreSettings = null;
  });

  it('exposes import_project without exposing materialize_template', () => {
    const toolNames = getNativeApiToolDefinitions().map((tool) => tool.name);

    expect(toolNames).toContain('import_project');
    expect(toolNames).not.toContain('materialize_template');
  });

  it('adds postImport context and blocks finalize until recommended verification succeeds', async () => {
    vi.mocked(executeWorkerTool)
      .mockResolvedValueOnce({
        result: {
          ok: true,
          toolName: 'import_project',
          startedAt: '2026-06-17T00:00:00.000Z',
          finishedAt: '2026-06-17T00:00:01.000Z',
          payload: {
            mode: 'template',
            template: { templateId: 'hono-standard', variant: 'sqlite' },
            git: null,
            postImport: {
              targetPath: '/tmp/project',
              manifest: {
                status: 'found',
                path: '/tmp/project/package.json',
                packageJson: { scripts: { verify: 'bun scripts/verify.ts' } },
                detectedPackageManager: 'bun',
                recommendedVerificationCommands: ['bun run verify'],
              },
              llmContext: { status: 'found', path: '/tmp/project/LLM_CONTEXT.md' },
            },
          },
        },
      } as never)
      .mockResolvedValueOnce({
        result: {
          ok: true,
          toolName: 'run_verification',
          startedAt: '2026-06-17T00:00:02.000Z',
          finishedAt: '2026-06-17T00:00:03.000Z',
          payload: { command: 'bun run verify', exitCode: 0 },
        },
      } as never);
    const store = createFakeStore();
    const providerTurn = createProvider([
      {
        type: 'supported',
        content: 'import starter',
        toolCalls: [
          {
            id: 'call-import',
            name: 'import_project',
            arguments: { source: 'starter', stack: 'hono', variant: 'sqlite' },
          },
        ],
        usage: usage(),
        model: 'api-model',
      },
      {
        type: 'supported',
        content: 'try final too early',
        toolCalls: [
          {
            id: 'call-final-early',
            name: 'finalize_answer',
            arguments: { finalReport: 'done too early' },
          },
        ],
        usage: usage(),
        model: 'api-model',
      },
      {
        type: 'supported',
        content: 'verify',
        toolCalls: [
          {
            id: 'call-verify',
            name: 'run_verification',
            arguments: { command: 'bun run verify', reason: 'post-import verification' },
          },
        ],
        usage: usage(),
        model: 'api-model',
      },
      {
        type: 'supported',
        content: 'finalize',
        toolCalls: [
          {
            id: 'call-final',
            name: 'finalize_answer',
            arguments: { finalReport: 'done after verification' },
          },
        ],
        usage: usage(),
        model: 'api-model',
      },
    ]);
    const runner = new NativeApiRunner({
      store: store.instance,
      startupController: createNoopStartup(),
      providerTurn,
      usageRecorder: vi.fn(async () => undefined),
    });

    const result = await runner.run(buildContext(), createSink());

    expect(result).toMatchObject({
      terminalState: 'completed',
      finalReport: 'done after verification',
    });
    expect(providerTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('[Native API Runner Post Import]'),
          }),
        ]),
      })
    );
    expect(store.finishedToolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'tool-2',
          status: 'failed',
          error: expect.objectContaining({ code: 'POST_IMPORT_VERIFICATION_REQUIRED' }),
        }),
        expect.objectContaining({
          id: 'tool-4',
          status: 'completed',
          result: expect.objectContaining({ ok: true }),
        }),
      ])
    );
  });

  it('blocks finalize after import_project failure instead of allowing fallback completion', async () => {
    vi.mocked(executeWorkerTool).mockResolvedValueOnce({
      result: {
        ok: false,
        toolName: 'import_project',
        startedAt: '2026-06-17T00:00:00.000Z',
        finishedAt: '2026-06-17T00:00:01.000Z',
        payload: { mode: '', template: null, git: null, postImport: null },
        error: {
          code: 'IMPORT_PROJECT_FAILED',
          message: 'template registry unavailable',
        },
      },
    } as never);
    const store = createFakeStore();
    const providerTurn = createProvider([
      {
        type: 'supported',
        content: 'import starter',
        toolCalls: [
          {
            id: 'call-import',
            name: 'import_project',
            arguments: { source: 'starter', stack: 'hono', variant: 'sqlite' },
          },
        ],
        usage: usage(),
        model: 'api-model',
      },
      {
        type: 'supported',
        content: 'try fallback finalize',
        toolCalls: [
          {
            id: 'call-final',
            name: 'finalize_answer',
            arguments: { finalReport: 'fallback static app is done' },
          },
        ],
        usage: usage(),
        model: 'api-model',
      },
      {
        type: 'supported',
        content: 'blocked import requires human follow-up',
        toolCalls: [],
        usage: usage(),
        model: 'api-model',
      },
    ]);
    const runner = new NativeApiRunner({
      store: store.instance,
      startupController: createNoopStartup(),
      providerTurn,
      usageRecorder: vi.fn(async () => undefined),
    });

    const result = await runner.run(buildContext(), createSink());

    expect(result).toMatchObject({
      terminalState: 'needs_human',
      stoppedBy: 'missing_tool_call',
    });
    expect(store.finishedToolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'tool-2',
          status: 'failed',
          error: expect.objectContaining({ code: 'POST_IMPORT_FAILED' }),
        }),
      ])
    );
  });
});

function createProvider(results: ProviderToolTurnResult[]): NativeApiToolTurnProvider {
  const providerTurn = vi.fn(async () => {
    const result = results.shift();
    if (!result) throw new Error('No provider result queued.');
    return result;
  });
  return providerTurn as unknown as NativeApiToolTurnProvider;
}

function createFakeStore() {
  const turns: Array<Record<string, unknown>> = [];
  const finishedTurns: Array<Record<string, unknown>> = [];
  const toolCalls: Array<Record<string, unknown>> = [];
  const runningToolCalls: string[] = [];
  const finishedToolCalls: Array<Record<string, unknown>> = [];
  const instance = {
    createTurn: vi.fn(async (input) => {
      const turn = { ...input, id: `turn-${turns.length + 1}` };
      turns.push(turn);
      return turn;
    }),
    finishTurn: vi.fn(async (input) => {
      finishedTurns.push(input);
      return input;
    }),
    recordToolCallPending: vi.fn(async (input) => {
      const record = {
        ...input,
        id: `tool-${toolCalls.length + 1}`,
        toolName: input.toolCall.name,
        status: 'pending',
      };
      toolCalls.push(record);
      return record;
    }),
    markToolCallRunning: vi.fn(async ({ id }) => {
      runningToolCalls.push(id);
      return { id, status: 'running' };
    }),
    finishToolCall: vi.fn(async (input) => {
      finishedToolCalls.push(input);
      return input;
    }),
  } as unknown as NativeApiSessionStore;
  return { instance, turns, finishedTurns, toolCalls, runningToolCalls, finishedToolCalls };
}

function createNoopStartup() {
  return {
    runStartup: vi.fn(async (input) => ({
      ok: true as const,
      history: input.history,
      state: input.state,
    })),
  };
}

function createSink(events: AgentRuntimeEvent[] = []) {
  return {
    emit: vi.fn(async (event: AgentRuntimeEvent) => {
      events.push(event);
    }),
  };
}

function usage() {
  return {
    inputTokens: 10,
    outputTokens: 5,
    cachedInputTokens: null,
    reasoningOutputTokens: null,
    totalTokens: 15,
    mode: 'measured' as const,
  };
}

function buildContext(overrides: Partial<AgentRunContext> = {}): AgentRunContext {
  return {
    runId: 'run-1',
    taskId: 'task-1',
    repositoryId: 'repo-1',
    repoRoot: '/Users/y.noguchi/Code/nightWorkers',
    compiledPrompt: 'implement the requested change',
    latestUserMessage: 'implement the requested change',
    timeoutSeconds: 60,
    contextSnapshot: {
      compiledPrompt: 'implement the requested change',
      source: 'fallback',
    },
    ...overrides,
  };
}

function installRuntimeLlmSettings(settings: Record<string, unknown>) {
  const previousPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-llm-settings-'));
  const settingsPath = path.join(dir, 'llm-settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify(settings));
  process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = settingsPath;
  return () => {
    if (previousPath === undefined) {
      delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
    } else {
      process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = previousPath;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  };
}
