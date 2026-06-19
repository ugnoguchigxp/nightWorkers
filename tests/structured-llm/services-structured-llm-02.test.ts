import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  buildNormalizedSupervisorLlmRequest,
  callProviderToolTurn,
  callStructuredJsonLLM,
  callSupervisorLLM,
  readStructuredLlmProviderSettings,
  resolveStructuredLlmModelCapability,
} from '../../api/services/structured-llm';
import { migrateStructuredLlmEndpointIds } from '../../api/services/structured-llm/endpoint-id-migration';
import { buildNormalizedSupervisorLlmRequestCandidates } from '../../api/services/structured-llm/request';
import { installStructuredLlmEnvHooks } from './structured-llm-test-env';

describe('Supervisor LLM schema-first parsing', () => {
  installStructuredLlmEnvHooks();

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

  it('keeps Codex as a structured LLM provider when selected', () => {
    fs.writeFileSync(
      process.env.NIGHTWORKERS_LLM_SETTINGS_PATH!,
      JSON.stringify({
        ACTIVE_LLM_PROVIDER: 'codex',
        CODEX_MODEL: 'gpt-5.4-mini',
      })
    );

    const settings = readStructuredLlmProviderSettings();
    const request = buildNormalizedSupervisorLlmRequest({
      systemPrompt: 'system text',
      userPrompt: 'user text',
      label: 'example_schema',
      settings,
    });
    const directRequest = buildNormalizedSupervisorLlmRequest({
      systemPrompt: 'system text',
      userPrompt: 'user text',
      label: 'example_schema',
      settings: { ACTIVE_LLM_PROVIDER: 'codex' },
    });

    expect(settings.ACTIVE_LLM_PROVIDER).toBe('codex');
    expect(request.providerId).toBe('codex');
    expect(request.modelOrDeployment).toBe('gpt-5.4-mini');
    expect(directRequest.providerId).toBe('codex');
  });

  it('resolves role routing to provider endpoint and model when role is specified', () => {
    const request = buildNormalizedSupervisorLlmRequest({
      systemPrompt: 'system text',
      userPrompt: 'user text',
      label: 'specification_document',
      role: 'plan',
      settings: {
        ACTIVE_LLM_PROVIDER: 'azure',
        providerEndpoints: [
          {
            id: 'codex-main',
            name: 'Codex Main',
            kind: 'codex',
            enabled: true,
            models: ['gpt-5.5', 'gpt-5.4-mini'],
          },
        ],
        roleRoutes: [
          {
            role: 'plan',
            primary: {
              providerEndpointId: 'codex-main',
              model: 'gpt-5.5',
              thinkingDepth: 'very_high',
            },
            fallbacks: [],
          },
        ],
      },
    });

    expect(request).toMatchObject({
      providerId: 'codex',
      providerEndpointId: 'codex-main',
      role: 'plan',
      routeSource: 'primary',
      modelOrDeployment: 'gpt-5.5',
      thinkingDepth: 'very_high',
      diagnostics: {
        role: 'plan',
        providerEndpointId: 'codex-main',
        routeSource: 'primary',
        thinkingDepth: 'very_high',
      },
    });
  });

  it('rejects role routes whose configured model is not present on the endpoint', () => {
    const requests = buildNormalizedSupervisorLlmRequestCandidates({
      systemPrompt: 'system text',
      userPrompt: 'user text',
      label: 'native_api_runner',
      role: 'implementation',
      routePolicy: {
        disallowedProviderIds: ['codex'],
      },
      settings: {
        ACTIVE_LLM_PROVIDER: 'azure',
        providerEndpoints: [
          {
            id: 'local-qwen',
            name: 'Local Qwen',
            kind: 'local',
            enabled: true,
            baseUrl: 'http://localhost:11434/v1',
            models: ['qwen3-coder'],
          },
          {
            id: 'local-gemma',
            name: 'Local Gemma',
            kind: 'local',
            enabled: true,
            baseUrl: 'http://localhost:11435/v1',
            models: ['gemma-4-12b-it-4bit'],
          },
        ],
        roleRoutes: [
          {
            role: 'implementation',
            primary: {
              providerEndpointId: 'local-qwen',
              model: 'missing-model',
            },
            fallbacks: [],
          },
        ],
      },
    });

    expect(requests).toEqual([]);
  });

  it('does not fall back to ACTIVE_LLM_PROVIDER when a configured role route is invalid', () => {
    const requests = buildNormalizedSupervisorLlmRequestCandidates({
      systemPrompt: 'system text',
      userPrompt: 'user text',
      label: 'schema_first_review',
      role: 'review',
      settings: {
        ACTIVE_LLM_PROVIDER: 'azure',
        AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
        AZURE_OPENAI_DEPLOYMENT_NAME: 'gpt-5-mini',
        AZURE_OPENAI_API_VERSION: '2024-05-01-preview',
        providerEndpoints: [
          {
            id: 'local-review',
            name: 'Local Review',
            kind: 'local',
            enabled: true,
            baseUrl: 'http://localhost:11434/v1',
            models: ['qwen3-coder'],
          },
        ],
        roleRoutes: [
          {
            role: 'review',
            primary: {
              providerEndpointId: 'local-review',
              model: 'missing-review-model',
            },
            fallbacks: [],
          },
        ],
      },
    });

    expect(requests).toEqual([]);
  });

  it('migrates legacy endpoint ids and rewrites role routes without exposing secrets', () => {
    const result = migrateStructuredLlmEndpointIds({
      providerEndpoints: [
        {
          id: 'bedrock-default',
          name: 'Qwen 3.6 27B(1)',
          kind: 'local',
          baseUrl: 'http://192.168.0.61:50043/v1',
          models: ['Qwen 3.6 27B'],
        },
        {
          id: 'endpoint-1781587673584',
          name: 'Qwen 3.6 27B(2)',
          kind: 'local',
          baseUrl: 'http://192.168.0.61:50043/v1',
          models: ['Qwen 3.6 27B'],
        },
      ],
      roleRoutes: [
        {
          role: 'implementation',
          primary: {
            providerEndpointId: 'bedrock-default',
            model: 'Qwen 3.6 27B',
          },
          fallbacks: [
            {
              providerEndpointId: 'endpoint-1781587673584',
              model: 'Qwen 3.6 27B',
            },
          ],
        },
      ],
    });

    expect(result.changed).toBe(true);
    expect(result.mappings).toHaveLength(2);
    expect(result.settings.providerEndpoints?.map((endpoint) => endpoint.id)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^ep_[0-9a-f]{16}$/)])
    );
    expect(result.settings.roleRoutes?.[0]?.primary.providerEndpointId).toBe(
      result.mappings[0].newId
    );
    expect(result.settings.roleRoutes?.[0]?.fallbacks[0]?.providerEndpointId).toBe(
      result.mappings[1].newId
    );
    expect(JSON.stringify(result.mappings)).not.toContain('api');
  });

  it('does not synthesize enabled endpoints when a native/API route policy is explicit-only', () => {
    const requests = buildNormalizedSupervisorLlmRequestCandidates({
      systemPrompt: 'system text',
      userPrompt: 'user text',
      label: 'native_api_runner',
      role: 'plan',
      routePolicy: {
        disallowedProviderIds: ['codex'],
      },
      settings: {
        ACTIVE_LLM_PROVIDER: 'azure',
        providerEndpoints: [
          {
            id: 'codex-plan',
            name: 'Codex Plan',
            kind: 'codex',
            enabled: true,
            models: ['gpt-5.4-mini'],
          },
          {
            id: 'local-plan',
            name: 'Local Plan',
            kind: 'local',
            enabled: true,
            baseUrl: 'http://localhost:11434/v1',
            models: ['qwen3-coder'],
          },
        ],
        roleRoutes: [
          {
            role: 'plan',
            primary: {
              providerEndpointId: 'codex-plan',
              model: 'gpt-5.4-mini',
            },
            fallbacks: [],
          },
        ],
      },
    });

    expect(requests).toEqual([]);
  });

  it('dedupes native/API route candidates by endpoint, model, and provider', () => {
    const requests = buildNormalizedSupervisorLlmRequestCandidates({
      systemPrompt: 'system text',
      userPrompt: 'user text',
      label: 'native_api_runner',
      role: 'implementation',
      routePolicy: {
        disallowedProviderIds: ['codex'],
      },
      settings: {
        ACTIVE_LLM_PROVIDER: 'azure',
        providerEndpoints: [
          {
            id: 'local-gemma',
            name: 'Local Gemma',
            kind: 'local',
            enabled: true,
            baseUrl: 'http://localhost:11434/v1',
            models: ['gemma-4-12b-it-4bit'],
          },
          {
            id: 'azure-implementation',
            name: 'Azure Implementation',
            kind: 'azure',
            enabled: true,
            endpoint: 'https://example.openai.azure.com',
            apiVersion: '2024-05-01-preview',
            models: ['gpt-5-mini'],
          },
        ],
        roleRoutes: [
          {
            role: 'implementation',
            primary: {
              providerEndpointId: 'local-gemma',
              model: 'gemma-4-12b-it-4bit',
            },
            fallbacks: [
              {
                providerEndpointId: 'local-gemma',
                model: 'gemma-4-12b-it-4bit',
              },
              {
                providerEndpointId: 'azure-implementation',
                model: 'gpt-5-mini',
              },
            ],
          },
        ],
      },
    });

    expect(requests.map((request) => request.providerEndpointId)).toEqual([
      'local-gemma',
      'azure-implementation',
    ]);
  });

  it('skips unreachable native/API route candidates when readiness policy is active', () => {
    const requests = buildNormalizedSupervisorLlmRequestCandidates({
      systemPrompt: 'system text',
      userPrompt: 'user text',
      label: 'native_api_runner',
      role: 'implementation',
      routePolicy: {
        disallowedProviderIds: ['codex'],
        skipUnreachableEndpoints: true,
        endpointReadiness: {
          'local-qwen': {
            reachable: false,
            ok: false,
            checkedAt: '2026-06-18T00:00:00.000Z',
            message: 'connect ECONNREFUSED',
          },
        },
      },
      settings: {
        ACTIVE_LLM_PROVIDER: 'azure',
        providerEndpoints: [
          {
            id: 'local-qwen',
            name: 'Local Qwen',
            kind: 'local',
            enabled: true,
            baseUrl: 'http://localhost:11434/v1',
            models: ['qwen3-coder'],
          },
          {
            id: 'azure-implementation',
            name: 'Azure Implementation',
            kind: 'azure',
            enabled: true,
            endpoint: 'https://example.openai.azure.com',
            apiVersion: '2024-05-01-preview',
            models: ['gpt-5-mini'],
          },
        ],
        roleRoutes: [
          {
            role: 'implementation',
            primary: {
              providerEndpointId: 'local-qwen',
              model: 'qwen3-coder',
            },
            fallbacks: [
              {
                providerEndpointId: 'azure-implementation',
                model: 'gpt-5-mini',
              },
            ],
          },
        ],
      },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      providerId: 'azure-openai',
      providerEndpointId: 'azure-implementation',
      routeSource: 'fallback',
      modelOrDeployment: 'gpt-5-mini',
    });
  });

  it('does not fall back to the default provider when native/API readiness removes all routes', () => {
    const requests = buildNormalizedSupervisorLlmRequestCandidates({
      systemPrompt: 'system text',
      userPrompt: 'user text',
      label: 'native_api_runner',
      role: 'implementation',
      routePolicy: {
        disallowedProviderIds: ['codex'],
        skipUnreachableEndpoints: true,
        endpointReadiness: {
          'local-qwen': {
            reachable: false,
            ok: false,
            checkedAt: '2026-06-18T00:00:00.000Z',
            message: 'connect ECONNREFUSED',
          },
        },
      },
      settings: {
        ACTIVE_LLM_PROVIDER: 'codex',
        CODEX_MODEL: 'gpt-5.4-mini',
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
      },
    });

    expect(requests).toEqual([]);
  });

  it('uses the role route fallback when the primary endpoint is disabled', () => {
    const request = buildNormalizedSupervisorLlmRequest({
      systemPrompt: 'system text',
      userPrompt: 'user text',
      label: 'specification_document_review',
      role: 'review',
      settings: {
        ACTIVE_LLM_PROVIDER: 'azure',
        providerEndpoints: [
          {
            id: 'local-qwen',
            name: 'Local Qwen',
            kind: 'local',
            enabled: false,
            baseUrl: 'http://localhost:11434/v1',
            models: ['qwen3-coder'],
          },
          {
            id: 'codex-disabled',
            name: 'Codex Disabled',
            kind: 'codex',
            enabled: false,
            models: ['gpt-5.4-mini'],
          },
          {
            id: 'azure-review',
            name: 'Azure Review',
            kind: 'azure',
            enabled: true,
            endpoint: 'https://example.openai.azure.com',
            apiVersion: '2024-05-01-preview',
            models: ['gpt-5.5'],
          },
        ],
        roleRoutes: [
          {
            role: 'review',
            primary: {
              providerEndpointId: 'local-qwen',
              model: 'qwen3-coder',
            },
            fallbacks: [
              {
                providerEndpointId: 'codex-disabled',
                model: 'gpt-5.4-mini',
              },
              {
                providerEndpointId: 'azure-review',
                model: 'gpt-5.5',
              },
            ],
          },
        ],
      },
    });

    expect(request).toMatchObject({
      providerId: 'azure-openai',
      providerEndpointId: 'azure-review',
      role: 'review',
      routeSource: 'fallback',
      modelOrDeployment: 'gpt-5.5',
      endpoint: 'https://example.openai.azure.com',
      apiVersion: '2024-05-01-preview',
    });
  });

  it('uses a valid explicit route override before role primary and fallbacks', () => {
    const request = buildNormalizedSupervisorLlmRequest({
      systemPrompt: 'system text',
      userPrompt: 'user text',
      label: 'supervisor',
      role: 'implementation',
      routeOverride: {
        providerEndpointId: 'local-qwen',
        model: 'qwen3-coder',
        thinkingDepth: 'medium',
      },
      settings: {
        ACTIVE_LLM_PROVIDER: 'azure',
        providerEndpoints: [
          {
            id: 'local-qwen',
            name: 'Local Qwen',
            kind: 'local',
            enabled: true,
            baseUrl: 'http://localhost:11434/v1',
            models: ['qwen3-coder'],
          },
          {
            id: 'azure-implementation',
            name: 'Azure Implementation',
            kind: 'azure',
            enabled: true,
            endpoint: 'https://example.openai.azure.com',
            apiVersion: '2024-05-01-preview',
            models: ['gpt-5-mini'],
          },
        ],
        roleRoutes: [
          {
            role: 'implementation',
            primary: {
              providerEndpointId: 'azure-implementation',
              model: 'gpt-5-mini',
            },
            fallbacks: [],
          },
        ],
      },
    });

    expect(request).toMatchObject({
      providerId: 'openai',
      providerEndpointId: 'local-qwen',
      role: 'implementation',
      routeSource: 'override',
      modelOrDeployment: 'qwen3-coder',
      endpoint: 'http://localhost:11434/v1',
      thinkingDepth: 'medium',
    });
  });

  it('ignores an override pointing at a disabled endpoint and uses the role route', () => {
    const request = buildNormalizedSupervisorLlmRequest({
      systemPrompt: 'system text',
      userPrompt: 'user text',
      label: 'supervisor',
      role: 'implementation',
      routeOverride: {
        providerEndpointId: 'disabled-local',
        model: 'qwen3-coder',
      },
      settings: {
        ACTIVE_LLM_PROVIDER: 'azure',
        providerEndpoints: [
          {
            id: 'disabled-local',
            name: 'Disabled Local',
            kind: 'local',
            enabled: false,
            baseUrl: 'http://localhost:11434/v1',
            models: ['qwen3-coder'],
          },
          {
            id: 'azure-implementation',
            name: 'Azure Implementation',
            kind: 'azure',
            enabled: true,
            endpoint: 'https://example.openai.azure.com',
            apiVersion: '2024-05-01-preview',
            models: ['gpt-5-mini'],
          },
        ],
        roleRoutes: [
          {
            role: 'implementation',
            primary: {
              providerEndpointId: 'azure-implementation',
              model: 'gpt-5-mini',
            },
            fallbacks: [],
          },
        ],
      },
    });

    expect(request).toMatchObject({
      providerId: 'azure-openai',
      providerEndpointId: 'azure-implementation',
      role: 'implementation',
      routeSource: 'primary',
      modelOrDeployment: 'gpt-5-mini',
    });
  });

  it('resolves configured model capability metadata for routed local models', () => {
    const capability = resolveStructuredLlmModelCapability({
      role: 'implementation',
      settings: {
        ACTIVE_LLM_PROVIDER: 'azure',
        providerEndpoints: [
          {
            id: 'local-qwen-large',
            name: 'Local Qwen Large',
            kind: 'local',
            enabled: true,
            baseUrl: 'http://localhost:11434/v1',
            models: ['qwen3-coder-176k'],
            modelCapabilities: {
              'qwen3-coder-176k': {
                contextWindowTokens: 180_000,
                safePromptBudgetTokens: 176_000,
                reservedOutputTokens: 4_000,
                supportsProviderSideCompression: true,
                compressionProfile: 'balanced',
              },
            },
          },
        ],
        roleRoutes: [
          {
            role: 'implementation',
            primary: {
              providerEndpointId: 'local-qwen-large',
              model: 'qwen3-coder-176k',
            },
            fallbacks: [],
          },
        ],
      },
    });

    expect(capability).toMatchObject({
      providerEndpointId: 'local-qwen-large',
      model: 'qwen3-coder-176k',
      contextWindowTokens: 180_000,
      safePromptBudgetTokens: 176_000,
      reservedOutputTokens: 4_000,
      supportsProviderSideCompression: true,
      compressionProfile: 'balanced',
    });
  });

  it('defaults local provider capability to the local-llm context budget when unset', () => {
    const capability = resolveStructuredLlmModelCapability({
      role: 'implementation',
      settings: {
        ACTIVE_LLM_PROVIDER: 'azure',
        providerEndpoints: [
          {
            id: 'local-qwen-default',
            name: 'Local Qwen Default',
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
              providerEndpointId: 'local-qwen-default',
              model: 'qwen3-coder',
            },
            fallbacks: [],
          },
        ],
      },
    });

    expect(capability).toMatchObject({
      providerEndpointId: 'local-qwen-default',
      model: 'qwen3-coder',
      contextWindowTokens: 176_000,
      safePromptBudgetTokens: 176_000,
      reservedOutputTokens: 1024,
      supportsProviderSideCompression: true,
      compressionProfile: 'none',
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

  it('allows local OpenAI-compatible endpoints without an API key', async () => {
    delete process.env.OPENAI_API_KEY;
    fs.writeFileSync(
      process.env.NIGHTWORKERS_LLM_SETTINGS_PATH!,
      JSON.stringify({
        ACTIVE_LLM_PROVIDER: 'azure',
        OPENAI_STREAMING_ENABLED: false,
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
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('http://localhost:11434/v1/chat/completions');
      expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const rawOutput = await callStructuredJsonLLM('system', 'user', {
      schemaName: 'example_schema',
      schema: { type: 'object' },
      role: 'implementation',
    });

    expect(JSON.parse(rawOutput)).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('omits temperature for Azure structured calls and uses the model default', async () => {
    fs.writeFileSync(
      process.env.NIGHTWORKERS_LLM_SETTINGS_PATH!,
      JSON.stringify({
        ACTIVE_LLM_PROVIDER: 'azure',
        providerEndpoints: [
          {
            id: 'azure-implementation',
            name: 'Azure Implementation',
            kind: 'azure',
            enabled: true,
            apiKey: 'test-azure-key',
            endpoint: 'https://example.openai.azure.com/',
            apiVersion: '2025-04-01-preview',
            models: ['gpt-5-4-mini'],
          },
        ],
        roleRoutes: [
          {
            role: 'implementation',
            primary: {
              providerEndpointId: 'azure-implementation',
              model: 'gpt-5-4-mini',
              thinkingDepth: 'low',
            },
            fallbacks: [],
          },
        ],
      })
    );
    const requestBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(
        'https://example.openai.azure.com/openai/deployments/gpt-5-4-mini/chat/completions?api-version=2025-04-01-preview'
      );
      requestBodies.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const rawOutput = await callStructuredJsonLLM('system', 'user', {
      schemaName: 'example_schema',
      schema: { type: 'object' },
      role: 'implementation',
    });

    expect(JSON.parse(rawOutput)).toEqual({ ok: true });
    expect(requestBodies[0]).not.toHaveProperty('temperature');
    expect(requestBodies[0]).toMatchObject({
      reasoning_effort: 'low',
      response_format: { type: 'json_schema' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('supports Azure provider-native tool turns on the native/API lane', async () => {
    const settings = {
      ACTIVE_LLM_PROVIDER: 'azure',
      providerEndpoints: [
        {
          id: 'azure-implementation',
          name: 'Azure Implementation',
          kind: 'azure',
          enabled: true,
          apiKey: 'test-azure-key',
          endpoint: 'https://example.openai.azure.com/',
          apiVersion: '2025-04-01-preview',
          models: ['gpt-5-4-mini'],
        },
      ],
      roleRoutes: [
        {
          role: 'implementation',
          primary: {
            providerEndpointId: 'azure-implementation',
            model: 'gpt-5-4-mini',
            thinkingDepth: 'low',
          },
          fallbacks: [],
        },
      ],
    };
    fs.writeFileSync(process.env.NIGHTWORKERS_LLM_SETTINGS_PATH!, JSON.stringify(settings));
    const requestBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(
        'https://example.openai.azure.com/openai/deployments/gpt-5-4-mini/chat/completions?api-version=2025-04-01-preview'
      );
      expect((init?.headers as Record<string, string>)['api-key']).toBe('test-azure-key');
      requestBodies.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  {
                    id: 'call-final',
                    type: 'function',
                    function: {
                      name: 'finalize_answer',
                      arguments: JSON.stringify({
                        finalReport: 'done through azure tools',
                      }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const normalizedRequest = buildNormalizedSupervisorLlmRequest({
      systemPrompt: 'system text',
      userPrompt: 'user text',
      label: 'supervisor',
      role: 'implementation',
      settings,
    });
    const providerDebug: Array<Record<string, unknown>> = [];

    const result = await callProviderToolTurn({
      provider: 'azure',
      systemPrompt: 'system text',
      userPrompt: 'user text',
      messages: [
        { role: 'system', content: 'system text' },
        { role: 'user', content: 'user text' },
      ],
      tools: [
        {
          name: 'finalize_answer',
          description: 'Finish the run',
          inputSchema: {
            type: 'object',
            properties: { finalReport: { type: 'string' } },
            required: ['finalReport'],
          },
        },
      ],
      options: {
        label: 'supervisor',
        role: 'implementation',
        normalizedRequest,
        toolChoice: 'required',
      },
      signal: AbortSignal.timeout(1000),
      setProviderDebug: (value) => providerDebug.push(value),
    });

    expect(result).toMatchObject({
      type: 'supported',
      model: 'gpt-5-4-mini',
      toolCalls: [
        {
          id: 'call-final',
          name: 'finalize_answer',
          arguments: { finalReport: 'done through azure tools' },
        },
      ],
      usage: {
        inputTokens: 11,
        outputTokens: 7,
        totalTokens: 18,
        mode: 'measured',
      },
    });
    expect(providerDebug[0]).toMatchObject({
      provider: 'azure-openai',
      providerEndpointId: 'azure-implementation',
      mode: 'provider_native_tools',
      status: 200,
      toolCallCount: 1,
    });
    expect(requestBodies[0]).toMatchObject({
      messages: [
        { role: 'system', content: 'system text' },
        { role: 'user', content: 'user text' },
      ],
      tool_choice: 'required',
      reasoning_effort: 'low',
    });
    expect(requestBodies[0]).not.toHaveProperty('temperature');
    expect(requestBodies[0].tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'finalize_answer',
          description: 'Finish the run',
          parameters: {
            type: 'object',
            properties: { finalReport: { type: 'string' } },
            required: ['finalReport'],
          },
        },
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

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
        JSON.stringify({
          choices: [{ message: { content: 'plain text response' } }],
        }),
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
                  {
                    type: 'function',
                    function: { name: 'write_file', arguments: '{}' },
                  },
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
                          {
                            type: 'function',
                            function: { name: 'run_command', arguments: '{}' },
                          },
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
