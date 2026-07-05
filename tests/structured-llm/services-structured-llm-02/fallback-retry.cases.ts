import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { callSupervisorLLM } from '../../../api/services/structured-llm';
import './setup';

describe('Supervisor LLM schema-first parsing fallback and retry', () => {
  it('retries local OpenAI-compatible transport failures with non-stream json_object', async () => {
    delete process.env.OPENAI_API_KEY;
    fs.writeFileSync(
      process.env.NIGHTWORKERS_LLM_SETTINGS_PATH!,
      JSON.stringify({
        ACTIVE_LLM_PROVIDER: 'azure',
        OPENAI_STREAMING_ENABLED: true,
        providerEndpoints: [
          {
            id: 'local-qwen',
            name: 'Local Qwen',
            kind: 'local',
            enabled: true,
            baseUrl: 'http://localhost:11434/v1',
            models: ['qwen3-coder'],
          },
        ],
        roleRoutes: [
          {
            role: 'implementation',
            primary: {
              providerEndpointId: 'local-qwen',
              model: 'qwen3-coder',
            },
            fallbacks: [],
          },
        ],
      })
    );
    const requestBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>);
      if (requestBodies.length === 1) {
        throw new Error('The socket connection was closed unexpectedly.');
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  toolCall: {
                    name: 'finalize_answer',
                    arguments: { message: 'ok' },
                  },
                }),
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const events: Array<{ type: string; data?: Record<string, unknown> }> = [];
    const decision = await callSupervisorLLM('system', 'user', {
      round: 2,
      schemaFirst: true,
      role: 'implementation',
      emitEvent: (event) => events.push({ type: event.type, data: event.data }),
    });

    expect(decision).toMatchObject({
      toolCall: {
        name: 'finalize_answer',
        arguments: { message: 'ok' },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBodies[0]).toMatchObject({
      stream: true,
      response_format: { type: 'json_schema' },
    });
    expect(requestBodies[1]).toMatchObject({
      stream: false,
      response_format: { type: 'json_object' },
    });
    expect(events.some((event) => event.type === 'model.retry_scheduled')).toBe(true);
    expect(events.some((event) => event.type === 'model.retry_started')).toBe(true);
  });

  it('uses the next role route fallback when the primary provider fails at runtime', async () => {
    delete process.env.OPENAI_API_KEY;
    fs.writeFileSync(
      process.env.NIGHTWORKERS_LLM_SETTINGS_PATH!,
      JSON.stringify({
        ACTIVE_LLM_PROVIDER: 'azure',
        OPENAI_STREAMING_ENABLED: false,
        providerEndpoints: [
          {
            id: 'local-primary',
            name: 'Local Primary',
            kind: 'local',
            enabled: true,
            baseUrl: 'http://localhost:11434/v1',
            models: ['qwen3-coder'],
          },
          {
            id: 'local-fallback',
            name: 'Local Fallback',
            kind: 'local',
            enabled: true,
            baseUrl: 'http://localhost:11435/v1',
            models: ['gemma-fallback'],
          },
        ],
        roleRoutes: [
          {
            role: 'implementation',
            primary: {
              providerEndpointId: 'local-primary',
              model: 'qwen3-coder',
            },
            fallbacks: [
              {
                providerEndpointId: 'local-fallback',
                model: 'gemma-fallback',
              },
            ],
          },
        ],
      })
    );
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      urls.push(url);
      if (url.startsWith('http://localhost:11434')) {
        throw new Error('The operation was aborted.');
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  toolCall: {
                    name: 'finalize_answer',
                    arguments: { message: 'fallback ok' },
                  },
                }),
              },
            },
          ],
          usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const events: Array<{ type: string; data?: Record<string, unknown> }> = [];
    const decision = await callSupervisorLLM('system', 'user', {
      round: 2,
      schemaFirst: true,
      role: 'implementation',
      emitEvent: (event) => events.push({ type: event.type, data: event.data }),
    });

    expect(decision).toMatchObject({
      toolCall: {
        name: 'finalize_answer',
        arguments: { message: 'fallback ok' },
      },
    });
    expect(urls).toEqual([
      'http://localhost:11434/v1/chat/completions',
      'http://localhost:11434/v1/chat/completions',
      'http://localhost:11435/v1/chat/completions',
    ]);
    expect(events.some((event) => event.type === 'model.route_fallback_scheduled')).toBe(true);
    expect(events.some((event) => event.type === 'model.route_fallback_started')).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'model.request_started' &&
          event.data?.providerEndpointId === 'local-fallback'
      )
    ).toBe(true);
  });

  it('does not synthesize non-Codex fallback when the native/API primary fails at runtime', async () => {
    delete process.env.OPENAI_API_KEY;
    fs.writeFileSync(
      process.env.NIGHTWORKERS_LLM_SETTINGS_PATH!,
      JSON.stringify({
        ACTIVE_LLM_PROVIDER: 'azure',
        OPENAI_STREAMING_ENABLED: false,
        providerEndpoints: [
          {
            id: 'local-primary',
            name: 'Local Primary',
            kind: 'local',
            enabled: true,
            baseUrl: 'http://localhost:11434/v1',
            models: ['qwen3-coder'],
          },
          {
            id: 'codex-fallback',
            name: 'Codex Fallback',
            kind: 'codex',
            enabled: true,
            models: ['gpt-5.4-mini'],
          },
          {
            id: 'local-synthesized',
            name: 'Local Synthesized',
            kind: 'local',
            enabled: true,
            baseUrl: 'http://localhost:11435/v1',
            models: ['gemma-fallback'],
          },
        ],
        roleRoutes: [
          {
            role: 'implementation',
            primary: {
              providerEndpointId: 'local-primary',
              model: 'qwen3-coder',
            },
            fallbacks: [],
          },
        ],
      })
    );
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      urls.push(url);
      if (url.startsWith('http://localhost:11434')) {
        throw new Error('The operation was aborted.');
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  toolCall: { name: 'finalize_answer', arguments: { message: 'unexpected' } },
                }),
              },
            },
          ],
          usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const events: Array<{ type: string; data?: Record<string, unknown> }> = [];
    await expect(
      callSupervisorLLM('system', 'user', {
        round: 2,
        schemaFirst: true,
        role: 'implementation',
        routePolicy: {
          disallowedProviderIds: ['codex'],
        },
        emitEvent: (event) => events.push({ type: event.type, data: event.data }),
      })
    ).rejects.toThrow();

    expect(urls).toEqual([
      'http://localhost:11434/v1/chat/completions',
      'http://localhost:11434/v1/chat/completions',
    ]);
    expect(
      events.some(
        (event) =>
          event.type === 'model.request_started' &&
          event.data?.providerEndpointId === 'local-synthesized'
      )
    ).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === 'model.request_started' &&
          event.data?.providerEndpointId === 'codex-fallback'
      )
    ).toBe(false);
  });

  it('retries transient OpenAI loading-model 503 responses once', async () => {
    process.env.ACTIVE_LLM_PROVIDER = 'openai';
    process.env.OPENAI_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_MODEL = 'gpt-test';
    process.env.OPENAI_STREAMING_ENABLED = 'false';

    const requestBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>);
      if (requestBodies.length === 1) {
        return new Response(
          JSON.stringify({
            error: {
              message: 'Loading model',
              type: 'unavailable_error',
              code: 503,
            },
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  toolCall: {
                    name: 'finalize_answer',
                    arguments: { message: 'ok after retry' },
                  },
                }),
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const events: Array<{ type: string; data?: Record<string, unknown> }> = [];
    const decision = await callSupervisorLLM('system', 'user', {
      round: 2,
      schemaFirst: true,
      role: 'implementation',
      emitEvent: (event) => events.push({ type: event.type, data: event.data }),
    });

    expect(decision).toMatchObject({
      toolCall: {
        name: 'finalize_answer',
        arguments: { message: 'ok after retry' },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBodies[0]).toMatchObject({
      stream: false,
      response_format: { type: 'json_schema' },
    });
    expect(requestBodies[1]).toMatchObject({
      stream: false,
      response_format: { type: 'json_schema' },
    });
    expect(
      events.some(
        (event) =>
          event.type === 'model.retry_scheduled' &&
          event.data?.reason === 'transient_unavailable' &&
          event.data?.status === 503
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'model.retry_started' && event.data?.reason === 'transient_unavailable'
      )
    ).toBe(true);
  });
});
