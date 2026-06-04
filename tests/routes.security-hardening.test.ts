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

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('LLM settings secret hardening', () => {
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
