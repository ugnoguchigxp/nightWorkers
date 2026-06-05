import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildCodexSupervisorSdkOptions,
  buildCodexSupervisorThreadOptions,
  callStructuredJsonLLM,
  callSupervisorLLM,
} from '../api/services/supervisor/llm-provider';

describe('Supervisor LLM provider', () => {
  it('isolates Codex supervisor calls from image and plugin features', () => {
    const options = buildCodexSupervisorSdkOptions('');

    expect(options).toEqual({
      config: {
        features: {
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
      },
    });
  });

  it('passes Codex access token while preserving supervisor feature isolation', () => {
    const originalPath = process.env.PATH;
    process.env.PATH = '/usr/bin';

    try {
      const options = buildCodexSupervisorSdkOptions('codex-token');

      expect(options.config).toEqual({
        features: {
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
      });
      expect(options.env).toMatchObject({
        PATH: '/usr/bin',
        CODEX_ACCESS_TOKEN: 'codex-token',
      });
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
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
  const originalFetch = globalThis.fetch;

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
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
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
