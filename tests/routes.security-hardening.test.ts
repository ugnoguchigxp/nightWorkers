import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

function isolatedSettingsPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-settings-'));
  return path.join(dir, 'llm-settings.json');
}

async function importSettingsRoute() {
  vi.resetModules();
  vi.stubEnv('NIGHTWORKERS_LLM_SETTINGS_PATH', isolatedSettingsPath());
  return import('../api/routes/settings');
}

async function importSettingsRuntimeWithPath(settingsPath: string) {
  vi.resetModules();
  vi.stubEnv('NIGHTWORKERS_LLM_SETTINGS_PATH', settingsPath);
  return import('../api/routes/settings-runtime');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('LLM settings secret hardening', () => {
  it('persists endpoint id migration when an existing settings file is loaded', async () => {
    const settingsPath = isolatedSettingsPath();
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        ACTIVE_LLM_PROVIDER: 'openai',
        OPENAI_ENABLED: true,
        OPENAI_API_KEY: 'existing-openai-secret',
        providerEndpoints: [
          {
            id: 'bedrock-default',
            name: 'Qwen Local',
            kind: 'local',
            enabled: true,
            apiKey: '',
            baseUrl: 'http://localhost:11434/v1',
            endpoint: '',
            apiVersion: '',
            region: '',
            models: ['qwen3-coder'],
            modelDisplayNames: {},
          },
        ],
        roleRoutes: [
          {
            role: 'implementation',
            primary: {
              providerEndpointId: 'bedrock-default',
              model: 'qwen3-coder',
            },
            fallbacks: [],
          },
        ],
      })
    );
    const { getCurrentSettings } = await importSettingsRuntimeWithPath(settingsPath);

    const settings = getCurrentSettings();
    const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as {
      OPENAI_API_KEY?: string;
      providerEndpoints: Array<{ id: string }>;
      roleRoutes: Array<{ primary: { providerEndpointId: string } }>;
    };

    const migratedRouteEndpointId = persisted.roleRoutes[0]?.primary.providerEndpointId;
    expect(migratedRouteEndpointId).toMatch(/^ep_[0-9a-f]{16}$/);
    expect(
      persisted.providerEndpoints.some((endpoint) => endpoint.id === migratedRouteEndpointId)
    ).toBe(true);
    expect(
      settings.providerEndpoints.some((endpoint) => endpoint.id === migratedRouteEndpointId)
    ).toBe(true);
    expect(persisted.OPENAI_API_KEY).toBe('existing-openai-secret');
  });

  it('does not append migrated legacy default endpoints on repeated settings reads', async () => {
    const settingsPath = isolatedSettingsPath();
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        ACTIVE_LLM_PROVIDER: 'codex',
        CODEX_ENABLED: true,
        CODEX_MODEL: 'gpt-5.4-mini',
        providerEndpoints: [
          {
            id: 'codex-default',
            name: 'Codex SDK',
            kind: 'codex',
            enabled: true,
            apiKey: '',
            baseUrl: '',
            endpoint: '',
            apiVersion: '',
            region: '',
            models: [
              'gpt-5.4-mini',
              'gpt-5.5',
              'gpt-5.4',
              'gpt-5.3-codex-spark',
              'codex-auto-review',
              'gpt-5-mini',
            ],
            modelDisplayNames: {},
          },
        ],
        roleRoutes: [
          {
            role: 'implementation',
            primary: {
              providerEndpointId: 'codex-default',
              model: 'gpt-5.4-mini',
            },
            fallbacks: [],
          },
        ],
      })
    );
    const { getCurrentSettings } = await importSettingsRuntimeWithPath(settingsPath);

    const first = getCurrentSettings();
    const firstPersisted = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as {
      providerEndpoints: Array<{
        id: string;
        name: string;
        kind: string;
        models: string[];
      }>;
    };
    const second = getCurrentSettings();
    const secondPersisted = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as {
      providerEndpoints: Array<{
        id: string;
        name: string;
        kind: string;
        models: string[];
      }>;
    };

    const endpointKey = (endpoint: { name: string; kind: string }) =>
      `${endpoint.kind}\u0000${endpoint.name}`;

    expect(second.providerEndpoints).toHaveLength(first.providerEndpoints.length);
    expect(secondPersisted.providerEndpoints).toHaveLength(firstPersisted.providerEndpoints.length);
    expect(new Set(secondPersisted.providerEndpoints.map(endpointKey)).size).toBe(
      secondPersisted.providerEndpoints.length
    );
  });

  it('heals persisted role routes that point at removed endpoints', async () => {
    const settingsPath = isolatedSettingsPath();
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        ACTIVE_LLM_PROVIDER: 'codex',
        CODEX_ENABLED: true,
        CODEX_MODEL: 'gpt-5.4-mini',
        providerEndpoints: [
          {
            id: 'codex-main',
            name: 'Codex SDK',
            kind: 'codex',
            enabled: true,
            apiKey: '',
            baseUrl: '',
            endpoint: '',
            apiVersion: '',
            region: '',
            models: ['gpt-5.4-mini'],
            modelDisplayNames: {},
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
    const { getCurrentSettings } = await importSettingsRuntimeWithPath(settingsPath);

    const settings = getCurrentSettings();
    const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as {
      roleRoutes: Array<{ role: string; primary: { providerEndpointId: string; model: string } }>;
    };
    const evaluationRoute = settings.roleRoutes.find((route) => route.role === 'evaluation');
    const persistedEvaluationRoute = persisted.roleRoutes.find(
      (route) => route.role === 'evaluation'
    );

    expect(evaluationRoute?.primary).toEqual({
      providerEndpointId: 'codex-main',
      model: 'gpt-5.4-mini',
      thinkingDepth: '',
    });
    expect(persistedEvaluationRoute?.primary.providerEndpointId).toBe('codex-main');
  });

  it('masks configured secrets before returning settings to clients', async () => {
    const { maskLlmSettings } = await importSettingsRoute();

    const masked = maskLlmSettings({
      ACTIVE_LLM_PROVIDER: 'openai',
      OPENAI_ENABLED: true,
      AZURE_OPENAI_ENABLED: true,
      AZURE_OPENAI_API_KEY: 'azure-secret',
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com/',
      AZURE_OPENAI_DEPLOYMENT_NAME: 'gpt-5-mini',
      AZURE_OPENAI_API_VERSION: '2024-05-01-preview',
      AWS_BEDROCK_ENABLED: true,
      AWS_ACCESS_KEY_ID: 'aws-key-id',
      AWS_SECRET_ACCESS_KEY: 'aws-secret',
      AWS_REGION: 'us-east-1',
      AWS_BEDROCK_MODEL: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      OPENAI_API_KEY: 'openai-secret',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      OPENAI_MODEL: 'gpt-5-mini',
      CODEX_ENABLED: true,
      CODEX_ACCESS_TOKEN: 'codex-secret',
      CODEX_MODEL: 'gpt-5.3-codex',
      SESSION_QUEUE_MAX_CONCURRENCY: 2,
    });

    expect(masked.AZURE_OPENAI_API_KEY).toBe('********');
    expect(masked.AWS_SECRET_ACCESS_KEY).toBe('********');
    expect(masked.OPENAI_API_KEY).toBe('********');
    expect(masked.CODEX_ACCESS_TOKEN).toBe('********');
    expect(masked.AWS_ACCESS_KEY_ID).toBe('aws-key-id');
  });

  it('preserves existing secrets when clients save masked values', async () => {
    const { mergeMaskedSecrets } = await importSettingsRoute();
    const current = {
      ACTIVE_LLM_PROVIDER: 'openai',
      OPENAI_ENABLED: true,
      AZURE_OPENAI_ENABLED: true,
      AZURE_OPENAI_API_KEY: 'existing-azure-secret',
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com/',
      AZURE_OPENAI_DEPLOYMENT_NAME: 'gpt-5-mini',
      AZURE_OPENAI_API_VERSION: '2024-05-01-preview',
      AWS_BEDROCK_ENABLED: true,
      AWS_ACCESS_KEY_ID: 'aws-key-id',
      AWS_SECRET_ACCESS_KEY: 'existing-aws-secret',
      AWS_REGION: 'us-east-1',
      AWS_BEDROCK_MODEL: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      OPENAI_API_KEY: 'existing-openai-secret',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      OPENAI_MODEL: 'gpt-5-mini',
      CODEX_ENABLED: true,
      CODEX_ACCESS_TOKEN: 'existing-codex-secret',
      CODEX_MODEL: 'gpt-5.3-codex',
      SESSION_QUEUE_MAX_CONCURRENCY: 2,
    };

    const merged = mergeMaskedSecrets(
      {
        ...current,
        OPENAI_MODEL: 'gpt-5.4-mini',
        AZURE_OPENAI_API_KEY: '********',
        AWS_SECRET_ACCESS_KEY: '********',
        OPENAI_API_KEY: 'new-openai-secret',
        CODEX_ACCESS_TOKEN: '********',
      },
      current
    );

    expect(merged.AZURE_OPENAI_API_KEY).toBe('existing-azure-secret');
    expect(merged.AWS_SECRET_ACCESS_KEY).toBe('existing-aws-secret');
    expect(merged.OPENAI_API_KEY).toBe('new-openai-secret');
    expect(merged.CODEX_ACCESS_TOKEN).toBe('existing-codex-secret');
    expect(merged.OPENAI_MODEL).toBe('gpt-5.4-mini');
  });
});

describe('API auth boundary', () => {
  async function importConfigWithApiAuth(apiAuthRequired?: 'true' | 'false') {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DATABASE_URL', 'sqlite.db');
    vi.stubEnv('JWT_SECRET', 'x'.repeat(32));
    vi.stubEnv('AUTH_MODE', 'local');
    vi.stubEnv('CORS_ORIGIN', 'http://localhost:39174');
    vi.stubEnv('API_AUTH_REQUIRED', apiAuthRequired);
    return import('../api/config');
  }

  it('keeps API auth disabled by default for local personal use', async () => {
    const { config } = await importConfigWithApiAuth();

    expect(config.API_AUTH_REQUIRED).toBe(false);
  });

  it('enables API auth only when API_AUTH_REQUIRED=true is configured', async () => {
    const { config } = await importConfigWithApiAuth('true');

    expect(config.API_AUTH_REQUIRED).toBe(true);
  });

  it('keeps only bootstrap and documentation endpoints public', async () => {
    const { isPublicApiPath } = await import('../api/lib/api-auth-boundary');

    expect(isPublicApiPath('/api/health')).toBe(true);
    expect(isPublicApiPath('/api/auth/login')).toBe(true);
    expect(isPublicApiPath('/api/auth/me')).toBe(false);
    expect(isPublicApiPath('/api/settings/llm')).toBe(false);
    expect(isPublicApiPath('/api/repositories')).toBe(false);
    expect(isPublicApiPath('/api/ws/nightworkers')).toBe(false);
  });
});

describe('Desktop security configuration', () => {
  function stubDesktopEnv() {
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-desktop-security-'));
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NIGHTWORKERS_DESKTOP', '1');
    vi.stubEnv('NIGHTWORKERS_RUNTIME_DIR', runtimeDir);
    vi.stubEnv('NIGHTWORKERS_API_ORIGIN', 'http://127.0.0.1:41234');
    vi.stubEnv('AUTH_MODE', undefined);
    vi.stubEnv('API_AUTH_REQUIRED', undefined);
    vi.stubEnv('DATABASE_URL', undefined);
    vi.stubEnv('JWT_SECRET', undefined);
    vi.stubEnv('CORS_ORIGIN', undefined);
    vi.stubEnv('APP_URL', undefined);
    return runtimeDir;
  }

  it('derives explicit desktop origins and local auth defaults during first-run bootstrap', async () => {
    stubDesktopEnv();
    vi.resetModules();

    const { config } = await import('../api/config');

    expect(config.AUTH_MODE).toBe('local');
    expect(config.API_AUTH_REQUIRED).toBe(false);
    expect(config.CORS_ORIGINS).toEqual([
      'http://127.0.0.1:41234',
      'http://tauri.localhost',
      'tauri://localhost',
      'http://localhost:39174',
    ]);
    expect(config.DATABASE_URL).toContain('/sqlite.db');
    expect(config.JWT_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it('allows desktop REST and WebSocket origins in production CSP', async () => {
    stubDesktopEnv();
    vi.resetModules();

    const { default: app } = await import('../api/app');
    const response = await app.request('/api/health/live', {
      headers: { Origin: 'http://tauri.localhost' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://tauri.localhost');
    const csp = response.headers.get('content-security-policy') || '';
    expect(csp).toContain('http://127.0.0.1:41234');
    expect(csp).toContain('ws://127.0.0.1:41234');
    expect(csp).toContain('http://tauri.localhost');
    expect(csp).toContain('tauri:');
  });
});
