import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  buildNormalizedSupervisorLlmRequest,
  callStructuredJsonLLM,
  callSupervisorLLM,
} from '../../api/services/supervisor/llm-provider';
import { installSupervisorLlmProviderEnvHooks } from './supervisor-llm-provider-test-env';

describe('Supervisor LLM schema-first parsing', () => {
  installSupervisorLlmProviderEnvHooks();

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
});
