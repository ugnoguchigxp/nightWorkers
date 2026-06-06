import fs from 'node:fs';
import path from 'node:path';
import { getRuntimePaths } from '../../../runtime/paths';

export type SupervisorLlmProviderSettings = {
  ACTIVE_LLM_PROVIDER?: string;
  OPENAI_ENABLED?: boolean;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  OPENAI_STREAMING_ENABLED?: boolean;
  AZURE_OPENAI_ENABLED?: boolean;
  AZURE_OPENAI_API_KEY?: string;
  AZURE_OPENAI_ENDPOINT?: string;
  AZURE_OPENAI_DEPLOYMENT_NAME?: string;
  AZURE_OPENAI_API_VERSION?: string;
  AWS_BEDROCK_ENABLED?: boolean;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_REGION?: string;
  AWS_BEDROCK_MODEL?: string;
  CODEX_ENABLED?: boolean;
  CODEX_ACCESS_TOKEN?: string;
  CODEX_MODEL?: string;
  CODEX_MODEL_REASONING_EFFORT?: string;
  CODEX_STRUCTURED_OUTPUT_ENABLED?: boolean;
};

const boolKeys = new Set<keyof SupervisorLlmProviderSettings>([
  'OPENAI_ENABLED',
  'OPENAI_STREAMING_ENABLED',
  'AZURE_OPENAI_ENABLED',
  'AWS_BEDROCK_ENABLED',
  'CODEX_ENABLED',
  'CODEX_STRUCTURED_OUTPUT_ENABLED',
]);

export function readSupervisorLlmProviderSettings(): SupervisorLlmProviderSettings {
  const persisted = readPersistedRuntimeSettings();
  const merged: SupervisorLlmProviderSettings = {};
  for (const key of Object.keys(defaultSettings()) as Array<keyof SupervisorLlmProviderSettings>) {
    const persistedValue = persisted[key];
    if (persistedValue !== undefined && persistedValue !== null && persistedValue !== '') {
      merged[key] = persistedValue as never;
      continue;
    }
    const envValue = process.env[key];
    if (envValue === undefined) continue;
    merged[key] = normalizeSettingValue(key, envValue) as never;
  }
  return merged;
}

export function getSupervisorLlmSetting(
  settings: SupervisorLlmProviderSettings,
  key: keyof SupervisorLlmProviderSettings,
  fallback?: string
): string {
  const value = settings[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  return fallback ?? '';
}

export function getSupervisorLlmBoolSetting(
  settings: SupervisorLlmProviderSettings,
  key: keyof SupervisorLlmProviderSettings,
  fallback: boolean
): boolean {
  const value = settings[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return fallback;
}

function readPersistedRuntimeSettings(): Partial<SupervisorLlmProviderSettings> {
  try {
    const runtimeSettingsPath =
      process.env.NIGHTWORKERS_LLM_SETTINGS_PATH ||
      path.join(getRuntimePaths().settingsDir, 'llm-settings.json');
    if (!fs.existsSync(runtimeSettingsPath)) return {};
    const raw = JSON.parse(fs.readFileSync(runtimeSettingsPath, 'utf-8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as Partial<SupervisorLlmProviderSettings>;
  } catch {
    return {};
  }
}

function defaultSettings(): Required<Record<keyof SupervisorLlmProviderSettings, null>> {
  return {
    ACTIVE_LLM_PROVIDER: null,
    OPENAI_ENABLED: null,
    OPENAI_API_KEY: null,
    OPENAI_BASE_URL: null,
    OPENAI_MODEL: null,
    OPENAI_STREAMING_ENABLED: null,
    AZURE_OPENAI_ENABLED: null,
    AZURE_OPENAI_API_KEY: null,
    AZURE_OPENAI_ENDPOINT: null,
    AZURE_OPENAI_DEPLOYMENT_NAME: null,
    AZURE_OPENAI_API_VERSION: null,
    AWS_BEDROCK_ENABLED: null,
    AWS_ACCESS_KEY_ID: null,
    AWS_SECRET_ACCESS_KEY: null,
    AWS_REGION: null,
    AWS_BEDROCK_MODEL: null,
    CODEX_ENABLED: null,
    CODEX_ACCESS_TOKEN: null,
    CODEX_MODEL: null,
    CODEX_MODEL_REASONING_EFFORT: null,
    CODEX_STRUCTURED_OUTPUT_ENABLED: null,
  };
}

function normalizeSettingValue(key: keyof SupervisorLlmProviderSettings, value: string) {
  if (boolKeys.has(key)) return value.toLowerCase() === 'true';
  return value;
}
