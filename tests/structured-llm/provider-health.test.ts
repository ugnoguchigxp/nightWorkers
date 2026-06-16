import { describe, expect, it, vi } from 'vitest';
import {
  buildProviderHealthUrl,
  checkStructuredLlmProviderHealth,
} from '../../api/services/structured-llm/provider-health';
import type { StructuredLlmProviderEndpoint } from '../../api/services/structured-llm/settings';

describe('structured LLM provider health', () => {
  it('builds local /health URL from an OpenAI-compatible /v1 base URL', () => {
    const result = buildProviderHealthUrl({
      kind: 'local',
      baseUrl: 'http://localhost:11434/v1',
    });

    expect(result).toEqual({ ok: true, url: 'http://localhost:11434/health' });
  });

  it('builds Azure /health URL from the configured endpoint', () => {
    const result = buildProviderHealthUrl({
      kind: 'azure',
      endpoint: 'https://example.openai.azure.com/',
    });

    expect(result).toEqual({ ok: true, url: 'https://example.openai.azure.com/health' });
  });

  it('reports HTTP response status separately from network reachability', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as Response);
    const endpoint: StructuredLlmProviderEndpoint = {
      id: 'local-qwen',
      name: 'Local Qwen',
      kind: 'local',
      enabled: true,
      baseUrl: 'http://localhost:11434/v1',
      models: ['qwen3-coder'],
    };

    const result = await checkStructuredLlmProviderHealth(endpoint, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:11434/health',
      expect.objectContaining({ method: 'GET' })
    );
    expect(result).toMatchObject({
      ok: false,
      reachable: true,
      providerEndpointId: 'local-qwen',
      providerKind: 'local',
      url: 'http://localhost:11434/health',
      status: 404,
      message: 'HTTP 404: Not Found',
    });
  });

  it('returns unreachable when the health request cannot connect', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));
    const endpoint: StructuredLlmProviderEndpoint = {
      id: 'local-qwen',
      name: 'Local Qwen',
      kind: 'local',
      enabled: true,
      baseUrl: 'http://localhost:11434/v1',
      models: ['qwen3-coder'],
    };

    const result = await checkStructuredLlmProviderHealth(endpoint, { fetchImpl });

    expect(result).toMatchObject({
      ok: false,
      reachable: false,
      providerEndpointId: 'local-qwen',
      status: null,
      message: 'connect ECONNREFUSED',
    });
  });
});
