import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildNormalizedSupervisorLlmRequest,
  readStructuredLlmProviderSettings,
  resolveStructuredLlmModelCapability,
} from '../../../api/services/structured-llm';
import { migrateStructuredLlmEndpointIds } from '../../../api/services/structured-llm/endpoint-id-migration';
import { buildNormalizedSupervisorLlmRequestCandidates } from '../../../api/services/structured-llm/request';
import './setup';

describe('Supervisor LLM schema-first parsing routing', () => {
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

  it('ignores stale persisted role routes whose endpoint was removed', () => {
    fs.writeFileSync(
      process.env.NIGHTWORKERS_LLM_SETTINGS_PATH!,
      JSON.stringify({
        ACTIVE_LLM_PROVIDER: 'codex',
        CODEX_ENABLED: true,
        CODEX_MODEL: 'gpt-5.4-mini',
        providerEndpoints: [
          {
            id: 'codex-main',
            name: 'Codex Main',
            kind: 'codex',
            enabled: true,
            models: ['gpt-5.4-mini'],
          },
        ],
        roleRoutes: [
          {
            role: 'evaluation',
            primary: {
              providerEndpointId: 'deleted-evaluation-endpoint',
              model: 'gpt-5.4-mini',
            },
            fallbacks: [],
          },
        ],
      })
    );

    const settings = readStructuredLlmProviderSettings();
    const requests = buildNormalizedSupervisorLlmRequestCandidates({
      systemPrompt: 'system text',
      userPrompt: 'user text',
      label: 'project_evaluation',
      role: 'evaluation',
      settings,
    });

    expect(settings.roleRoutes?.some((route) => route.role === 'evaluation')).toBe(false);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      providerId: 'codex',
      role: 'evaluation',
      routeSource: null,
      modelOrDeployment: 'gpt-5.4-mini',
    });
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
      label: 'role_route_fallback_review',
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
});
