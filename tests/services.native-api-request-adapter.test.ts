import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildNativeApiProviderRequest } from '../api/services/agent-runtime/native-api-runner/native-api-request-adapter';
import {
  buildInitialNativeApiHistory,
  type NativeApiHistoryItem,
  projectNativeApiHistoryToProviderMessages,
} from '../api/services/agent-runtime/native-api-runner/native-api-tool-history';
import type { AgentRunContext } from '../api/services/agent-runtime/types';

describe('NativeApiRunner request adapter', () => {
  let restoreSettings: (() => void) | null = null;

  beforeEach(() => {
    restoreSettings = installRuntimeLlmSettings(defaultNativeApiRequestAdapterSettings());
  });

  afterEach(() => {
    restoreSettings?.();
    restoreSettings = null;
  });

  it('projects all system history into one leading provider system message', () => {
    const history: NativeApiHistoryItem[] = [
      { type: 'user', source: 'user', content: 'first user' },
      { type: 'system', content: 'system a' },
      {
        type: 'assistant',
        content: 'calling tool',
        toolCalls: [
          {
            id: 'call-1',
            name: 'read_file',
            arguments: { filePath: 'README.md' },
          },
        ],
      },
      {
        type: 'tool_result',
        toolCallId: 'call-1',
        toolName: 'read_file',
        result: { ok: true, content: '{"ok":true}' },
      },
      { type: 'system', content: 'system b' },
      { type: 'user', source: 'todo', content: 'current todo' },
    ];

    const messages = projectNativeApiHistoryToProviderMessages(history);

    expect(messages[0]).toEqual({
      role: 'system',
      content: 'system a\n\nsystem b',
    });
    expect(messages.slice(1).some((message) => message.role === 'system')).toBe(false);
    expect(messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'user',
    ]);
  });

  it('builds a provider request from initial runtime history without Codex fallback', () => {
    const context = buildContext({
      currentTodo: {
        id: 'todo-1',
        seq: 1,
        title: '仕様を読む',
        taskType: 'inspection',
        status: 'running',
        procedureId: 'contextstill.context_compile',
      },
    });
    const history = buildInitialNativeApiHistory(context);

    const request = buildNativeApiProviderRequest({
      context,
      history,
      tools: [
        {
          name: 'read_current_specification',
          description: 'Read latest NightWorkers specification.',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      ],
      routePolicy: {
        disallowedProviderIds: ['codex'],
      },
    });

    expect(request.options).toMatchObject({
      label: 'native_api_runner',
      role: 'implementation',
      taskId: 'task-1',
      runId: 'run-1',
      workingDirectory: '/repo',
      toolChoice: 'required',
      attemptTimeoutMs: 60000,
      routePolicy: {
        disallowedProviderIds: ['codex'],
      },
    });
    expect(request.messages[0]?.role).toBe('system');
    expect(request.messages.slice(1).some((message) => message.role === 'system')).toBe(false);
    expect(request.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('[Current Native API Runner Todo]'),
        }),
      ])
    );
    expect(request.tools).toHaveLength(1);
  });

  it('routes native/API planning mode through the plan role', () => {
    const context = buildContext({
      runtimeOptions: { executionMode: 'planning' },
    });
    const history = buildInitialNativeApiHistory(context);

    const request = buildNativeApiProviderRequest({
      context,
      history,
      tools: [],
      routePolicy: {
        disallowedProviderIds: ['codex'],
      },
    });

    expect(request.options).toMatchObject({
      role: 'plan',
      toolChoice: 'auto',
      normalizedRequest: expect.objectContaining({
        role: 'plan',
      }),
    });
    expect(request.messages[0]).toMatchObject({
      role: 'system',
      content: expect.stringContaining('executionMode: planning'),
    });
  });
});

function buildContext(overrides: Partial<AgentRunContext> = {}): AgentRunContext {
  return {
    runId: 'run-1',
    taskId: 'task-1',
    repositoryId: 'repo-1',
    repoRoot: '/repo',
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

function defaultNativeApiRequestAdapterSettings(): Record<string, unknown> {
  return {
    ACTIVE_LLM_PROVIDER: 'openai',
    providerEndpoints: [
      {
        id: 'test-openai',
        name: 'Test OpenAI',
        kind: 'openai',
        enabled: true,
        models: ['test-model'],
      },
    ],
    roleRoutes: [
      {
        role: 'implementation',
        primary: {
          providerEndpointId: 'test-openai',
          model: 'test-model',
        },
        fallbacks: [],
      },
      {
        role: 'plan',
        primary: {
          providerEndpointId: 'test-openai',
          model: 'test-model',
        },
        fallbacks: [],
      },
    ],
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
