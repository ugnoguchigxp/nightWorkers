import fs from 'node:fs';
import path from 'node:path';
import { z } from '@hono/zod-openapi';
import { getRuntimePaths } from '../runtime/paths';

const RUNTIME_SETTINGS_DIR = getRuntimePaths().settingsDir;
const RUNTIME_SETTINGS_PATH =
  process.env.NIGHTWORKERS_LLM_SETTINGS_PATH ||
  path.join(RUNTIME_SETTINGS_DIR, 'llm-settings.json');
const MASKED_SECRET = '********';

export const llmSettingsSchema = z.object({
  ACTIVE_LLM_PROVIDER: z.string().default('azure').openapi({ example: 'azure' }),
  OPENAI_ENABLED: z.boolean().default(true).openapi({ example: true }),
  AZURE_OPENAI_API_KEY: z.string().default('').openapi({ example: 'your-azure-key' }),
  AZURE_OPENAI_ENABLED: z.boolean().default(false).openapi({ example: false }),
  AZURE_OPENAI_ENDPOINT: z
    .string()
    .default('')
    .openapi({ example: 'https://xxx.openai.azure.com/' }),
  AZURE_OPENAI_DEPLOYMENT_NAME: z.string().default('').openapi({ example: 'gpt-5-mini' }),
  AZURE_OPENAI_API_VERSION: z.string().default('').openapi({ example: '2024-05-01-preview' }),
  AWS_BEDROCK_ENABLED: z.boolean().default(false).openapi({ example: false }),
  AWS_ACCESS_KEY_ID: z.string().default('').openapi({ example: 'your-aws-access-key' }),
  AWS_SECRET_ACCESS_KEY: z.string().default('').openapi({ example: 'your-aws-secret-key' }),
  AWS_REGION: z.string().default('').openapi({ example: 'us-east-1' }),
  AWS_BEDROCK_MODEL: z
    .string()
    .default('')
    .openapi({ example: 'anthropic.claude-3-5-sonnet-20241022-v2:0' }),
  OPENAI_API_KEY: z.string().default('').openapi({ example: 'sk-your-openai-key' }),
  OPENAI_BASE_URL: z.string().default('').openapi({ example: 'https://api.openai.com/v1' }),
  OPENAI_MODEL: z.string().default('').openapi({ example: 'gpt-4o' }),
  CODEX_ENABLED: z.boolean().default(false).openapi({ example: false }),
  CODEX_ACCESS_TOKEN: z.string().default('').openapi({ example: 'your-codex-token' }),
  CODEX_MODEL: z.string().default('').openapi({ example: 'gpt-5.3-codex' }),
  SESSION_QUEUE_MAX_CONCURRENCY: z.number().int().positive().default(2).openapi({ example: 2 }),
});

const SECRET_SETTING_KEYS = [
  'AZURE_OPENAI_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'OPENAI_API_KEY',
  'CODEX_ACCESS_TOKEN',
] as const satisfies ReadonlyArray<keyof z.infer<typeof llmSettingsSchema>>;

const providerModelOptions = {
  azure: ['gpt-5.5', 'gpt-5.4-mini', 'gpt-5-mini'],
  openai: ['gpt-5.5', 'gpt-5.4-mini', 'gpt-5-mini', 'gpt-4.1-mini'],
  bedrock: ['anthropic.claude-3-5-sonnet-20241022-v2:0'],
  codex: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark'],
} as const;

const getBoolEnv = (key: string, fallback: boolean) => {
  const value = process.env[key];
  if (!value) return fallback;
  return value.toLowerCase() === 'true';
};

const readRuntimeSettings = (): Partial<z.infer<typeof llmSettingsSchema>> => {
  try {
    if (!fs.existsSync(RUNTIME_SETTINGS_PATH)) return {};
    const text = fs.readFileSync(RUNTIME_SETTINGS_PATH, 'utf-8');
    return JSON.parse(text) as Partial<z.infer<typeof llmSettingsSchema>>;
  } catch {
    return {};
  }
};

const writeRuntimeSettings = (settings: z.infer<typeof llmSettingsSchema>) => {
  fs.mkdirSync(path.dirname(RUNTIME_SETTINGS_PATH), { recursive: true, mode: 0o700 });
  fs.writeFileSync(RUNTIME_SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600,
  });
  try {
    fs.chmodSync(path.dirname(RUNTIME_SETTINGS_PATH), 0o700);
    fs.chmodSync(RUNTIME_SETTINGS_PATH, 0o600);
  } catch {
    // Best-effort hardening; unsupported filesystems should not block local settings updates.
  }
};

export const getCurrentSettings = (): z.infer<typeof llmSettingsSchema> => {
  const persisted = readRuntimeSettings();
  return {
    ACTIVE_LLM_PROVIDER: (persisted.ACTIVE_LLM_PROVIDER ||
      process.env.ACTIVE_LLM_PROVIDER ||
      'azure') as 'azure' | 'openai' | 'bedrock' | 'codex',
    OPENAI_ENABLED:
      typeof persisted.OPENAI_ENABLED === 'boolean'
        ? persisted.OPENAI_ENABLED
        : getBoolEnv('OPENAI_ENABLED', true),
    AZURE_OPENAI_ENABLED:
      typeof persisted.AZURE_OPENAI_ENABLED === 'boolean'
        ? persisted.AZURE_OPENAI_ENABLED
        : getBoolEnv('AZURE_OPENAI_ENABLED', false),
    AZURE_OPENAI_API_KEY: persisted.AZURE_OPENAI_API_KEY ?? process.env.AZURE_OPENAI_API_KEY ?? '',
    AZURE_OPENAI_ENDPOINT:
      persisted.AZURE_OPENAI_ENDPOINT ?? process.env.AZURE_OPENAI_ENDPOINT ?? '',
    AZURE_OPENAI_DEPLOYMENT_NAME:
      persisted.AZURE_OPENAI_DEPLOYMENT_NAME ?? process.env.AZURE_OPENAI_DEPLOYMENT_NAME ?? '',
    AZURE_OPENAI_API_VERSION:
      persisted.AZURE_OPENAI_API_VERSION ?? process.env.AZURE_OPENAI_API_VERSION ?? '',
    AWS_BEDROCK_ENABLED:
      typeof persisted.AWS_BEDROCK_ENABLED === 'boolean'
        ? persisted.AWS_BEDROCK_ENABLED
        : getBoolEnv('AWS_BEDROCK_ENABLED', false),
    AWS_ACCESS_KEY_ID: persisted.AWS_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID ?? '',
    AWS_SECRET_ACCESS_KEY:
      persisted.AWS_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? '',
    AWS_REGION: persisted.AWS_REGION ?? process.env.AWS_REGION ?? '',
    AWS_BEDROCK_MODEL: persisted.AWS_BEDROCK_MODEL ?? process.env.AWS_BEDROCK_MODEL ?? '',
    OPENAI_API_KEY: persisted.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
    OPENAI_BASE_URL: persisted.OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL ?? '',
    OPENAI_MODEL: persisted.OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? '',
    CODEX_ENABLED:
      typeof persisted.CODEX_ENABLED === 'boolean'
        ? persisted.CODEX_ENABLED
        : getBoolEnv('CODEX_ENABLED', false),
    CODEX_ACCESS_TOKEN: persisted.CODEX_ACCESS_TOKEN ?? process.env.CODEX_ACCESS_TOKEN ?? '',
    CODEX_MODEL: persisted.CODEX_MODEL ?? process.env.CODEX_MODEL ?? '',
    SESSION_QUEUE_MAX_CONCURRENCY:
      typeof persisted.SESSION_QUEUE_MAX_CONCURRENCY === 'number'
        ? persisted.SESSION_QUEUE_MAX_CONCURRENCY
        : Number(process.env.SESSION_QUEUE_MAX_CONCURRENCY || 2),
  };
};

const applySettingsToProcessEnv = (settings: z.infer<typeof llmSettingsSchema>) => {
  for (const [key, val] of Object.entries(settings)) {
    process.env[key] = String(val);
  }
};

export function maskLlmSettings(settings: z.infer<typeof llmSettingsSchema>) {
  const masked = { ...settings };
  for (const key of SECRET_SETTING_KEYS) {
    masked[key] = settings[key] ? MASKED_SECRET : '';
  }
  return masked;
}

export function mergeMaskedSecrets(
  incoming: z.infer<typeof llmSettingsSchema>,
  current: z.infer<typeof llmSettingsSchema>
) {
  const merged = { ...incoming };
  for (const key of SECRET_SETTING_KEYS) {
    if (incoming[key] === MASKED_SECRET) {
      merged[key] = current[key] || '';
    }
  }
  return merged;
}

applySettingsToProcessEnv(getCurrentSettings());

export { applySettingsToProcessEnv, providerModelOptions, writeRuntimeSettings };
