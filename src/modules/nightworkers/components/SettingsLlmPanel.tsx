import { Activity, CheckCircle2, Plus, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { fetchCodexSdkStatus, testLlmProviderHealth } from '../nightWorkersCommands';
import type {
  CodexSdkStatus,
  LlmModelTarget,
  LlmProviderEndpoint,
  LlmProviderEndpointKind,
  LlmProviderHealthResult,
  LlmRole,
  LlmRoleRoute,
  LlmSettings,
  ModelOption,
  ThinkingDepth,
} from '../types';
import { Field, SelectField } from './SettingsFields';

const endpointKindOptions: Array<{ value: LlmProviderEndpointKind; label: string }> = [
  { value: 'azure', label: 'Azure OpenAI' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'openai-compatible', label: 'OpenAI Compatible' },
  { value: 'bedrock', label: 'AWS Bedrock' },
  { value: 'local', label: 'Local LLM' },
];

const roleLabels: Record<LlmRole, string> = {
  plan: 'Plan',
  implementation: 'Implementation',
  test: 'Test',
  review: 'Review',
  quality_gate: 'Quality Gate',
  completion: 'Completion',
};

const emptyModelTarget: LlmModelTarget = { providerEndpointId: '', model: '' };

function createEndpointId() {
  if (!globalThis.crypto?.getRandomValues) return `ep_${Date.now().toString(16)}`;
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `ep_${hex}`;
}

const thinkingDepthOptions: Array<{ value: '' | ThinkingDepth; label: string }> = [
  { value: '', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'very_high', label: 'Very high' },
];

function modelTargetKey(target: LlmModelTarget) {
  return JSON.stringify({
    providerEndpointId: target.providerEndpointId,
    model: target.model,
  });
}

function modelTargetFromKey(value: string): LlmModelTarget {
  try {
    const parsed = JSON.parse(value) as Partial<LlmModelTarget>;
    if (typeof parsed.providerEndpointId === 'string' && typeof parsed.model === 'string') {
      return {
        providerEndpointId: parsed.providerEndpointId,
        model: parsed.model,
      };
    }
  } catch {
    // Invalid select values fall through to an empty target.
  }
  return emptyModelTarget;
}

function formatModelDisplayNames(value: Record<string, string> | undefined) {
  return Object.entries(value || {})
    .map(([model, label]) => `${model}=${label}`)
    .join('\n');
}

function parseModelDisplayNames(text: string) {
  return Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [model, ...rest] = line.split('=');
        return [model.trim(), rest.join('=').trim()];
      })
      .filter(([model, label]) => model && label)
  );
}

function pruneModelDisplayNames(labels: Record<string, string> | undefined, models: string[]) {
  const modelSet = new Set(models);
  return Object.fromEntries(
    Object.entries(labels || {}).filter(([model, label]) => modelSet.has(model) && label.trim())
  );
}

function uniqueModelOptions(options: ModelOption[]) {
  const seen = new Set<string>();
  return options.filter((option) => {
    if (!option.value || seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
}

function formatModelTargetLabel(
  endpoint: LlmProviderEndpoint,
  model: string,
  codexModelOptions: ModelOption[]
) {
  if (endpoint.kind === 'codex') {
    const codexLabel = codexModelOptions.find((option) => option.value === model)?.label || model;
    return `${codexLabel} (Codex SDK)`;
  }
  return (
    endpoint.modelDisplayNames?.[model]?.trim() || `${model} (${endpoint.name} / ${endpoint.kind})`
  );
}

function codexAuthSourceLabel(status: CodexSdkStatus | null) {
  if (!status) return 'Unchecked';
  if (status.authSource === 'settings-token') return 'Settings token';
  if (status.authSource === 'environment-token') return 'Environment token';
  if (status.authSource === 'codex-auth-json') return 'Codex login';
  return 'Not logged in';
}

function isThinkingModel(model: string) {
  const normalized = model.toLowerCase();
  return (
    /^gpt-5(\b|[.-])/.test(normalized) ||
    /^o[134](\b|[.-])/.test(normalized) ||
    normalized.includes('codex') ||
    normalized.includes('reasoning') ||
    normalized.includes('thinking') ||
    normalized.includes('deepseek-r1') ||
    normalized.includes('qwen3')
  );
}

function withThinkingDepth(target: LlmModelTarget, thinkingDepth: string): LlmModelTarget {
  return {
    ...target,
    thinkingDepth: isThinkingModel(target.model) ? (thinkingDepth as ThinkingDepth | '') : '',
  };
}

export function SettingsLlmPanel({
  section,
  settings,
  isSaving,
  saveStatus,
  saveMessage,
  onChange,
  handleSave,
}: {
  section: 'providers' | 'routing';
  settings: LlmSettings;
  isSaving: boolean;
  saveStatus: 'idle' | 'success' | 'error';
  saveMessage: string;
  onChange: <K extends keyof LlmSettings>(key: K, value: LlmSettings[K]) => void;
  handleSave: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [codexStatus, setCodexStatus] = useState<CodexSdkStatus | null>(null);
  const [codexStatusLoading, setCodexStatusLoading] = useState(false);
  const [healthBusyEndpointId, setHealthBusyEndpointId] = useState<string | null>(null);
  const [healthResults, setHealthResults] = useState<Record<string, LlmProviderHealthResult>>({});
  const genericProviderEndpoints = settings.providerEndpoints.filter(
    (endpoint) => endpoint.kind !== 'codex'
  );
  const codexModelOptions = uniqueModelOptions([
    ...(settings.CODEX_MODEL ? [{ value: settings.CODEX_MODEL, label: settings.CODEX_MODEL }] : []),
    ...(codexStatus?.models || []),
    ...settings.providerEndpoints
      .filter((endpoint) => endpoint.kind === 'codex')
      .flatMap((endpoint) =>
        endpoint.models.map((model) => ({
          value: model,
          label: endpoint.modelDisplayNames?.[model]?.trim() || model,
        }))
      ),
  ]);
  const modelTargetOptions = settings.providerEndpoints
    .filter((endpoint) => (endpoint.kind === 'codex' ? settings.CODEX_ENABLED : endpoint.enabled))
    .flatMap((endpoint) =>
      (endpoint.kind === 'codex' && codexModelOptions.length
        ? codexModelOptions.map((option) => option.value)
        : endpoint.models
      ).map((model) => ({
        value: modelTargetKey({ providerEndpointId: endpoint.id, model }),
        label: formatModelTargetLabel(endpoint, model, codexModelOptions),
      }))
    );
  const modelTargetOptionsWithNone = [
    { value: modelTargetKey(emptyModelTarget), label: 'None' },
    ...modelTargetOptions,
  ];
  const roleRoutes = settings.roleRoutes;

  const refreshCodexStatus = useCallback(async () => {
    setCodexStatusLoading(true);
    try {
      const res = await fetchCodexSdkStatus();
      if (!res.ok) return;
      setCodexStatus((await res.json()) as CodexSdkStatus);
    } finally {
      setCodexStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    if (section !== 'providers' && section !== 'routing') return;
    void refreshCodexStatus();
  }, [section, refreshCodexStatus]);

  const updateEndpoint = (id: string, patch: Partial<LlmProviderEndpoint>) => {
    onChange(
      'providerEndpoints',
      settings.providerEndpoints.map((endpoint) =>
        endpoint.id === id ? { ...endpoint, ...patch } : endpoint
      )
    );
  };

  const addEndpoint = () => {
    const id = createEndpointId();
    onChange('providerEndpoints', [
      ...settings.providerEndpoints,
      {
        id,
        name: 'Local LLM',
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
    ]);
  };

  const removeEndpoint = (id: string) => {
    onChange(
      'providerEndpoints',
      settings.providerEndpoints.filter((endpoint) => endpoint.id !== id)
    );
    onChange(
      'roleRoutes',
      settings.roleRoutes.map((route) => ({
        ...route,
        primary: route.primary.providerEndpointId === id ? emptyModelTarget : route.primary,
        fallbacks: route.fallbacks.filter((target) => target.providerEndpointId !== id),
      }))
    );
  };

  const checkEndpointHealth = async (endpoint: LlmProviderEndpoint) => {
    setHealthBusyEndpointId(endpoint.id);
    try {
      const res = await testLlmProviderHealth(endpoint.id, endpoint);
      if (!res.ok) throw new Error(await res.text());
      const result = (await res.json()) as LlmProviderHealthResult;
      setHealthResults((current) => ({ ...current, [endpoint.id]: result }));
    } catch (err) {
      setHealthResults((current) => ({
        ...current,
        [endpoint.id]: {
          ok: false,
          reachable: false,
          providerEndpointId: endpoint.id,
          providerKind: endpoint.kind,
          url: null,
          status: null,
          durationMs: 0,
          checkedAt: new Date().toISOString(),
          message: err instanceof Error ? err.message : String(err),
        },
      }));
    } finally {
      setHealthBusyEndpointId(null);
    }
  };

  const updateRoleRoute = (role: LlmRole, patch: Partial<LlmRoleRoute>) => {
    onChange(
      'roleRoutes',
      roleRoutes.map((route) => (route.role === role ? { ...route, ...patch } : route))
    );
  };

  const updateFallback = (route: LlmRoleRoute, index: number, target: LlmModelTarget) => {
    updateRoleRoute(route.role, {
      fallbacks: route.fallbacks.map((fallback, fallbackIndex) =>
        fallbackIndex === index ? withThinkingDepth(target, target.thinkingDepth || '') : fallback
      ),
    });
  };

  const updateTargetThinkingDepth = (
    route: LlmRoleRoute,
    targetKey: 'primary' | 'fallback',
    thinkingDepth: '' | ThinkingDepth,
    fallbackIndex?: number
  ) => {
    if (targetKey === 'primary') {
      updateRoleRoute(route.role, {
        primary: withThinkingDepth(route.primary, thinkingDepth),
      });
      return;
    }
    if (fallbackIndex === undefined) return;
    updateFallback(
      route,
      fallbackIndex,
      withThinkingDepth(route.fallbacks[fallbackIndex], thinkingDepth)
    );
  };

  const moveFallback = (route: LlmRoleRoute, index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= route.fallbacks.length) return;
    const fallbacks = [...route.fallbacks];
    [fallbacks[index], fallbacks[nextIndex]] = [fallbacks[nextIndex], fallbacks[index]];
    updateRoleRoute(route.role, { fallbacks });
  };

  return (
    <div className="grid gap-4">
      {section === 'providers' ? (
        <section className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Provider Endpoints</h2>
              <p className="mt-1 text-xs text-zinc-500">
                LLM provider endpoints and credentials. Role Routing selects from these endpoints.
              </p>
            </div>
            <Button type="button" size="sm" variant="secondary" icon={Plus} onClick={addEndpoint}>
              Add
            </Button>
          </div>
          <div className="grid gap-3">
            {genericProviderEndpoints.map((endpoint) => {
              const healthResult = healthResults[endpoint.id];
              const healthBusy = healthBusyEndpointId === endpoint.id;
              return (
                <div
                  key={endpoint.id}
                  className="grid gap-4 rounded-xl border border-zinc-800 bg-zinc-950/30 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
                      <input
                        type="checkbox"
                        checked={endpoint.enabled}
                        onChange={(event) =>
                          updateEndpoint(endpoint.id, { enabled: event.target.checked })
                        }
                      />
                      Enabled
                    </label>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        icon={Activity}
                        loading={healthBusy}
                        onClick={() => void checkEndpointHealth(endpoint)}
                      >
                        Health
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        title="Remove endpoint"
                        onClick={() => removeEndpoint(endpoint.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {healthResult ? (
                    <div
                      className={`grid gap-1 rounded-lg border px-3 py-2 text-xs ${
                        healthResult.ok
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                          : healthResult.reachable
                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                            : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                      }`}
                    >
                      <div>
                        {healthResult.reachable ? 'Reachable' : 'Unreachable'} /{' '}
                        {healthResult.message}
                      </div>
                      {healthResult.url ? (
                        <div className="truncate text-[11px] opacity-80">
                          {healthResult.url} ({healthResult.durationMs}ms)
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Field
                      id={`${endpoint.id}-name`}
                      label="Name"
                      value={endpoint.name}
                      onChange={(value) => updateEndpoint(endpoint.id, { name: value })}
                    />
                    <SelectField
                      id={`${endpoint.id}-kind`}
                      label="Kind"
                      value={endpoint.kind}
                      options={endpointKindOptions}
                      onChange={(value) =>
                        updateEndpoint(endpoint.id, {
                          kind: value as LlmProviderEndpointKind,
                        })
                      }
                    />
                    {endpoint.kind === 'azure' ? (
                      <>
                        <Field
                          id={`${endpoint.id}-endpoint`}
                          label="Endpoint"
                          value={endpoint.endpoint || ''}
                          onChange={(value) => updateEndpoint(endpoint.id, { endpoint: value })}
                        />
                        <Field
                          id={`${endpoint.id}-api-version`}
                          label="API Version"
                          value={endpoint.apiVersion || ''}
                          onChange={(value) => updateEndpoint(endpoint.id, { apiVersion: value })}
                        />
                      </>
                    ) : null}
                    {endpoint.kind === 'openai' ||
                    endpoint.kind === 'openai-compatible' ||
                    endpoint.kind === 'local' ? (
                      <Field
                        id={`${endpoint.id}-base-url`}
                        label="Base URL"
                        value={endpoint.baseUrl || ''}
                        onChange={(value) => updateEndpoint(endpoint.id, { baseUrl: value })}
                      />
                    ) : null}
                    {endpoint.kind === 'bedrock' ? (
                      <Field
                        id={`${endpoint.id}-region`}
                        label="Region"
                        value={endpoint.region || ''}
                        onChange={(value) => updateEndpoint(endpoint.id, { region: value })}
                      />
                    ) : null}
                    {endpoint.kind !== 'bedrock' ? (
                      <Field
                        id={`${endpoint.id}-api-key`}
                        label="API Key"
                        type="password"
                        value={endpoint.apiKey || ''}
                        onChange={(value) => updateEndpoint(endpoint.id, { apiKey: value })}
                      />
                    ) : null}
                    <Field
                      id={`${endpoint.id}-models`}
                      label="Models"
                      value={endpoint.models.join(', ')}
                      onChange={(value) => {
                        const models = value
                          .split(',')
                          .map((model) => model.trim())
                          .filter(Boolean);
                        updateEndpoint(endpoint.id, {
                          models,
                          modelDisplayNames: pruneModelDisplayNames(
                            endpoint.modelDisplayNames,
                            models
                          ),
                        });
                      }}
                    />
                    <div className="space-y-1.5 md:col-span-2">
                      <label
                        htmlFor={`${endpoint.id}-model-display-names`}
                        className="block text-[11px] font-semibold text-zinc-400"
                      >
                        Model Select Labels
                      </label>
                      <textarea
                        id={`${endpoint.id}-model-display-names`}
                        value={formatModelDisplayNames(endpoint.modelDisplayNames)}
                        onChange={(event) =>
                          updateEndpoint(endpoint.id, {
                            modelDisplayNames: parseModelDisplayNames(event.target.value),
                          })
                        }
                        placeholder="gpt-5.5=Plan High (Codex)"
                        className="min-h-20 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {section === 'routing' ? (
        <section className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Role Routing</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Select model targets. Each option includes the model and its provider endpoint.
            </p>
          </div>
          <div className="grid gap-3">
            {roleRoutes.map((route) => {
              return (
                <div
                  key={route.role}
                  className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-950/30 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold text-zinc-200">
                      {roleLabels[route.role]}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      icon={Plus}
                      onClick={() =>
                        updateRoleRoute(route.role, {
                          fallbacks: [
                            ...route.fallbacks,
                            modelTargetFromKey(modelTargetOptions[0]?.value || ''),
                          ],
                        })
                      }
                    >
                      Fallback
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 items-end gap-2 md:grid-cols-[minmax(0,1fr)_minmax(10rem,12rem)]">
                    <SelectField
                      id={`${route.role}-primary-model-target`}
                      label="Primary Model"
                      value={modelTargetKey(route.primary)}
                      options={
                        modelTargetOptions.length
                          ? modelTargetOptions
                          : [{ value: modelTargetKey(emptyModelTarget), label: 'No model targets' }]
                      }
                      onChange={(value) =>
                        updateRoleRoute(route.role, {
                          primary: withThinkingDepth(
                            modelTargetFromKey(value),
                            route.primary.thinkingDepth || ''
                          ),
                        })
                      }
                    />
                    {isThinkingModel(route.primary.model) ? (
                      <SelectField
                        id={`${route.role}-primary-thinking-depth`}
                        label="Thinking"
                        value={route.primary.thinkingDepth || ''}
                        options={thinkingDepthOptions}
                        onChange={(value) =>
                          updateTargetThinkingDepth(route, 'primary', value as '' | ThinkingDepth)
                        }
                      />
                    ) : null}
                  </div>
                  {route.fallbacks.length ? (
                    <div className="grid gap-2">
                      {route.fallbacks.map((fallback, index) => (
                        <div
                          key={`${route.role}-fallback-${index}`}
                          className="grid grid-cols-1 items-end gap-2 md:grid-cols-[minmax(0,1fr)_minmax(10rem,12rem)_auto_auto_auto]"
                        >
                          <SelectField
                            id={`${route.role}-fallback-${index}`}
                            label={`Fallback ${index + 1}`}
                            value={modelTargetKey(fallback)}
                            options={modelTargetOptionsWithNone}
                            onChange={(value) =>
                              updateFallback(
                                route,
                                index,
                                withThinkingDepth(
                                  modelTargetFromKey(value),
                                  fallback.thinkingDepth || ''
                                )
                              )
                            }
                          />
                          {isThinkingModel(fallback.model) ? (
                            <SelectField
                              id={`${route.role}-fallback-${index}-thinking-depth`}
                              label="Thinking"
                              value={fallback.thinkingDepth || ''}
                              options={thinkingDepthOptions}
                              onChange={(value) =>
                                updateTargetThinkingDepth(
                                  route,
                                  'fallback',
                                  value as '' | ThinkingDepth,
                                  index
                                )
                              }
                            />
                          ) : (
                            <div className="hidden md:block" />
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={index === 0}
                            onClick={() => moveFallback(route, index, -1)}
                          >
                            Up
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={index === route.fallbacks.length - 1}
                            onClick={() => moveFallback(route, index, 1)}
                          >
                            Down
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            title="Remove fallback"
                            onClick={() =>
                              updateRoleRoute(route.role, {
                                fallbacks: route.fallbacks.filter(
                                  (_fallback, fallbackIndex) => fallbackIndex !== index
                                ),
                              })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {section === 'providers' ? (
        <section className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Codex SDK</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Codex login and model options are read from the local Codex configuration.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              icon={RefreshCw}
              disabled={codexStatusLoading}
              onClick={() => void refreshCodexStatus()}
            >
              Refresh
            </Button>
          </div>
          <div className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-950/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={settings.CODEX_ENABLED}
                  onChange={(event) => onChange('CODEX_ENABLED', event.target.checked)}
                />
                Enable Codex SDK
              </label>
              <span
                className={`rounded-full border px-2 py-1 text-[11px] ${
                  codexStatus?.loggedIn
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-400'
                }`}
              >
                {codexStatusLoading
                  ? 'Checking...'
                  : codexStatus?.loggedIn
                    ? `Logged in: ${codexAuthSourceLabel(codexStatus)}`
                    : codexAuthSourceLabel(codexStatus)}
              </span>
            </div>
            {codexStatus ? (
              <div className="grid gap-1 text-[11px] text-zinc-500">
                <div>Codex home: {codexStatus.codexHome}</div>
                <div>
                  Models: {codexStatus.models.length} ({codexStatus.modelSource})
                </div>
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SelectField
              id="codex-model"
              label={t('settings.field.modelName')}
              value={settings.CODEX_MODEL}
              options={
                codexModelOptions.length ? codexModelOptions : [{ value: '', label: 'None' }]
              }
              onChange={(v) => onChange('CODEX_MODEL', v)}
            />
            <Field
              id="codex-access-token"
              label="Access Token Override"
              type="password"
              value={settings.CODEX_ACCESS_TOKEN}
              onChange={(v) => onChange('CODEX_ACCESS_TOKEN', v)}
            />
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-zinc-800/80 border-t pt-4">
        {saveMessage ? (
          <div
            role={saveStatus === 'error' ? 'alert' : 'status'}
            className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
              saveStatus === 'success'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
            }`}
          >
            {saveStatus === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 shrink-0" />
            )}
            <span>{saveMessage}</span>
          </div>
        ) : (
          <span />
        )}
        <Button
          type="button"
          onClick={() => void handleSave()}
          disabled={isSaving}
          variant={saveStatus === 'success' ? 'success' : 'default'}
          className="h-9 gap-2 px-5 text-xs"
        >
          {isSaving ? <RefreshCw className="h-3 w-3 animate-spin" /> : null}
          {saveStatus === 'success' && !isSaving ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
          {isSaving
            ? t('settings.saving')
            : saveStatus === 'success'
              ? t('settings.saved')
              : t('settings.saveAll')}
        </Button>
      </div>
    </div>
  );
}
