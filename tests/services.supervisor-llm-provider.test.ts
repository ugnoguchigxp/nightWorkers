import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCodexSupervisorSdkOptions,
  buildCodexSupervisorThreadOptions,
  buildNormalizedSupervisorLlmRequest,
  callStructuredJsonLLM,
  callSupervisorLLM,
} from '../api/services/supervisor/llm-provider';
import { readCodexStreamedTurn } from '../api/services/supervisor/llm-provider/codex';

describe('Supervisor LLM provider', () => {
  it('isolates Codex supervisor calls from image and plugin features', () => {
    const originalThreadId = process.env.CODEX_THREAD_ID;
    const originalOriginator = process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE;
    const originalCodexHome = process.env.CODEX_HOME;
    const originalSupervisorHome = process.env.NIGHTWORKERS_CODEX_SUPERVISOR_HOME;
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-codex-home-'));
    const supervisorHome = fs.mkdtempSync(
      path.join(os.tmpdir(), 'nightworkers-codex-supervisor-home-')
    );
    fs.writeFileSync(path.join(codexHome, 'auth.json'), '{"token":"test"}');
    fs.writeFileSync(path.join(codexHome, 'AGENTS.md'), 'call initial_instructions');
    fs.writeFileSync(path.join(codexHome, 'config.toml'), '[mcp_servers.context-still]');
    process.env.CODEX_THREAD_ID = 'parent-thread';
    process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE = 'Codex Desktop';
    process.env.CODEX_HOME = codexHome;
    process.env.NIGHTWORKERS_CODEX_SUPERVISOR_HOME = supervisorHome;
    const options = buildCodexSupervisorSdkOptions('');

    try {
      expect(options.config).toEqual({
        features: {
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
        },
        mcp_servers: {},
      });
      expect(options.env).toBeDefined();
      expect(options.env?.CODEX_THREAD_ID).toBeUndefined();
      expect(options.env?.CODEX_INTERNAL_ORIGINATOR_OVERRIDE).toBeUndefined();
      expect(options.env?.CODEX_HOME).toBe(supervisorHome);
      expect(fs.existsSync(path.join(supervisorHome, 'auth.json'))).toBe(true);
      expect(fs.existsSync(path.join(supervisorHome, 'AGENTS.md'))).toBe(false);
      expect(fs.existsSync(path.join(supervisorHome, 'config.toml'))).toBe(false);
    } finally {
      if (originalThreadId === undefined) delete process.env.CODEX_THREAD_ID;
      else process.env.CODEX_THREAD_ID = originalThreadId;
      if (originalOriginator === undefined) delete process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE;
      else process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE = originalOriginator;
      if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = originalCodexHome;
      if (originalSupervisorHome === undefined)
        delete process.env.NIGHTWORKERS_CODEX_SUPERVISOR_HOME;
      else process.env.NIGHTWORKERS_CODEX_SUPERVISOR_HOME = originalSupervisorHome;
      fs.rmSync(codexHome, { recursive: true, force: true });
      fs.rmSync(supervisorHome, { recursive: true, force: true });
    }
  });

  it('passes Codex access token while preserving supervisor feature isolation', () => {
    const originalPath = process.env.PATH;
    const originalShell = process.env.CODEX_SHELL;
    const originalSupervisorHome = process.env.NIGHTWORKERS_CODEX_SUPERVISOR_HOME;
    const supervisorHome = fs.mkdtempSync(
      path.join(os.tmpdir(), 'nightworkers-codex-supervisor-home-')
    );
    process.env.PATH = '/usr/bin';
    process.env.CODEX_SHELL = '1';
    process.env.NIGHTWORKERS_CODEX_SUPERVISOR_HOME = supervisorHome;

    try {
      const options = buildCodexSupervisorSdkOptions('codex-token');

      expect(options.config).toEqual({
        features: {
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
        },
        mcp_servers: {},
      });
      expect(options.env).toMatchObject({
        PATH: '/usr/bin',
        CODEX_ACCESS_TOKEN: 'codex-token',
      });
      expect(options.env?.CODEX_SHELL).toBeUndefined();
      expect(options.env?.CODEX_HOME).toBe(supervisorHome);
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
      if (originalShell === undefined) {
        delete process.env.CODEX_SHELL;
      } else {
        process.env.CODEX_SHELL = originalShell;
      }
      if (originalSupervisorHome === undefined)
        delete process.env.NIGHTWORKERS_CODEX_SUPERVISOR_HOME;
      else process.env.NIGHTWORKERS_CODEX_SUPERVISOR_HOME = originalSupervisorHome;
      fs.rmSync(supervisorHome, { recursive: true, force: true });
    }
  });

  it('runs Codex supervisor calls from the repository workspace', () => {
    const options = buildCodexSupervisorThreadOptions('gpt-5.4-mini', '/repo/project');

    expect(options).toMatchObject({
      model: 'gpt-5.4-mini',
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never',
      networkAccessEnabled: false,
      webSearchMode: 'disabled',
      skipGitRepoCheck: true,
    });
    expect(options.sandboxMode).not.toBe('read-only');
    expect(options.workingDirectory).toBe('/repo/project');
  });

  it('rejects Codex MCP tool calls with server and tool diagnostics', async () => {
    async function* events() {
      yield {
        type: 'item.started',
        item: {
          id: 'mcp-1',
          type: 'mcp_tool_call',
          server: 'context_still',
          tool: 'context_compile',
          arguments: { goal: 'classify' },
          status: 'in_progress',
        },
      };
    }
    const emitted: Array<{ type: string; data?: Record<string, unknown> }> = [];
    const request = buildNormalizedSupervisorLlmRequest({
      systemPrompt: 'system',
      userPrompt: 'user',
      label: 'supervisor',
      round: 1,
      schemaFirst: true,
      settings: { ACTIVE_LLM_PROVIDER: 'codex' },
    });

    await expect(
      readCodexStreamedTurn({
        thread: {
          runStreamed: async () => ({ events: events() as any }),
        } as any,
        prompt: 'prompt',
        signal: new AbortController().signal,
        options: {
          round: 1,
          schemaFirst: true,
          emitEvent: (event) => emitted.push({ type: event.type, data: event.data }),
        },
        normalizedRequest: request,
      })
    ).rejects.toThrow(/Provider activity rejected: codex.mcp_tool_call/);

    expect(emitted.at(-1)?.data).toMatchObject({
      providerId: 'codex',
      providerClass: 'agent_runtime',
      activityType: 'codex.mcp_tool_call',
      toolName: 'context_compile',
    });
    expect(String(emitted.at(-1)?.data?.preview || '')).toContain('context_still');
  });
});

describe('Supervisor LLM schema-first parsing', () => {
  const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
  const originalOpenAiEnabled = process.env.OPENAI_ENABLED;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalOpenAiModel = process.env.OPENAI_MODEL;
  const originalStreaming = process.env.OPENAI_STREAMING_ENABLED;
  const originalFixtureOutput = process.env.SUPERVISOR_FIXTURE_OUTPUT;
  const originalFixtureRound1Output = process.env.SUPERVISOR_FIXTURE_ROUND1_OUTPUT;
  const originalFixtureRound2Output = process.env.SUPERVISOR_FIXTURE_ROUND2_OUTPUT;
  const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
  const originalFetch = globalThis.fetch;
  let tempDir: string | null = null;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-llm-provider-'));
    process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = path.join(tempDir, 'llm-settings.json');
  });

  afterEach(() => {
    if (originalProvider === undefined) delete process.env.ACTIVE_LLM_PROVIDER;
    else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
    if (originalOpenAiEnabled === undefined) delete process.env.OPENAI_ENABLED;
    else process.env.OPENAI_ENABLED = originalOpenAiEnabled;
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
    if (originalOpenAiModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = originalOpenAiModel;
    if (originalStreaming === undefined) delete process.env.OPENAI_STREAMING_ENABLED;
    else process.env.OPENAI_STREAMING_ENABLED = originalStreaming;
    if (originalFixtureOutput === undefined) delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
    else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixtureOutput;
    if (originalFixtureRound1Output === undefined)
      delete process.env.SUPERVISOR_FIXTURE_ROUND1_OUTPUT;
    else process.env.SUPERVISOR_FIXTURE_ROUND1_OUTPUT = originalFixtureRound1Output;
    if (originalFixtureRound2Output === undefined)
      delete process.env.SUPERVISOR_FIXTURE_ROUND2_OUTPUT;
    else process.env.SUPERVISOR_FIXTURE_ROUND2_OUTPUT = originalFixtureRound2Output;
    if (originalSettingsPath === undefined) delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
    else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('normalizes provider request diagnostics without changing prompt text', () => {
    const request = buildNormalizedSupervisorLlmRequest({
      systemPrompt: 'system text',
      userPrompt: 'user text',
      jsonSchema: { name: 'example_schema', schema: { type: 'object' } },
      label: 'example_schema',
      settings: {
        ACTIVE_LLM_PROVIDER: 'azure',
        AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
        AZURE_OPENAI_DEPLOYMENT_NAME: 'gpt-deployment',
        AZURE_OPENAI_API_VERSION: '2024-05-01-preview',
      },
    });

    expect(request).toMatchObject({
      callKind: 'structured_artifact',
      providerId: 'azure-openai',
      providerClass: 'chat_completion',
      modelOrDeployment: 'gpt-deployment',
      endpoint: 'https://example.openai.azure.com',
      apiVersion: '2024-05-01-preview',
      diagnostics: {
        label: 'example_schema',
        artifactSchemaName: 'example_schema',
        systemPromptLength: 'system text'.length,
        userPromptLength: 'user text'.length,
      },
    });
    expect(request.systemPrompt).toBe('system text');
    expect(request.userPrompt).toBe('user text');
    expect(request.capabilityPolicy).toMatchObject({
      allowProviderToolCalls: false,
      allowProviderFileWrites: false,
      allowProviderCommandExecution: false,
      allowProviderNetwork: false,
      requireStructuredOutput: true,
    });
  });

  it('uses runtime provider settings ahead of environment fallback', async () => {
    process.env.ACTIVE_LLM_PROVIDER = 'openai';
    process.env.OPENAI_ENABLED = 'false';
    fs.writeFileSync(
      process.env.NIGHTWORKERS_LLM_SETTINGS_PATH!,
      JSON.stringify({
        ACTIVE_LLM_PROVIDER: 'fixture',
        SUPERVISOR_FIXTURE_OUTPUT: 'ignored',
      })
    );
    process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({ ok: true });

    const rawOutput = await callStructuredJsonLLM('system', 'user', {
      schemaName: 'example_schema',
      schema: { type: 'object' },
    });

    expect(JSON.parse(rawOutput)).toEqual({ ok: true });
  });

  it('repairs truncated schema-first toolCall JSON before schema validation', async () => {
    process.env.ACTIVE_LLM_PROVIDER = 'openai';
    process.env.OPENAI_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_MODEL = 'gpt-test';
    process.env.OPENAI_STREAMING_ENABLED = 'false';

    const rawDecision =
      '{"toolCall":{"name":"apply_patch","arguments":{"patchContent":"--- /dev/null\\n+++ b/example.ts\\n@@ -0,0 +1,1 @@\\n+export const createdByPatch = true;"}}';
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: rawDecision } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const events: Array<{ type: string; message: string }> = [];
    const decision = await callSupervisorLLM('system', 'user', {
      round: 2,
      schemaFirst: true,
      emitEvent: (event) => events.push({ type: event.type, message: event.message }),
    });

    expect(decision.toolCall.name).toBe('apply_patch');
    expect(decision.toolCall.arguments.patchContent).toContain('+++ b/example.ts');
    expect(events.some((event) => event.type === 'model.response_repaired')).toBe(true);
  });

  it('rejects plain text in schema-first calls instead of wrapping it as a legacy decision', async () => {
    process.env.ACTIVE_LLM_PROVIDER = 'openai';
    process.env.OPENAI_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_MODEL = 'gpt-test';
    process.env.OPENAI_STREAMING_ENABLED = 'false';

    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'plain text response' } }] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }) as unknown as typeof fetch;

    await expect(
      callSupervisorLLM('system', 'user', {
        round: 2,
        schemaFirst: true,
      })
    ).rejects.toThrow();
  });

  it('rejects OpenAI non-stream provider tool calls before parsing content', async () => {
    process.env.ACTIVE_LLM_PROVIDER = 'openai';
    process.env.OPENAI_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_MODEL = 'gpt-test';
    process.env.OPENAI_STREAMING_ENABLED = 'false';

    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  { type: 'function', function: { name: 'write_file', arguments: '{}' } },
                ],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }) as unknown as typeof fetch;

    const events: Array<{ type: string; data?: Record<string, unknown> }> = [];
    await expect(
      callSupervisorLLM('system', 'user', {
        round: 2,
        schemaFirst: true,
        emitEvent: (event) => events.push({ type: event.type, data: event.data }),
      })
    ).rejects.toThrow(/Provider activity rejected/);

    expect(events.map((event) => event.type)).toEqual([
      'model.request_started',
      'model.provider_tool_call_detected',
      'model.provider_activity_rejected',
    ]);
    expect(events.at(-1)?.data).toMatchObject({
      providerId: 'openai',
      providerClass: 'chat_completion',
      activityType: 'tool_call',
      toolName: 'write_file',
    });
  });

  it('emits response delta events while reading streamed OpenAI responses', async () => {
    process.env.ACTIVE_LLM_PROVIDER = 'openai';
    process.env.OPENAI_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_MODEL = 'gpt-test';
    process.env.OPENAI_STREAMING_ENABLED = 'true';

    const rawDecision = JSON.stringify({
      toolCall: {
        name: 'finalize_answer',
        arguments: { message: 'streamed answer' },
      },
    });
    const chunks = [rawDecision.slice(0, 20), rawDecision.slice(20, 48), rawDecision.slice(48)];
    const encoder = new TextEncoder();
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        new ReadableStream({
          start(controller) {
            for (const chunk of chunks) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`
                )
              );
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }
      );
    }) as unknown as typeof fetch;

    const events: Array<{ type: string; data?: Record<string, unknown> }> = [];
    const decision = await callSupervisorLLM('system', 'user', {
      round: 2,
      schemaFirst: true,
      emitEvent: (event) => events.push({ type: event.type, data: event.data }),
    });

    expect(decision.toolCall.name).toBe('finalize_answer');
    expect(
      events
        .filter((event) => event.type === 'model.response_delta')
        .map((event) => String(event.data?.text || ''))
        .join('')
    ).toBe(rawDecision);
  });

  it('rejects OpenAI streaming provider tool calls', async () => {
    process.env.ACTIVE_LLM_PROVIDER = 'openai';
    process.env.OPENAI_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_MODEL = 'gpt-test';
    process.env.OPENAI_STREAMING_ENABLED = 'true';

    const encoder = new TextEncoder();
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  choices: [
                    {
                      delta: {
                        tool_calls: [
                          { type: 'function', function: { name: 'run_command', arguments: '{}' } },
                        ],
                      },
                    },
                  ],
                })}\n\n`
              )
            );
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }
      );
    }) as unknown as typeof fetch;

    const events: Array<{ type: string; data?: Record<string, unknown> }> = [];
    await expect(
      callSupervisorLLM('system', 'user', {
        round: 2,
        schemaFirst: true,
        emitEvent: (event) => events.push({ type: event.type, data: event.data }),
      })
    ).rejects.toThrow(/Provider activity rejected/);

    expect(events.some((event) => event.type === 'model.provider_activity_rejected')).toBe(true);
    expect(events.at(-1)?.data).toMatchObject({
      providerId: 'openai',
      activityType: 'tool_call',
      toolName: 'run_command',
    });
  });

  it('uses configured fixture JSON instead of synthesizing a task-specific decision', async () => {
    process.env.ACTIVE_LLM_PROVIDER = 'fixture';
    process.env.SUPERVISOR_FIXTURE_ROUND1_OUTPUT = JSON.stringify({
      jobType: 'docs',
      goal: 'README の表記を確認する',
    });

    const decision = await callSupervisorLLM('system', 'whatever the user asked', {
      round: 1,
      schemaFirst: true,
    });

    expect(decision).toEqual({
      jobType: 'docs',
      goal: 'README の表記を確認する',
    });
  });

  it('requires explicit fixture JSON instead of falling back to hardcoded tool calls', async () => {
    process.env.ACTIVE_LLM_PROVIDER = 'fixture';
    delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
    delete process.env.SUPERVISOR_FIXTURE_ROUND2_OUTPUT;

    await expect(
      callSupervisorLLM('system', JSON.stringify({ toolResults: [] }), {
        round: 2,
        schemaFirst: true,
      })
    ).rejects.toThrow(/SUPERVISOR_FIXTURE_ROUND2_OUTPUT/);
  });

  it('uses explicit fixture JSON for structured JSON calls', async () => {
    process.env.ACTIVE_LLM_PROVIDER = 'fixture';
    process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
      title: 'Configured fixture output',
      items: ['one'],
    });

    const rawOutput = await callStructuredJsonLLM('system', 'user', {
      schemaName: 'example_schema',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'items'],
        properties: {
          title: { type: 'string' },
          items: { type: 'array', items: { type: 'string' } },
        },
      },
    });

    expect(JSON.parse(rawOutput)).toEqual({
      title: 'Configured fixture output',
      items: ['one'],
    });
  });

  it('rejects non-JSON structured fixture output', async () => {
    process.env.ACTIVE_LLM_PROVIDER = 'fixture';
    process.env.SUPERVISOR_FIXTURE_OUTPUT = 'plain fixture text';

    await expect(
      callStructuredJsonLLM('system', 'user', {
        schemaName: 'example_schema',
        schema: { type: 'object' },
      })
    ).rejects.toThrow(/response JSON parse failed/);
  });
});
