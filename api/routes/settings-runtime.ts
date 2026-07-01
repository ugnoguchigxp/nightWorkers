import fs from 'node:fs';
import path from 'node:path';
import { z } from '@hono/zod-openapi';
import { ValidationError } from '../lib/errors';
import { getRuntimePaths } from '../runtime/paths';
import { readCodexModelOptions } from '../services/codex-global-config/status';
import { migrateStructuredLlmEndpointIds } from '../services/structured-llm/endpoint-id-migration';

const RUNTIME_SETTINGS_DIR = getRuntimePaths().settingsDir;
const RUNTIME_SETTINGS_PATH =
  process.env.NIGHTWORKERS_LLM_SETTINGS_PATH ||
  path.join(RUNTIME_SETTINGS_DIR, 'llm-settings.json');
export const MASKED_SECRET = '********';

const providerEndpointKindSchema = z.enum([
  'azure',
  'openai',
  'openai-compatible',
  'bedrock',
  'codex',
  'local',
]);

export const llmRoleSchema = z.enum([
  'plan',
  'evaluation',
  'implementation',
  'test',
  'review',
  'mission_task_generation',
  'quality_gate',
  'completion',
]);

const thinkingDepthSchema = z.enum(['', 'low', 'medium', 'high', 'very_high']);

const llmModelCapabilitySchema = z.object({
  contextWindowTokens: z.number().int().positive().optional(),
  safePromptBudgetTokens: z.number().int().positive().optional(),
  reservedOutputTokens: z.number().int().positive().optional(),
  supportsProviderSideCompression: z.boolean().optional(),
  compressionProfile: z.string().optional(),
});

export const llmProviderEndpointSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: providerEndpointKindSchema,
  enabled: z.boolean().default(true),
  apiKey: z.string().optional().default(''),
  baseUrl: z.string().optional().default(''),
  endpoint: z.string().optional().default(''),
  apiVersion: z.string().optional().default(''),
  region: z.string().optional().default(''),
  models: z.array(z.string()).default([]),
  modelDisplayNames: z.record(z.string(), z.string()).optional().default({}),
  defaultModelCapability: llmModelCapabilitySchema.optional(),
  modelCapabilities: z.record(z.string(), llmModelCapabilitySchema).optional(),
});

const llmModelTargetSchema = z.object({
  providerEndpointId: z.string().default(''),
  model: z.string().default(''),
  thinkingDepth: thinkingDepthSchema.optional().default(''),
});

const llmRoleRouteSchema = z.object({
  role: llmRoleSchema,
  primary: llmModelTargetSchema.optional(),
  fallbacks: z.array(llmModelTargetSchema).default([]),
  providerEndpointId: z.string().optional(),
  model: z.string().optional(),
  fallbackProviderEndpointId: z.string().optional(),
  fallbackModel: z.string().optional(),
});

export const llmSettingsSchema = z.object({
  settingsRevision: z.string().optional(),
  endpointIdSchemaVersion: z.number().int().positive().optional(),
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
  CODEX_MODEL: z.string().default('').openapi({ example: 'gpt-5.4-mini' }),
  IMPLEMENTATION_RUNTIME_LANE: z
    .enum(['', 'native-api-runner', 'native-supervisor', 'codex-sdk', 'codex-agent'])
    .default('')
    .openapi({ example: 'codex-sdk' }),
  SESSION_QUEUE_MAX_CONCURRENCY: z.number().int().positive().default(2).openapi({ example: 2 }),
  providerEndpoints: z.array(llmProviderEndpointSchema).default([]),
  roleRoutes: z.array(llmRoleRouteSchema).default([]),
});

type RawLlmSettings = z.infer<typeof llmSettingsSchema>;
export type LlmProviderEndpoint = RawLlmSettings['providerEndpoints'][number];
export type LlmModelTarget = {
  providerEndpointId: string;
  model: string;
  thinkingDepth: z.infer<typeof thinkingDepthSchema>;
};
export type LlmRole = z.infer<typeof llmRoleSchema>;
export type LlmRoleRoute = {
  role: LlmRole;
  primary: LlmModelTarget;
  fallbacks: LlmModelTarget[];
};
export type LlmSettings = Omit<RawLlmSettings, 'roleRoutes'> & {
  roleRoutes: LlmRoleRoute[];
};

const SECRET_SETTING_KEYS = [
  'AZURE_OPENAI_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'OPENAI_API_KEY',
  'CODEX_ACCESS_TOKEN',
] as const satisfies ReadonlyArray<keyof RawLlmSettings>;

const providerModelOptions = {
  azure: ['gpt-5.5', 'gpt-5.4-mini', 'gpt-5-mini'],
  openai: ['gpt-5.5', 'gpt-5.4-mini', 'gpt-5-mini', 'gpt-4.1-mini'],
  bedrock: ['anthropic.claude-3-5-sonnet-20241022-v2:0'],
  codex: ['gpt-5.5', 'gpt-5.4-mini', 'gpt-5-mini'],
} as const;

export const LLM_ROLE_ORDER: LlmRole[] = [
  'plan',
  'evaluation',
  'implementation',
  'test',
  'review',
  'mission_task_generation',
  'quality_gate',
  'completion',
];

const getBoolEnv = (key: string, fallback: boolean) => {
  const value = process.env[key];
  if (!value) return fallback;
  return value.toLowerCase() === 'true';
};

const getRuntimeLaneSetting = (value: unknown): '' | 'native-api-runner' | 'codex-sdk' => {
  if (value === 'native-api-runner' || value === 'codex-sdk') return value;
  if (value === 'native-supervisor') return 'native-api-runner';
  if (value === 'codex-agent') return 'codex-sdk';
  return '';
};

const getStructuredProviderSetting = (value: unknown): 'azure' | 'openai' | 'bedrock' | 'codex' => {
  if (value === 'openai' || value === 'azure' || value === 'bedrock' || value === 'codex') {
    return value;
  }
  return 'azure';
};

const readRuntimeSettings = (): {
  settings: Partial<RawLlmSettings>;
  exists: boolean;
  loaded: boolean;
} => {
  const exists = fs.existsSync(RUNTIME_SETTINGS_PATH);
  try {
    if (!exists) return { settings: {}, exists: false, loaded: false };
    const text = fs.readFileSync(RUNTIME_SETTINGS_PATH, 'utf-8');
    return {
      settings: JSON.parse(text) as Partial<RawLlmSettings>,
      exists: true,
      loaded: true,
    };
  } catch {
    return { settings: {}, exists, loaded: false };
  }
};

const writeRuntimeSettings = (settings: LlmSettings) => {
  fs.mkdirSync(path.dirname(RUNTIME_SETTINGS_PATH), { recursive: true, mode: 0o700 });
  const tmpPath = `${RUNTIME_SETTINGS_PATH}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(settings, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600,
  });
  fs.renameSync(tmpPath, RUNTIME_SETTINGS_PATH);
  try {
    fs.chmodSync(path.dirname(RUNTIME_SETTINGS_PATH), 0o700);
    fs.chmodSync(RUNTIME_SETTINGS_PATH, 0o600);
  } catch {
    // Best-effort hardening; unsupported filesystems should not block local settings updates.
  }
};

export const getCurrentSettings = (): LlmSettings => {
  const persistedRead = readRuntimeSettings();
  const persisted = persistedRead.settings;
  const rawActiveProvider =
    persisted.ACTIVE_LLM_PROVIDER || process.env.ACTIVE_LLM_PROVIDER || 'azure';
  const codexEnabled =
    typeof persisted.CODEX_ENABLED === 'boolean'
      ? persisted.CODEX_ENABLED
      : getBoolEnv('CODEX_ENABLED', false);
  const explicitRuntimeLane = getRuntimeLaneSetting(
    persisted.IMPLEMENTATION_RUNTIME_LANE ?? process.env.IMPLEMENTATION_RUNTIME_LANE
  );
  const legacyCodexRuntimeLane = rawActiveProvider === 'codex' && codexEnabled ? 'codex-sdk' : '';
  const legacySettings: Omit<LlmSettings, 'providerEndpoints' | 'roleRoutes'> = {
    settingsRevision:
      typeof persisted.settingsRevision === 'string' ? persisted.settingsRevision : undefined,
    endpointIdSchemaVersion:
      typeof persisted.endpointIdSchemaVersion === 'number'
        ? persisted.endpointIdSchemaVersion
        : undefined,
    ACTIVE_LLM_PROVIDER: getStructuredProviderSetting(rawActiveProvider),
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
    CODEX_ENABLED: codexEnabled,
    CODEX_ACCESS_TOKEN: persisted.CODEX_ACCESS_TOKEN ?? process.env.CODEX_ACCESS_TOKEN ?? '',
    CODEX_MODEL: persisted.CODEX_MODEL ?? process.env.CODEX_MODEL ?? '',
    IMPLEMENTATION_RUNTIME_LANE: explicitRuntimeLane || legacyCodexRuntimeLane,
    SESSION_QUEUE_MAX_CONCURRENCY:
      typeof persisted.SESSION_QUEUE_MAX_CONCURRENCY === 'number'
        ? persisted.SESSION_QUEUE_MAX_CONCURRENCY
        : Number(process.env.SESSION_QUEUE_MAX_CONCURRENCY || 2),
  };
  const providerEndpoints = normalizeProviderEndpoints(persisted.providerEndpoints, legacySettings);
  const roleRoutes = normalizeRoleRoutes(
    persisted.roleRoutes,
    providerEndpoints,
    legacySettings.ACTIVE_LLM_PROVIDER
  );
  const normalized = {
    ...legacySettings,
    providerEndpoints,
    roleRoutes,
  };
  const migration = migrateStructuredLlmEndpointIds(normalized);
  if (migration.changed && persistedRead.exists && persistedRead.loaded) {
    writeRuntimeSettings(migration.settings);
  }
  return migration.settings;
};

const applySettingsToProcessEnv = (settings: LlmSettings) => {
  for (const [key, val] of Object.entries(settings)) {
    if (Array.isArray(val)) continue;
    process.env[key] = String(val);
  }
};

export function maskLlmSettings(settings: LlmSettings) {
  const masked = { ...settings };
  for (const key of SECRET_SETTING_KEYS) {
    masked[key] = settings[key] ? MASKED_SECRET : '';
  }
  masked.providerEndpoints = (settings.providerEndpoints || []).map((endpoint) => ({
    ...endpoint,
    apiKey: endpoint.apiKey ? MASKED_SECRET : '',
  }));
  return masked;
}

export function mergeMaskedSecrets(incoming: RawLlmSettings, current: LlmSettings) {
  const merged = { ...incoming };
  for (const key of SECRET_SETTING_KEYS) {
    if (incoming[key] === MASKED_SECRET) {
      merged[key] = current[key] || '';
    }
  }
  const currentEndpoints = new Map(
    (current.providerEndpoints || []).map((endpoint) => [endpoint.id, endpoint])
  );
  merged.providerEndpoints = (incoming.providerEndpoints || []).map((endpoint) => {
    if (endpoint.apiKey !== MASKED_SECRET) return endpoint;
    return {
      ...endpoint,
      apiKey: currentEndpoints.get(endpoint.id)?.apiKey || '',
    };
  });
  return normalizeRawLlmSettings(merged);
}

function normalizeRawLlmSettings(input: RawLlmSettings): LlmSettings {
  const {
    providerEndpoints: rawProviderEndpoints,
    roleRoutes: rawRoleRoutes,
    ...rawLegacy
  } = input;
  const legacySettings: Omit<LlmSettings, 'providerEndpoints' | 'roleRoutes'> = {
    ...rawLegacy,
    ACTIVE_LLM_PROVIDER: getStructuredProviderSetting(rawLegacy.ACTIVE_LLM_PROVIDER),
    IMPLEMENTATION_RUNTIME_LANE: getRuntimeLaneSetting(rawLegacy.IMPLEMENTATION_RUNTIME_LANE),
  };
  const providerEndpoints = normalizeProviderEndpoints(rawProviderEndpoints, legacySettings);
  validateExplicitRoleRoutesOrThrow(rawRoleRoutes, providerEndpoints);
  const normalized = {
    ...legacySettings,
    providerEndpoints,
    roleRoutes: normalizeRoleRoutes(
      rawRoleRoutes,
      providerEndpoints,
      legacySettings.ACTIVE_LLM_PROVIDER
    ),
  };
  return migrateStructuredLlmEndpointIds(normalized).settings;
}

function normalizeProviderEndpoints(
  input: unknown,
  legacySettings: Omit<LlmSettings, 'providerEndpoints' | 'roleRoutes'>
): LlmProviderEndpoint[] {
  const parsed = z.array(llmProviderEndpointSchema).safeParse(input);
  const endpoints = parsed.success ? parsed.data : [];
  const endpointById = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
  for (const endpoint of buildLegacyProviderEndpoints(legacySettings)) {
    if (!endpointById.has(endpoint.id)) endpointById.set(endpoint.id, endpoint);
  }
  return [...endpointById.values()].map((endpoint) => {
    const models = uniqueNonEmpty(endpoint.models);
    return {
      ...endpoint,
      models,
      modelDisplayNames: normalizeModelDisplayNames(endpoint.modelDisplayNames, models),
    };
  });
}

function buildLegacyProviderEndpoints(
  settings: Omit<LlmSettings, 'providerEndpoints' | 'roleRoutes'>
): LlmProviderEndpoint[] {
  return [
    {
      id: 'azure-default',
      name: 'Azure OpenAI',
      kind: 'azure',
      enabled: settings.AZURE_OPENAI_ENABLED,
      apiKey: settings.AZURE_OPENAI_API_KEY,
      baseUrl: '',
      endpoint: settings.AZURE_OPENAI_ENDPOINT,
      apiVersion: settings.AZURE_OPENAI_API_VERSION,
      region: '',
      models: uniqueNonEmpty([
        settings.AZURE_OPENAI_DEPLOYMENT_NAME,
        ...providerModelOptions.azure,
      ]),
      modelDisplayNames: {},
    },
    {
      id: 'openai-default',
      name: 'OpenAI Compatible',
      kind: 'openai',
      enabled: settings.OPENAI_ENABLED,
      apiKey: settings.OPENAI_API_KEY,
      baseUrl: settings.OPENAI_BASE_URL,
      endpoint: '',
      apiVersion: '',
      region: '',
      models: uniqueNonEmpty([settings.OPENAI_MODEL, ...providerModelOptions.openai]),
      modelDisplayNames: {},
    },
    {
      id: 'bedrock-default',
      name: 'AWS Bedrock',
      kind: 'bedrock',
      enabled: settings.AWS_BEDROCK_ENABLED,
      apiKey: '',
      baseUrl: '',
      endpoint: '',
      apiVersion: '',
      region: settings.AWS_REGION,
      models: uniqueNonEmpty([settings.AWS_BEDROCK_MODEL, ...providerModelOptions.bedrock]),
      modelDisplayNames: {},
    },
    {
      id: 'codex-default',
      name: 'Codex SDK',
      kind: 'codex',
      enabled: settings.CODEX_ENABLED,
      apiKey: settings.CODEX_ACCESS_TOKEN,
      baseUrl: '',
      endpoint: '',
      apiVersion: '',
      region: '',
      models: uniqueNonEmpty(
        readCodexModelOptions({ configuredModel: settings.CODEX_MODEL }).map(
          (option) => option.value
        )
      ),
      modelDisplayNames: {},
    },
  ];
}

function normalizeRoleRoutes(
  input: unknown,
  providerEndpoints: LlmProviderEndpoint[],
  activeProvider: string
): LlmRoleRoute[] {
  const parsed = z.array(llmRoleRouteSchema).safeParse(input);
  const routesByRole = new Map<LlmRole, z.infer<typeof llmRoleRouteSchema>>();
  if (parsed.success) {
    for (const route of parsed.data) routesByRole.set(route.role, route);
  }
  const fallbackEndpoint = findDefaultEndpointForProvider(providerEndpoints, activeProvider);
  const defaultTarget: LlmModelTarget = {
    providerEndpointId: fallbackEndpoint?.id || '',
    model: fallbackEndpoint?.models[0] || '',
    thinkingDepth: '',
  };
  return LLM_ROLE_ORDER.map((role) => {
    const route = routesByRole.get(role);
    if (route) return normalizeRoleRoute(route, defaultTarget);
    return {
      role,
      primary: defaultTarget,
      fallbacks: [],
    };
  });
}

function normalizeRoleRoute(
  route: z.infer<typeof llmRoleRouteSchema>,
  defaultTarget: LlmModelTarget
): LlmRoleRoute {
  const primary =
    normalizeModelTarget(route.primary) ||
    normalizeModelTarget({
      providerEndpointId: route.providerEndpointId,
      model: route.model,
    }) ||
    defaultTarget;
  const legacyFallback = normalizeModelTarget({
    providerEndpointId: route.fallbackProviderEndpointId,
    model: route.fallbackModel,
  });
  return {
    role: route.role,
    primary,
    fallbacks: uniqueModelTargets([
      ...route.fallbacks.map(normalizeModelTarget).filter((target) => Boolean(target)),
      ...(legacyFallback ? [legacyFallback] : []),
    ] as LlmModelTarget[]),
  };
}

function normalizeModelTarget(input: unknown): LlmModelTarget | null {
  const parsed = llmModelTargetSchema.safeParse(input);
  if (!parsed.success) return null;
  const providerEndpointId = parsed.data.providerEndpointId.trim();
  const model = parsed.data.model.trim();
  if (!providerEndpointId || !model) return null;
  return { providerEndpointId, model, thinkingDepth: parsed.data.thinkingDepth || '' };
}

function uniqueModelTargets(targets: LlmModelTarget[]) {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.providerEndpointId}\u0000${target.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findDefaultEndpointForProvider(
  endpoints: LlmProviderEndpoint[],
  provider: string
): LlmProviderEndpoint | undefined {
  const defaultId = provider === 'azure' ? 'azure-default' : `${provider}-default`;
  return endpoints.find((endpoint) => endpoint.id === defaultId) || endpoints[0];
}

function uniqueNonEmpty(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])];
}

function normalizeModelDisplayNames(
  input: Record<string, string> | undefined,
  models: string[]
): Record<string, string> {
  const modelSet = new Set(models);
  return Object.fromEntries(
    Object.entries(input || {})
      .map(([model, label]) => [model.trim(), label.trim()])
      .filter(([model, label]) => modelSet.has(model) && Boolean(label))
  );
}

function validateExplicitRoleRoutesOrThrow(
  input: unknown,
  providerEndpoints: LlmProviderEndpoint[]
) {
  const parsed = z.array(llmRoleRouteSchema).safeParse(input);
  if (!parsed.success) return;
  const endpointsById = new Map(providerEndpoints.map((endpoint) => [endpoint.id, endpoint]));
  const issues: Array<Record<string, unknown>> = [];
  for (const route of parsed.data) {
    const normalized = normalizeRoleRoute(route, {
      providerEndpointId: '',
      model: '',
      thinkingDepth: '',
    });
    validateRouteTarget({
      issues,
      endpointsById,
      role: normalized.role,
      source: 'primary',
      target: normalized.primary,
    });
    normalized.fallbacks.forEach((target, fallbackIndex) => {
      validateRouteTarget({
        issues,
        endpointsById,
        role: normalized.role,
        source: 'fallback',
        target,
        fallbackIndex,
      });
    });
  }
  if (issues.length > 0) {
    throw new ValidationError('Invalid Role Routing target', { issues });
  }
}

function validateRouteTarget(input: {
  issues: Array<Record<string, unknown>>;
  endpointsById: Map<string, LlmProviderEndpoint>;
  role: LlmRole;
  source: 'primary' | 'fallback';
  target: LlmModelTarget;
  fallbackIndex?: number;
}) {
  if (!input.target.providerEndpointId || !input.target.model) return;
  const endpoint = input.endpointsById.get(input.target.providerEndpointId);
  const baseIssue = {
    role: input.role,
    source: input.source,
    providerEndpointId: input.target.providerEndpointId,
    model: input.target.model,
    ...(input.fallbackIndex === undefined ? {} : { fallbackIndex: input.fallbackIndex }),
  };
  if (!endpoint) {
    input.issues.push({ ...baseIssue, reason: 'missing_endpoint' });
    return;
  }
  if (!endpoint.enabled) {
    input.issues.push({ ...baseIssue, reason: 'disabled_endpoint' });
    return;
  }
  if (!endpoint.models.includes(input.target.model)) {
    input.issues.push({ ...baseIssue, reason: 'missing_model' });
  }
}

applySettingsToProcessEnv(getCurrentSettings());

export { applySettingsToProcessEnv, providerModelOptions, writeRuntimeSettings };
