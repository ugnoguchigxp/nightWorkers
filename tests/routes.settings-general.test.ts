import { OpenAPIHono } from '@hono/zod-openapi';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../api/lib/types';
import { errorHandler } from '../api/middleware/error-handler';

const generalSettingsMocks = vi.hoisted(() => ({
  readGeneralSettings: vi.fn(),
  writeGeneralSettings: vi.fn(),
  readFxRateCache: vi.fn(),
  refreshEcbFxRates: vi.fn(),
}));

vi.mock('../api/services/settings/general-settings', () => ({
  readGeneralSettings: generalSettingsMocks.readGeneralSettings,
  writeGeneralSettings: generalSettingsMocks.writeGeneralSettings,
  readFxRateCache: generalSettingsMocks.readFxRateCache,
  refreshEcbFxRates: generalSettingsMocks.refreshEcbFxRates,
  validateTimezone: () => true,
  SUPPORTED_LANGUAGES: ['ja', 'en'],
  SUPPORTED_CURRENCIES: ['JPY', 'USD', 'EUR'],
}));

const pricingMocks = vi.hoisted(() => ({
  listPricingRows: vi.fn(),
  upsertPricingRow: vi.fn(),
  seedCodexPricingRows: vi.fn(),
}));

vi.mock('../api/services/pricing', () => ({
  listPricingRows: pricingMocks.listPricingRows,
  upsertPricingRow: pricingMocks.upsertPricingRow,
  seedCodexPricingRows: pricingMocks.seedCodexPricingRows,
}));

const llmMocks = vi.hoisted(() => ({
  callSupervisorLLM: vi.fn(),
}));

vi.mock('../api/services/structured-llm', () => ({
  callSupervisorLLM: llmMocks.callSupervisorLLM,
}));

const runtimeSettingsMocks = vi.hoisted(() => ({
  getCurrentSettings: vi.fn().mockReturnValue({
    ACTIVE_LLM_PROVIDER: 'openai',
    OPENAI_API_KEY: 'sk-mock',
  }),
  writeRuntimeSettings: vi.fn(),
  applySettingsToProcessEnv: vi.fn(),
  maskLlmSettings: vi.fn().mockImplementation((s) => s),
  mergeMaskedSecrets: vi.fn().mockImplementation((input) => input),
}));

vi.mock('../api/routes/settings-runtime', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getCurrentSettings: runtimeSettingsMocks.getCurrentSettings,
    writeRuntimeSettings: runtimeSettingsMocks.writeRuntimeSettings,
    applySettingsToProcessEnv: runtimeSettingsMocks.applySettingsToProcessEnv,
    maskLlmSettings: runtimeSettingsMocks.maskLlmSettings,
    mergeMaskedSecrets: runtimeSettingsMocks.mergeMaskedSecrets,
    providerModelOptions: {
      openai: ['gpt-4o', 'gpt-4o-mini'],
    },
  };
});

import { settingsRouter } from '../api/routes/settings';

describe('general and LLM settings routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/settings/llm gets masked settings', async () => {
    const app = new OpenAPIHono<AppEnv>();
    app.onError(errorHandler);
    app.route('/api/settings', settingsRouter);

    const res = await app.request('/api/settings/llm', { method: 'GET' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ACTIVE_LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-mock',
    });
  });

  it('POST /api/settings/llm saves settings', async () => {
    const app = new OpenAPIHono<AppEnv>();
    app.onError(errorHandler);
    app.route('/api/settings', settingsRouter);

    const res = await app.request('/api/settings/llm', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ACTIVE_LLM_PROVIDER: 'openai',
        OPENAI_ENABLED: true,
        AZURE_OPENAI_API_KEY: '',
        AZURE_OPENAI_ENABLED: false,
        AZURE_OPENAI_ENDPOINT: '',
        AZURE_OPENAI_DEPLOYMENT_NAME: '',
        AZURE_OPENAI_API_VERSION: '',
        AWS_BEDROCK_ENABLED: false,
        AWS_ACCESS_KEY_ID: '',
        AWS_SECRET_ACCESS_KEY: '',
        AWS_REGION: '',
        AWS_BEDROCK_MODEL: '',
        OPENAI_API_KEY: 'new-key',
        OPENAI_BASE_URL: '',
        OPENAI_MODEL: '',
        CODEX_ENABLED: false,
        CODEX_ACCESS_TOKEN: '',
        CODEX_MODEL: '',
        IMPLEMENTATION_RUNTIME_LANE: '',
        SESSION_QUEUE_MAX_CONCURRENCY: 2,
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ success: true });
    expect(runtimeSettingsMocks.writeRuntimeSettings).toHaveBeenCalled();
    expect(runtimeSettingsMocks.applySettingsToProcessEnv).toHaveBeenCalled();
  });

  it('GET /api/settings/llm/models returns provider options', async () => {
    const app = new OpenAPIHono<AppEnv>();
    app.onError(errorHandler);
    app.route('/api/settings', settingsRouter);

    const res = await app.request('/api/settings/llm/models', { method: 'GET' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      activeProvider: 'openai',
      options: [
        { value: 'gpt-4o', label: 'gpt-4o' },
        { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
      ],
    });
  });

  it('GET /api/settings/general gets general settings', async () => {
    generalSettingsMocks.readGeneralSettings.mockReturnValue({
      timezone: 'UTC',
      language: 'en',
    });

    const app = new OpenAPIHono<AppEnv>();
    app.onError(errorHandler);
    app.route('/api/settings', settingsRouter);

    const res = await app.request('/api/settings/general', { method: 'GET' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ timezone: 'UTC', language: 'en' });
  });

  it('POST /api/settings/general saves general settings', async () => {
    generalSettingsMocks.writeGeneralSettings.mockReturnValue({
      timezone: 'Asia/Tokyo',
      language: 'ja',
      currency: 'JPY',
      fx: {
        source: 'ecb',
        autoRefresh: true,
        lastRefreshedAt: null,
      },
    });

    const app = new OpenAPIHono<AppEnv>();
    app.onError(errorHandler);
    app.route('/api/settings', settingsRouter);

    const res = await app.request('/api/settings/general', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        timezone: 'Asia/Tokyo',
        language: 'ja',
        currency: 'JPY',
        fx: {
          source: 'ecb',
          autoRefresh: true,
          lastRefreshedAt: null,
        },
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      timezone: 'Asia/Tokyo',
      language: 'ja',
      currency: 'JPY',
      fx: {
        source: 'ecb',
        autoRefresh: true,
        lastRefreshedAt: null,
      },
    });
  });

  it('GET /api/settings/fx gets cache', async () => {
    generalSettingsMocks.readFxRateCache.mockReturnValue({ EUR: 1, USD: 1.1 });

    const app = new OpenAPIHono<AppEnv>();
    app.onError(errorHandler);
    app.route('/api/settings', settingsRouter);

    const res = await app.request('/api/settings/fx', { method: 'GET' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ EUR: 1, USD: 1.1 });
  });

  it('POST /api/settings/fx/refresh refreshes rates successfully', async () => {
    generalSettingsMocks.refreshEcbFxRates.mockResolvedValue({ refreshed: true });

    const app = new OpenAPIHono<AppEnv>();
    app.onError(errorHandler);
    app.route('/api/settings', settingsRouter);

    const res = await app.request('/api/settings/fx/refresh', { method: 'POST' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ refreshed: true });
  });

  it('POST /api/settings/fx/refresh handles ECB errors', async () => {
    generalSettingsMocks.refreshEcbFxRates.mockRejectedValue(new Error('ECB Down'));

    const app = new OpenAPIHono<AppEnv>();
    app.onError(errorHandler);
    app.route('/api/settings', settingsRouter);

    const res = await app.request('/api/settings/fx/refresh', { method: 'POST' });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: 'ECB Down' });
  });

  it('GET /api/settings/pricing lists pricing rows', async () => {
    pricingMocks.listPricingRows.mockResolvedValue([{ model: 'gpt-4o' }]);

    const app = new OpenAPIHono<AppEnv>();
    app.onError(errorHandler);
    app.route('/api/settings', settingsRouter);

    const res = await app.request('/api/settings/pricing', { method: 'GET' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([{ model: 'gpt-4o' }]);
  });

  it('POST /api/settings/pricing saves pricing row', async () => {
    pricingMocks.upsertPricingRow.mockResolvedValue({ model: 'gpt-4o', saved: true });

    const app = new OpenAPIHono<AppEnv>();
    app.onError(errorHandler);
    app.route('/api/settings', settingsRouter);

    const res = await app.request('/api/settings/pricing', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ provider: 'openai', model: 'gpt-4o' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ model: 'gpt-4o', saved: true });
  });

  it('POST /api/settings/pricing/seed-codex seeds rows', async () => {
    pricingMocks.seedCodexPricingRows.mockResolvedValue({ seeded: 5 });

    const app = new OpenAPIHono<AppEnv>();
    app.onError(errorHandler);
    app.route('/api/settings', settingsRouter);

    const res = await app.request('/api/settings/pricing/seed-codex', { method: 'POST' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ seeded: 5 });
  });

  it('POST /api/settings/llm/smoke does smoke check (success)', async () => {
    llmMocks.callSupervisorLLM.mockResolvedValue('success message');

    const app = new OpenAPIHono<AppEnv>();
    app.onError(errorHandler);
    app.route('/api/settings', settingsRouter);

    const res = await app.request('/api/settings/llm/smoke', { method: 'POST' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ok: true,
      provider: 'openai',
      message: 'smoke ok',
    });
  });

  it('POST /api/settings/llm/smoke does smoke check (failure)', async () => {
    llmMocks.callSupervisorLLM.mockRejectedValue(new Error('API failure'));

    const app = new OpenAPIHono<AppEnv>();
    app.onError(errorHandler);
    app.route('/api/settings', settingsRouter);

    const res = await app.request('/api/settings/llm/smoke', { method: 'POST' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ok: false,
      provider: 'openai',
      message: 'API failure',
    });
  });
});
