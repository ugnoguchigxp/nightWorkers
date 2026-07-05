import fs from 'node:fs';
import path from 'node:path';
import type { PlanModeCapability } from '../../../shared/schemas/plan-mode-artifact.schema';
import { getRuntimePaths } from '../../runtime/paths';

export type { PlanModeCapability } from '../../../shared/schemas/plan-mode-artifact.schema';

const RUNTIME_SETTINGS_DIR = getRuntimePaths().settingsDir;
const GENERAL_SETTINGS_PATH =
  process.env.NIGHTWORKERS_GENERAL_SETTINGS_PATH ||
  path.join(RUNTIME_SETTINGS_DIR, 'general-settings.json');
const FX_CACHE_PATH =
  process.env.NIGHTWORKERS_FX_RATES_PATH || path.join(RUNTIME_SETTINGS_DIR, 'fx-rates.json');

export type NightWorkersLanguage = 'ja' | 'en';
export type NightWorkersCurrency = 'JPY' | 'USD' | 'EUR';
export type FxSource = 'ecb' | 'manual';

export type PlanModeSettings = {
  capabilities: Record<PlanModeCapability, boolean>;
};

export type LlmUsageSettings = {
  promptPartObservabilityEnabled: boolean;
};

export type GeneralSettings = {
  timezone: string;
  language: NightWorkersLanguage;
  currency: NightWorkersCurrency;
  fx: {
    source: FxSource;
    autoRefresh: boolean;
    lastRefreshedAt: string | null;
  };
  planMode: PlanModeSettings;
  llmUsage: LlmUsageSettings;
};

export type FxRateCache = {
  source: FxSource;
  baseCurrency: 'EUR';
  validOn: string;
  fetchedAt: string;
  rates: Record<string, number>;
};

export const SUPPORTED_LANGUAGES: NightWorkersLanguage[] = ['ja', 'en'];
export const SUPPORTED_CURRENCIES: NightWorkersCurrency[] = ['JPY', 'USD', 'EUR'];
export const PLAN_MODE_CAPABILITIES: PlanModeCapability[] = [
  'feature_plan',
  'questionnaire',
  'user_flow',
  'blueprint',
  'data_model',
  'api_io_contract',
  'activity_flow',
  'sequence_flow',
  'zod_schema_design',
];

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  timezone: 'Asia/Tokyo',
  language: 'ja',
  currency: 'JPY',
  fx: {
    source: 'ecb',
    autoRefresh: true,
    lastRefreshedAt: null,
  },
  planMode: {
    capabilities: {
      feature_plan: true,
      questionnaire: true,
      user_flow: true,
      blueprint: true,
      data_model: true,
      api_io_contract: true,
      activity_flow: true,
      sequence_flow: true,
      zod_schema_design: true,
    },
  },
  llmUsage: {
    promptPartObservabilityEnabled: true,
  },
};

export function readGeneralSettings(): GeneralSettings {
  const persisted = readJsonFile<Partial<GeneralSettings>>(GENERAL_SETTINGS_PATH) ?? {};
  return normalizeGeneralSettings(persisted);
}

export function writeGeneralSettings(input: Partial<GeneralSettings>): GeneralSettings {
  const settings = normalizeGeneralSettings(input);
  writeJsonFile(GENERAL_SETTINGS_PATH, settings);
  return settings;
}

export function readFxRateCache(): FxRateCache | null {
  return readJsonFile<FxRateCache>(FX_CACHE_PATH);
}

export function writeFxRateCache(cache: FxRateCache) {
  writeJsonFile(FX_CACHE_PATH, cache);
  const current = readGeneralSettings();
  writeGeneralSettings({
    ...current,
    fx: {
      ...current.fx,
      source: cache.source,
      lastRefreshedAt: cache.fetchedAt,
    },
  });
  return cache;
}

export async function refreshEcbFxRates(): Promise<FxRateCache> {
  const res = await fetch('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml');
  if (!res.ok) {
    throw new Error(`ECB FX refresh failed: ${res.status}`);
  }
  const xml = await res.text();
  const validOn = xml.match(/<Cube time=['"]([^'"]+)['"]>/)?.[1] || new Date().toISOString();
  const rates: Record<string, number> = { EUR: 1 };
  for (const match of xml.matchAll(/<Cube currency=['"]([^'"]+)['"] rate=['"]([^'"]+)['"]\/>/g)) {
    const rate = Number(match[2]);
    if (match[1] && Number.isFinite(rate) && rate > 0) rates[match[1]] = rate;
  }
  const cache: FxRateCache = {
    source: 'ecb',
    baseCurrency: 'EUR',
    validOn,
    fetchedAt: new Date().toISOString(),
    rates,
  };
  return writeFxRateCache(cache);
}

export function convertCurrency(input: {
  amount: number;
  from: NightWorkersCurrency;
  to: NightWorkersCurrency;
  cache: FxRateCache | null;
}) {
  if (input.from === input.to) return { amount: input.amount, rate: 1 };
  if (!input.cache) return { amount: null, rate: null };
  const fromRate = input.cache.rates[input.from];
  const toRate = input.cache.rates[input.to];
  if (!fromRate || !toRate) return { amount: null, rate: null };
  const rate = toRate / fromRate;
  return { amount: input.amount * rate, rate };
}

export function validateTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeGeneralSettings(input: Partial<GeneralSettings>): GeneralSettings {
  const timezone =
    typeof input.timezone === 'string' && validateTimezone(input.timezone)
      ? input.timezone
      : DEFAULT_GENERAL_SETTINGS.timezone;
  const language = SUPPORTED_LANGUAGES.includes(input.language as NightWorkersLanguage)
    ? (input.language as NightWorkersLanguage)
    : DEFAULT_GENERAL_SETTINGS.language;
  const currency = SUPPORTED_CURRENCIES.includes(input.currency as NightWorkersCurrency)
    ? (input.currency as NightWorkersCurrency)
    : DEFAULT_GENERAL_SETTINGS.currency;
  const source: FxSource = input.fx?.source === 'manual' ? 'manual' : 'ecb';
  return {
    timezone,
    language,
    currency,
    fx: {
      source,
      autoRefresh:
        typeof input.fx?.autoRefresh === 'boolean'
          ? input.fx.autoRefresh
          : DEFAULT_GENERAL_SETTINGS.fx.autoRefresh,
      lastRefreshedAt:
        typeof input.fx?.lastRefreshedAt === 'string' ? input.fx.lastRefreshedAt : null,
    },
    planMode: normalizePlanModeSettings(input.planMode),
    llmUsage: normalizeLlmUsageSettings(input.llmUsage),
  };
}

export function normalizeLlmUsageSettings(input: unknown): LlmUsageSettings {
  const record = isRecord(input) ? input : {};
  return {
    promptPartObservabilityEnabled:
      typeof record.promptPartObservabilityEnabled === 'boolean'
        ? record.promptPartObservabilityEnabled
        : DEFAULT_GENERAL_SETTINGS.llmUsage.promptPartObservabilityEnabled,
  };
}

export function normalizePlanModeSettings(input: unknown): PlanModeSettings {
  const record = isRecord(input) ? input : {};
  const capabilities = isRecord(record.capabilities) ? record.capabilities : {};
  return {
    capabilities: Object.fromEntries(
      PLAN_MODE_CAPABILITIES.map((capability) => [
        capability,
        resolveCapabilityValue(capability, capabilities),
      ])
    ) as Record<PlanModeCapability, boolean>,
  };
}

function resolveCapabilityValue(
  capability: PlanModeCapability,
  capabilities: Record<string, unknown>
) {
  if (typeof capabilities[capability] === 'boolean') return capabilities[capability];
  return (
    legacyCapabilityValue(capability, capabilities) ??
    DEFAULT_GENERAL_SETTINGS.planMode.capabilities[capability]
  );
}

function legacyCapabilityValue(
  capability: PlanModeCapability,
  capabilities: Record<string, unknown>
): boolean | undefined {
  if (capability === 'feature_plan' && typeof capabilities.specification === 'boolean') {
    return capabilities.specification;
  }
  return undefined;
}

export function buildPlanModeSettingsSnapshot(settings = readGeneralSettings()) {
  const disabledCapabilities = PLAN_MODE_CAPABILITIES.filter(
    (capability) => !settings.planMode.capabilities[capability]
  );
  return {
    capabilities: settings.planMode.capabilities,
    disabledCapabilities,
    source: 'general-settings' as const,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600,
  });
  try {
    fs.chmodSync(path.dirname(filePath), 0o700);
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best-effort hardening; unsupported filesystems should not block local settings updates.
  }
}
