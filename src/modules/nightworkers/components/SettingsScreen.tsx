import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/design-system';
import {
  Bot,
  ExternalLink,
  Globe,
  ListTodo,
  Palette,
  PlugZap,
  RefreshCw,
  type Settings,
  Trash2,
  Workflow,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useWorkspaceAppearanceActions,
  useWorkspaceAppearanceState,
} from '../contexts/WorkspaceAppearanceContext';
import type { NightWorkersWorkspaceState } from '../hooks/useNightWorkersWorkspace';
import { applyNightWorkersLanguage } from '../i18n/NightWorkersI18nProvider';
import {
  type AgentHookConfig,
  type AgentHookEvent,
  type AgentHookInput,
  type GeneralSettings,
  type LlmProvider,
  type LlmSettings,
  type McpServerConfig,
  type McpServerInput,
  type McpServerTransport,
  PROVIDER_MODEL_OPTIONS,
} from '../types';
import {
  type BlueprintPreviewDesignSettings,
  blueprintPreviewDesignOptions,
} from './blueprint-preview/designSettings';

const defaultSettings: LlmSettings = {
  ACTIVE_LLM_PROVIDER: 'azure',
  OPENAI_ENABLED: true,
  AZURE_OPENAI_ENABLED: false,
  AZURE_OPENAI_API_KEY: '',
  AZURE_OPENAI_ENDPOINT: '',
  AZURE_OPENAI_DEPLOYMENT_NAME: 'gpt-5-mini',
  AZURE_OPENAI_API_VERSION: '2024-05-01-preview',
  AWS_BEDROCK_ENABLED: false,
  AWS_ACCESS_KEY_ID: '',
  AWS_SECRET_ACCESS_KEY: '',
  AWS_REGION: 'us-east-1',
  AWS_BEDROCK_MODEL: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  OPENAI_API_KEY: '',
  OPENAI_BASE_URL: 'https://api.openai.com/v1',
  OPENAI_MODEL: 'gpt-4o-mini',
  CODEX_ENABLED: false,
  CODEX_ACCESS_TOKEN: '',
  CODEX_MODEL: 'gpt-5.5',
  SESSION_QUEUE_MAX_CONCURRENCY: 2,
};

type McpServerForm = {
  id?: string;
  name: string;
  enabled: boolean;
  transport: McpServerTransport;
  command: string;
  argsText: string;
  url: string;
  cwd: string;
  envText: string;
  toolPrefix: string;
};

type AgentHookForm = {
  id?: string;
  name: string;
  enabled: boolean;
  event: AgentHookEvent;
  matcher: string;
  handlerType: 'command' | 'http';
  command: string;
  argsText: string;
  cwd: string;
  envText: string;
  url: string;
  headersText: string;
  timeoutSeconds: number;
  failClosed: boolean;
};

type SettingsSectionId = 'general' | 'appearance' | 'llm' | 'hooks' | 'mcp' | 'todo';

const defaultGeneralSettings: GeneralSettings = {
  timezone: 'Asia/Tokyo',
  language: 'ja',
  currency: 'JPY',
  fx: {
    source: 'ecb',
    autoRefresh: true,
    lastRefreshedAt: null,
  },
};

const emptyMcpForm: McpServerForm = {
  name: '',
  enabled: true,
  transport: 'stdio',
  command: '',
  argsText: '',
  url: '',
  cwd: '',
  envText: '',
  toolPrefix: '',
};

const emptyHookForm: AgentHookForm = {
  name: '',
  enabled: true,
  event: 'PreToolUse',
  matcher: '*',
  handlerType: 'command',
  command: '',
  argsText: '',
  cwd: '',
  envText: '',
  url: '',
  headersText: '',
  timeoutSeconds: 30,
  failClosed: true,
};

const hookEventOptions: Array<{ value: AgentHookEvent; label: string }> = [
  { value: 'SessionStart', label: 'SessionStart' },
  { value: 'UserPromptSubmit', label: 'UserPromptSubmit' },
  { value: 'PreToolUse', label: 'PreToolUse' },
  { value: 'PostToolUse', label: 'PostToolUse' },
  { value: 'PostToolUseFailure', label: 'PostToolUseFailure' },
  { value: 'Stop', label: 'Stop' },
  { value: 'SessionEnd', label: 'SessionEnd' },
];

const settingsSections: Array<{
  id: SettingsSectionId;
  labelKey: string;
  descriptionKey: string;
  icon: typeof Settings;
}> = [
  {
    id: 'general',
    labelKey: 'settings.section.general',
    descriptionKey: 'settings.section.generalDescription',
    icon: Globe,
  },
  {
    id: 'appearance',
    labelKey: 'settings.section.appearance',
    descriptionKey: 'settings.section.appearanceDescription',
    icon: Palette,
  },
  {
    id: 'llm',
    labelKey: 'settings.section.llm',
    descriptionKey: 'settings.section.llmDescription',
    icon: Bot,
  },
  {
    id: 'hooks',
    labelKey: 'settings.section.hooks',
    descriptionKey: 'settings.section.hooksDescription',
    icon: Workflow,
  },
  {
    id: 'mcp',
    labelKey: 'settings.section.mcp',
    descriptionKey: 'settings.section.mcpDescription',
    icon: PlugZap,
  },
  {
    id: 'todo',
    labelKey: 'settings.section.todo',
    descriptionKey: 'settings.section.todoDescription',
    icon: ListTodo,
  },
];

function parseKeyValueText(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [key, ...rest] = line.split('=');
        return [key.trim(), rest.join('=').trim()];
      })
      .filter(([key]) => key)
  );
}

function formFromMcpServer(server: McpServerConfig): McpServerForm {
  return {
    id: server.id,
    name: server.name,
    enabled: server.enabled,
    transport: server.transport,
    command: server.command || '',
    argsText: server.args.join(' '),
    url: server.url || '',
    cwd: server.cwd || '',
    envText: Object.entries(server.env)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
    toolPrefix: server.toolPrefix,
  };
}

function formFromAgentHook(hook: AgentHookConfig): AgentHookForm {
  if (hook.handler.type === 'command') {
    return {
      id: hook.id,
      name: hook.name,
      enabled: hook.enabled,
      event: hook.event,
      matcher: hook.matcher || '*',
      handlerType: 'command',
      command: hook.handler.command,
      argsText: (hook.handler.args || []).join(' '),
      cwd: hook.handler.cwd || '',
      envText: Object.entries(hook.handler.env || {})
        .map(([key, value]) => `${key}=${value}`)
        .join('\n'),
      url: '',
      headersText: '',
      timeoutSeconds: hook.handler.timeoutSeconds || 30,
      failClosed: hook.handler.failClosed ?? hook.event === 'PreToolUse',
    };
  }
  return {
    id: hook.id,
    name: hook.name,
    enabled: hook.enabled,
    event: hook.event,
    matcher: hook.matcher || '*',
    handlerType: hook.handler.type,
    command: '',
    argsText: '',
    cwd: '',
    envText: '',
    url: hook.handler.url,
    headersText: Object.entries(hook.handler.headers || {})
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
    timeoutSeconds: hook.handler.timeoutSeconds || 30,
    failClosed: hook.handler.failClosed ?? false,
  };
}

function hookFormToInput(form: AgentHookForm): AgentHookInput {
  const matcher =
    form.event === 'PreToolUse' ||
    form.event === 'PostToolUse' ||
    form.event === 'PostToolUseFailure'
      ? form.matcher.trim() || '*'
      : undefined;
  return {
    name: form.name.trim(),
    enabled: form.enabled,
    event: form.event,
    matcher,
    handler:
      form.handlerType === 'command'
        ? {
            type: 'command',
            command: form.command.trim(),
            args: form.argsText.split(/\s+/).filter(Boolean),
            cwd: form.cwd.trim() || undefined,
            env: parseKeyValueText(form.envText),
            timeoutSeconds: form.timeoutSeconds,
            failClosed: form.failClosed,
          }
        : {
            type: 'http',
            url: form.url.trim(),
            headers: parseKeyValueText(form.headersText),
            timeoutSeconds: form.timeoutSeconds,
            failClosed: form.failClosed,
          },
  };
}

function mcpFormToInput(form: McpServerForm): McpServerInput {
  const env = Object.fromEntries(
    form.envText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [key, ...rest] = line.split('=');
        return [key.trim(), rest.join('=').trim()];
      })
      .filter(([key]) => key)
  );
  return {
    name: form.name.trim(),
    enabled: form.enabled,
    transport: form.transport,
    command: form.command.trim() || undefined,
    args: form.argsText.split(/\s+/).filter(Boolean),
    url: form.url.trim() || undefined,
    cwd: form.cwd.trim() || undefined,
    env,
    toolPrefix: form.toolPrefix.trim(),
  };
}

export function SettingsScreen({
  onClose,
  workspace,
}: {
  onClose: () => void;
  workspace: NightWorkersWorkspaceState;
}) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<LlmSettings>(defaultSettings);
  const [generalSettings, setGeneralSettings] = useState<GeneralSettings>(defaultGeneralSettings);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [generalMessage, setGeneralMessage] = useState('');
  const [isRefreshingFx, setIsRefreshingFx] = useState(false);
  const [smokeResult, setSmokeResult] = useState<{
    provider: LlmProvider;
    message: string;
  } | null>(null);
  const [smokingProvider, setSmokingProvider] = useState<LlmProvider | null>(null);
  const [mcpForm, setMcpForm] = useState<McpServerForm>(emptyMcpForm);
  const [mcpPasteText, setMcpPasteText] = useState('');
  const [mcpMessage, setMcpMessage] = useState<string>('');
  const [mcpBusy, setMcpBusy] = useState(false);
  const [hookForm, setHookForm] = useState<AgentHookForm>(emptyHookForm);
  const [hookMessage, setHookMessage] = useState<string>('');
  const [hookBusy, setHookBusy] = useState(false);
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>('general');
  const { settings: appearanceSettings } = useWorkspaceAppearanceState();
  const { setAppearanceSettings, resetAppearanceSettings } = useWorkspaceAppearanceActions();

  const activeSectionMeta =
    settingsSections.find((section) => section.id === activeSettingsSection) || settingsSections[0];
  const ActiveSectionIcon = activeSectionMeta.icon;

  useEffect(() => {
    Promise.all([
      fetch('/api/settings/llm').then((res) => res.json()),
      fetch('/api/settings/general').then((res) => res.json()),
    ])
      .then(([llmData, generalData]: [Partial<LlmSettings>, Partial<GeneralSettings>]) => {
        setSettings({ ...defaultSettings, ...llmData });
        setGeneralSettings({
          ...defaultGeneralSettings,
          ...generalData,
          fx: { ...defaultGeneralSettings.fx, ...generalData.fx },
        });
      })
      .finally(() => setIsLoading(false));
  }, []);

  const handleSave = async (providerOverride?: LlmProvider) => {
    setIsSaving(true);
    const updated = {
      ...settings,
      ACTIVE_LLM_PROVIDER: providerOverride ?? settings.ACTIVE_LLM_PROVIDER,
    };
    const res = await fetch('/api/settings/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    if (res.ok) {
      setSettings(updated);
    } else {
      alert('設定の保存に失敗しました');
    }
    setIsSaving(false);
  };

  const runProviderSmokeTest = async (provider: LlmProvider) => {
    setSmokingProvider(provider);
    setSmokeResult(null);
    const updated = {
      ...settings,
      ACTIVE_LLM_PROVIDER: provider,
    };
    try {
      const saveRes = await fetch('/api/settings/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (!saveRes.ok) throw new Error('設定の保存に失敗しました');
      setSettings(updated);
      const result = await workspace.runLlmSmokeTest();
      setSmokeResult({
        provider,
        message: `${result.provider}: ${result.ok ? 'OK' : 'NG'} ${result.message}`,
      });
    } catch (err) {
      setSmokeResult({
        provider,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSmokingProvider(null);
    }
  };

  const onChange = <K extends keyof LlmSettings>(key: K, value: LlmSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const saveGeneralSettings = async () => {
    setGeneralMessage('');
    const res = await fetch('/api/settings/general', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(generalSettings),
    });
    if (!res.ok) {
      setGeneralMessage(t('settings.general.saveFailed'));
      return;
    }
    const saved = (await res.json()) as GeneralSettings;
    setGeneralSettings(saved);
    void applyNightWorkersLanguage(saved.language);
    setGeneralMessage(t('settings.general.saveSucceeded'));
  };

  const refreshFxRates = async () => {
    setIsRefreshingFx(true);
    setGeneralMessage('');
    try {
      const res = await fetch('/api/settings/fx/refresh', { method: 'POST' });
      if (!res.ok) {
        throw new Error(t('settings.general.exchangeRefreshFailed', { status: res.status }));
      }
      const cache = (await res.json()) as { fetchedAt: string };
      setGeneralSettings((prev) => ({
        ...prev,
        fx: { ...prev.fx, source: 'ecb', lastRefreshedAt: cache.fetchedAt },
      }));
      setGeneralMessage(t('settings.general.exchangeRefreshSucceeded'));
    } catch (err) {
      setGeneralMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRefreshingFx(false);
    }
  };

  const setProviderEnabled = (provider: LlmProvider, enabled: boolean) => {
    if (provider === 'openai') onChange('OPENAI_ENABLED', enabled);
    if (provider === 'azure') onChange('AZURE_OPENAI_ENABLED', enabled);
    if (provider === 'bedrock') onChange('AWS_BEDROCK_ENABLED', enabled);
    if (provider === 'codex') onChange('CODEX_ENABLED', enabled);
    void workspace.toggleProviderEnabled(provider, enabled);
  };

  const saveMcpServer = async () => {
    setMcpBusy(true);
    setMcpMessage('');
    try {
      const input = mcpFormToInput(mcpForm);
      const saved = mcpForm.id
        ? await workspace.updateMcpServer(mcpForm.id, input)
        : await workspace.createMcpServer(input);
      setMcpForm(formFromMcpServer(saved));
      if (!saved.enabled) {
        setMcpMessage('MCP Server を保存しました。OFF のため疎通テストはスキップしました');
        return;
      }
      const result = await workspace.testMcpServer(saved.id);
      setMcpMessage(
        `MCP Server を保存しました。疎通テスト: ${result.ok ? 'OK' : 'NG'} ${result.message}`
      );
    } catch (err) {
      setMcpMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setMcpBusy(false);
    }
  };

  const importMcpServers = async () => {
    setMcpBusy(true);
    setMcpMessage('');
    try {
      const result = await workspace.importMcpServers(mcpPasteText, true);
      const okCount = result.results.filter((item) => item.ok).length;
      const ngCount = result.results.length - okCount;
      if (result.servers[0]) {
        setMcpForm(formFromMcpServer(result.servers[0]));
      }
      setMcpPasteText('');
      setMcpMessage(
        `MCP Server ${result.servers.length}件を取り込みました。疎通テスト: ${okCount} OK${
          ngCount > 0 ? ` / ${ngCount} NG` : ''
        }`
      );
    } catch (err) {
      setMcpMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setMcpBusy(false);
    }
  };

  const toggleMcpServer = async (server: McpServerConfig, enabled: boolean) => {
    setMcpBusy(true);
    setMcpMessage('');
    try {
      const updated = await workspace.updateMcpServer(server.id, { enabled });
      if (mcpForm.id === server.id) {
        setMcpForm((prev) => ({ ...prev, enabled: updated.enabled }));
      }
      if (!updated.enabled) {
        setMcpMessage(`${updated.name} をOFFにしました`);
        return;
      }
      const result = await workspace.testMcpServer(updated.id);
      setMcpMessage(
        `${updated.name} をONにしました。疎通テスト: ${result.ok ? 'OK' : 'NG'} ${result.message}`
      );
    } catch (err) {
      setMcpMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setMcpBusy(false);
    }
  };

  const testMcpServer = async (id: string) => {
    setMcpBusy(true);
    setMcpMessage('');
    try {
      const result = await workspace.testMcpServer(id);
      setMcpMessage(`${result.ok ? 'OK' : 'NG'} ${result.message}`);
    } catch (err) {
      setMcpMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setMcpBusy(false);
    }
  };

  const saveAgentHook = async () => {
    setHookBusy(true);
    setHookMessage('');
    try {
      const input = hookFormToInput(hookForm);
      if (hookForm.id) {
        await workspace.updateAgentHook(hookForm.id, input);
        setHookMessage('Agent Hook を更新しました');
      } else {
        const created = await workspace.createAgentHook(input);
        setHookForm(formFromAgentHook(created));
        setHookMessage('Agent Hook を追加しました');
      }
    } catch (err) {
      setHookMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setHookBusy(false);
    }
  };

  const testAgentHook = async (id: string) => {
    setHookBusy(true);
    setHookMessage('');
    try {
      const result = await workspace.testAgentHook(id);
      setHookMessage(`${result.ok ? 'OK' : 'NG'} ${result.message}`);
    } catch (err) {
      setHookMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setHookBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#121214] text-zinc-500">
        設定をロード中...
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-[#121214]">
      <aside className="nightworkers-settings-menu flex w-64 shrink-0 flex-col border-zinc-800 border-r bg-[#16161a] p-4">
        <button
          type="button"
          onClick={onClose}
          className="mb-5 inline-flex items-center gap-2 rounded-lg border border-zinc-700/50 bg-zinc-800 px-3 py-2 text-left text-xs text-zinc-300"
        >
          ← {t('settings.backToApp')}
        </button>
        <div className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          {t('settings.title')}
        </div>
        <nav className="grid gap-1" aria-label={t('settings.sections')}>
          {settingsSections.map((section) => {
            const Icon = section.icon;
            const active = activeSettingsSection === section.id;
            return (
              <button
                key={section.id}
                type="button"
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-xs ${
                  active
                    ? 'border-indigo-500/70 bg-indigo-500/15 text-zinc-100'
                    : 'border-transparent text-zinc-400 hover:border-zinc-800 hover:bg-zinc-900/60 hover:text-zinc-200'
                }`}
                aria-current={active ? 'page' : undefined}
                onClick={() => setActiveSettingsSection(section.id)}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block font-semibold">{t(section.labelKey)}</span>
                  <span className="block truncate text-[10px] opacity-70">
                    {t(section.descriptionKey)}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-4xl space-y-6">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
            <h1 className="flex items-center gap-2 text-xl font-bold text-zinc-100">
              <ActiveSectionIcon className="h-5 w-5 text-indigo-400" />
              {t(activeSectionMeta.labelKey)}
            </h1>
            <p className="text-xs text-zinc-500">{t(activeSectionMeta.descriptionKey)}</p>
          </div>

          {activeSettingsSection === 'general' ? (
            <GeneralSettingsPanel
              value={generalSettings}
              message={generalMessage}
              isRefreshingFx={isRefreshingFx}
              onChange={setGeneralSettings}
              onSave={() => void saveGeneralSettings()}
              onRefreshFx={() => void refreshFxRates()}
            />
          ) : null}

          {activeSettingsSection === 'appearance' ? (
            <AppearanceSettings
              value={appearanceSettings}
              onChange={setAppearanceSettings}
              onReset={resetAppearanceSettings}
            />
          ) : null}

          {activeSettingsSection === 'llm' ? (
            <div className="grid gap-4">
              <section className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
                <ProviderSectionHeader
                  provider="azure"
                  title="Azure OpenAI"
                  active={settings.ACTIVE_LLM_PROVIDER === 'azure'}
                  enabled={settings.AZURE_OPENAI_ENABLED}
                  isSaving={isSaving}
                  onEnabledChange={(enabled) => setProviderEnabled('azure', enabled)}
                  onActivate={() => void handleSave('azure')}
                  smokeBusy={smokingProvider === 'azure'}
                  smokeResult={smokeResult?.provider === 'azure' ? smokeResult.message : ''}
                  onSmoke={() => void runProviderSmokeTest('azure')}
                />
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field
                    id="azure-api-key"
                    label={t('settings.field.apiKey')}
                    type="password"
                    value={settings.AZURE_OPENAI_API_KEY}
                    onChange={(v) => onChange('AZURE_OPENAI_API_KEY', v)}
                  />
                  <Field
                    id="azure-endpoint"
                    label={t('settings.field.endpointUrl')}
                    value={settings.AZURE_OPENAI_ENDPOINT}
                    onChange={(v) => onChange('AZURE_OPENAI_ENDPOINT', v)}
                  />
                  <Field
                    id="azure-deployment"
                    label={t('settings.field.deploymentName')}
                    value={settings.AZURE_OPENAI_DEPLOYMENT_NAME}
                    onChange={(v) => onChange('AZURE_OPENAI_DEPLOYMENT_NAME', v)}
                  />
                  <Field
                    id="azure-version"
                    label={t('settings.field.apiVersion')}
                    value={settings.AZURE_OPENAI_API_VERSION}
                    onChange={(v) => onChange('AZURE_OPENAI_API_VERSION', v)}
                  />
                </div>
              </section>

              <section className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
                <ProviderSectionHeader
                  provider="openai"
                  title={t('settings.provider.openaiOfficial')}
                  active={settings.ACTIVE_LLM_PROVIDER === 'openai'}
                  enabled={settings.OPENAI_ENABLED}
                  isSaving={isSaving}
                  onEnabledChange={(enabled) => setProviderEnabled('openai', enabled)}
                  onActivate={() => void handleSave('openai')}
                  smokeBusy={smokingProvider === 'openai'}
                  smokeResult={smokeResult?.provider === 'openai' ? smokeResult.message : ''}
                  onSmoke={() => void runProviderSmokeTest('openai')}
                />
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field
                    id="openai-api-key"
                    label={t('settings.field.apiKey')}
                    type="password"
                    value={settings.OPENAI_API_KEY}
                    onChange={(v) => onChange('OPENAI_API_KEY', v)}
                  />
                  <Field
                    id="openai-base-url"
                    label={t('settings.field.baseUrl')}
                    value={settings.OPENAI_BASE_URL}
                    onChange={(v) => onChange('OPENAI_BASE_URL', v)}
                  />
                  <Field
                    id="openai-model"
                    label={t('settings.field.modelName')}
                    value={settings.OPENAI_MODEL}
                    onChange={(v) => onChange('OPENAI_MODEL', v)}
                  />
                </div>
              </section>

              <section className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
                <ProviderSectionHeader
                  provider="bedrock"
                  title="AWS Bedrock"
                  active={settings.ACTIVE_LLM_PROVIDER === 'bedrock'}
                  enabled={settings.AWS_BEDROCK_ENABLED}
                  isSaving={isSaving}
                  onEnabledChange={(enabled) => setProviderEnabled('bedrock', enabled)}
                  onActivate={() => void handleSave('bedrock')}
                  smokeBusy={smokingProvider === 'bedrock'}
                  smokeResult={smokeResult?.provider === 'bedrock' ? smokeResult.message : ''}
                  onSmoke={() => void runProviderSmokeTest('bedrock')}
                />
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field
                    id="aws-access-key"
                    label={t('settings.field.awsAccessKeyId')}
                    value={settings.AWS_ACCESS_KEY_ID}
                    onChange={(v) => onChange('AWS_ACCESS_KEY_ID', v)}
                  />
                  <Field
                    id="aws-secret-key"
                    label={t('settings.field.awsSecretAccessKey')}
                    type="password"
                    value={settings.AWS_SECRET_ACCESS_KEY}
                    onChange={(v) => onChange('AWS_SECRET_ACCESS_KEY', v)}
                  />
                  <Field
                    id="aws-region"
                    label={t('settings.field.awsRegion')}
                    value={settings.AWS_REGION}
                    onChange={(v) => onChange('AWS_REGION', v)}
                  />
                  <Field
                    id="aws-model"
                    label={t('settings.field.bedrockModelId')}
                    value={settings.AWS_BEDROCK_MODEL}
                    onChange={(v) => onChange('AWS_BEDROCK_MODEL', v)}
                  />
                </div>
              </section>

              <section className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
                <ProviderSectionHeader
                  provider="codex"
                  title="Codex SDK"
                  active={settings.ACTIVE_LLM_PROVIDER === 'codex'}
                  enabled={settings.CODEX_ENABLED}
                  isSaving={isSaving}
                  onEnabledChange={(enabled) => setProviderEnabled('codex', enabled)}
                  onActivate={() => void handleSave('codex')}
                  smokeBusy={smokingProvider === 'codex'}
                  smokeResult={smokeResult?.provider === 'codex' ? smokeResult.message : ''}
                  onSmoke={() => void runProviderSmokeTest('codex')}
                />
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field
                    id="codex-token"
                    label={t('settings.field.codexAccessToken')}
                    type="password"
                    value={settings.CODEX_ACCESS_TOKEN}
                    onChange={(v) => onChange('CODEX_ACCESS_TOKEN', v)}
                  />
                  <SelectField
                    id="codex-model"
                    label={t('settings.field.codexModelId')}
                    value={settings.CODEX_MODEL}
                    options={PROVIDER_MODEL_OPTIONS.codex}
                    onChange={(v) => onChange('CODEX_MODEL', v)}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-zinc-100">
                      {t('settings.codexLogin.title')}
                    </div>
                    <p className="mt-1 text-[10px] leading-4 text-zinc-500">
                      {t('settings.codexLogin.description')}
                    </p>
                  </div>
                  <a
                    href="https://chatgpt.com/auth/login"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-zinc-700/70 bg-zinc-800 px-3 text-xs text-zinc-200 hover:border-indigo-500/70 hover:text-zinc-100"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t('settings.codexLogin.open')}
                  </a>
                </div>
              </section>

              <div className="flex justify-end border-zinc-800/80 border-t pt-4">
                <Button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={isSaving}
                  className="h-9 px-5 text-xs"
                >
                  {isSaving ? <RefreshCw className="h-3 w-3 animate-spin" /> : null}
                  {isSaving ? t('settings.saving') : t('settings.saveAll')}
                </Button>
              </div>
            </div>
          ) : null}

          {activeSettingsSection === 'hooks' ? (
            <div className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
                    <Workflow className="h-4 w-4 text-cyan-400" />
                    {t('settings.hooks.title')}
                  </h2>
                  <p className="mt-1 text-xs text-zinc-500">{t('settings.hooks.description')}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setHookForm(emptyHookForm);
                    setHookMessage('');
                  }}
                  className="h-9 px-4 text-xs"
                >
                  {t('settings.hooks.add')}
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr]">
                <div className="space-y-2">
                  {workspace.agentHooks.length === 0 ? (
                    <p className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-xs text-zinc-500">
                      {t('settings.hooks.empty')}
                    </p>
                  ) : (
                    workspace.agentHooks.map((hook) => (
                      <button
                        key={hook.id}
                        type="button"
                        onClick={() => {
                          setHookForm(formFromAgentHook(hook));
                          setHookMessage('');
                        }}
                        className={`w-full rounded-lg border p-3 text-left text-xs ${
                          hookForm.id === hook.id
                            ? 'border-cyan-500/60 bg-cyan-500/10 text-cyan-100'
                            : 'border-zinc-800 bg-zinc-900/60 text-zinc-300'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-semibold">{hook.name}</span>
                          <span className={hook.enabled ? 'text-emerald-300' : 'text-zinc-500'}>
                            {hook.enabled
                              ? t('settings.hooks.enabled')
                              : t('settings.hooks.paused')}
                          </span>
                        </div>
                        <div className="mt-1 truncate text-[10px] text-zinc-500">
                          {hook.event} / {hook.matcher || '*'} / {hook.handler.type}
                        </div>
                        {hook.lastRun ? (
                          <div className="mt-1 truncate text-[10px] text-zinc-500">
                            {hook.lastRun.ok ? 'OK' : 'NG'}: {hook.lastRun.message}
                          </div>
                        ) : null}
                      </button>
                    ))
                  )}
                </div>

                <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Field
                      id="hook-name"
                      label={t('settings.field.name')}
                      value={hookForm.name}
                      onChange={(value) => setHookForm((prev) => ({ ...prev, name: value }))}
                    />
                    <SelectField
                      id="hook-event"
                      label={t('settings.field.event')}
                      value={hookForm.event}
                      options={hookEventOptions}
                      onChange={(value) =>
                        setHookForm((prev) => ({
                          ...prev,
                          event: value as AgentHookEvent,
                        }))
                      }
                    />
                    <SelectField
                      id="hook-handler"
                      label={t('settings.field.handler')}
                      value={hookForm.handlerType}
                      options={[
                        { value: 'command', label: 'Command' },
                        { value: 'http', label: 'HTTP' },
                      ]}
                      onChange={(value) =>
                        setHookForm((prev) => ({
                          ...prev,
                          handlerType: value as 'command' | 'http',
                        }))
                      }
                    />
                    <Field
                      id="hook-matcher"
                      label={t('settings.field.matcher')}
                      value={hookForm.matcher}
                      onChange={(value) => setHookForm((prev) => ({ ...prev, matcher: value }))}
                    />
                    <NumberField
                      id="hook-timeout"
                      label={t('settings.field.timeoutSeconds')}
                      value={hookForm.timeoutSeconds}
                      min={1}
                      onChange={(value) =>
                        setHookForm((prev) => ({ ...prev, timeoutSeconds: Math.min(value, 120) }))
                      }
                    />
                    <label className="flex items-end gap-2 pb-2 text-xs text-zinc-300">
                      <input
                        type="checkbox"
                        checked={hookForm.enabled}
                        onChange={(event) =>
                          setHookForm((prev) => ({ ...prev, enabled: event.target.checked }))
                        }
                      />
                      {t('settings.hooks.enabled')}
                    </label>
                    <label className="flex items-end gap-2 pb-2 text-xs text-zinc-300">
                      <input
                        type="checkbox"
                        checked={hookForm.failClosed}
                        onChange={(event) =>
                          setHookForm((prev) => ({ ...prev, failClosed: event.target.checked }))
                        }
                      />
                      {t('settings.hooks.failClosed')}
                    </label>
                  </div>

                  {hookForm.handlerType === 'command' ? (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <Field
                        id="hook-command"
                        label={t('settings.field.command')}
                        value={hookForm.command}
                        onChange={(value) => setHookForm((prev) => ({ ...prev, command: value }))}
                      />
                      <Field
                        id="hook-args"
                        label={t('settings.field.args')}
                        value={hookForm.argsText}
                        onChange={(value) => setHookForm((prev) => ({ ...prev, argsText: value }))}
                      />
                      <Field
                        id="hook-cwd"
                        label={t('settings.field.cwd')}
                        value={hookForm.cwd}
                        onChange={(value) => setHookForm((prev) => ({ ...prev, cwd: value }))}
                      />
                      <div className="space-y-1.5">
                        <label
                          htmlFor="hook-env"
                          className="block text-[11px] font-semibold text-zinc-400"
                        >
                          {t('settings.field.nonSecretEnv')}
                        </label>
                        <textarea
                          id="hook-env"
                          value={hookForm.envText}
                          onChange={(event) =>
                            setHookForm((prev) => ({ ...prev, envText: event.target.value }))
                          }
                          rows={3}
                          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100"
                          placeholder={t('settings.placeholder.keyValue')}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <Field
                        id="hook-url"
                        label={t('settings.field.url')}
                        value={hookForm.url}
                        onChange={(value) => setHookForm((prev) => ({ ...prev, url: value }))}
                      />
                      <div className="space-y-1.5">
                        <label
                          htmlFor="hook-headers"
                          className="block text-[11px] font-semibold text-zinc-400"
                        >
                          {t('settings.field.nonSecretHeaders')}
                        </label>
                        <textarea
                          id="hook-headers"
                          value={hookForm.headersText}
                          onChange={(event) =>
                            setHookForm((prev) => ({ ...prev, headersText: event.target.value }))
                          }
                          rows={3}
                          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100"
                          placeholder="X-Hook-Source=nightworkers"
                        />
                      </div>
                    </div>
                  )}

                  <p className="text-[10px] text-zinc-500">{t('settings.hooks.note')}</p>
                  <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-800 pt-4">
                    {hookForm.id ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => void testAgentHook(hookForm.id as string)}
                          disabled={hookBusy}
                          className="h-9 px-4 text-xs"
                        >
                          {t('settings.hooks.test')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={async () => {
                            if (!hookForm.id) return;
                            setHookBusy(true);
                            await workspace.deleteAgentHook(hookForm.id);
                            setHookForm(emptyHookForm);
                            setHookMessage('Agent Hook を削除しました');
                            setHookBusy(false);
                          }}
                          disabled={hookBusy}
                          className="h-9 px-4 text-xs text-red-300"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {t('settings.hooks.delete')}
                        </Button>
                      </>
                    ) : null}
                    <Button
                      type="button"
                      onClick={() => void saveAgentHook()}
                      disabled={hookBusy}
                      className="h-9 px-5 text-xs"
                    >
                      {hookBusy ? <RefreshCw className="h-3 w-3 animate-spin" /> : null}
                      {hookForm.id ? t('settings.hooks.update') : t('settings.hooks.add')}
                    </Button>
                  </div>
                  {hookMessage ? <p className="text-xs text-zinc-400">{hookMessage}</p> : null}
                </div>
              </div>
            </div>
          ) : null}

          {activeSettingsSection === 'mcp' ? (
            <div className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
                    <PlugZap className="h-4 w-4 text-emerald-400" />
                    {t('settings.mcp.title')}
                  </h2>
                  <p className="mt-1 text-xs text-zinc-500">{t('settings.mcp.description')}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setMcpForm(emptyMcpForm);
                    setMcpMessage('');
                  }}
                  className="h-9 px-4 text-xs"
                >
                  {t('settings.mcp.add')}
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr]">
                <div className="space-y-2">
                  {workspace.mcpServers.length === 0 ? (
                    <p className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-xs text-zinc-500">
                      {t('settings.mcp.empty')}
                    </p>
                  ) : (
                    workspace.mcpServers.map((server) => (
                      <div
                        key={server.id}
                        className={`grid grid-cols-[1fr_auto] items-center gap-2 rounded-lg border p-3 text-xs ${
                          mcpForm.id === server.id
                            ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-100'
                            : 'border-zinc-800 bg-zinc-900/60 text-zinc-300'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setMcpForm(formFromMcpServer(server));
                            setMcpMessage('');
                          }}
                          className="min-w-0 text-left"
                        >
                          <div className="truncate font-semibold">{server.name}</div>
                          <div className="mt-1 truncate text-[10px] text-zinc-500">
                            {server.transport} / {server.toolPrefix}
                          </div>
                          {server.lastStatus ? (
                            <div className="mt-1 truncate text-[10px] text-zinc-500">
                              {server.lastStatus.ok ? 'OK' : 'NG'}: {server.lastStatus.message}
                            </div>
                          ) : null}
                        </button>
                        <label className="inline-flex cursor-pointer items-center gap-2 text-[10px] text-zinc-500">
                          <span>{server.enabled ? 'ON' : 'OFF'}</span>
                          <input
                            type="checkbox"
                            className="peer sr-only"
                            checked={server.enabled}
                            disabled={mcpBusy}
                            onChange={(event) =>
                              void toggleMcpServer(server, event.currentTarget.checked)
                            }
                          />
                          <span
                            className={`relative h-5 w-9 rounded-full transition peer-disabled:opacity-50 ${
                              server.enabled ? 'bg-emerald-500' : 'bg-zinc-700'
                            }`}
                          >
                            <span
                              className={`absolute top-1 h-3 w-3 rounded-full bg-white transition ${
                                server.enabled ? 'left-5' : 'left-1'
                              }`}
                            />
                          </span>
                        </label>
                      </div>
                    ))
                  )}
                </div>

                <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
                  <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-xs font-semibold text-zinc-200">
                          {t('settings.mcp.pasteConfig')}
                        </h3>
                        <p className="mt-1 text-[10px] text-zinc-500">
                          {t('settings.mcp.pasteDescription')}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => void importMcpServers()}
                        disabled={mcpBusy || mcpPasteText.trim().length === 0}
                        className="h-8 px-3 text-xs"
                      >
                        {mcpBusy ? <RefreshCw className="h-3 w-3 animate-spin" /> : null}
                        {t('settings.mcp.importTest')}
                      </Button>
                    </div>
                    <textarea
                      value={mcpPasteText}
                      onChange={(event) => setMcpPasteText(event.target.value)}
                      rows={7}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100"
                      placeholder={
                        '{\n  "mcpServers": {\n    "local_docs": {\n      "command": "node",\n      "args": ["server.js"]\n    }\n  }\n}'
                      }
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Field
                      id="mcp-name"
                      label={t('settings.field.name')}
                      value={mcpForm.name}
                      onChange={(value) => setMcpForm((prev) => ({ ...prev, name: value }))}
                    />
                    <Field
                      id="mcp-prefix"
                      label={t('settings.field.toolPrefix')}
                      value={mcpForm.toolPrefix}
                      onChange={(value) => setMcpForm((prev) => ({ ...prev, toolPrefix: value }))}
                    />
                    <SelectField
                      id="mcp-transport"
                      label={t('settings.field.transport')}
                      value={mcpForm.transport}
                      options={[
                        { value: 'stdio', label: 'stdio' },
                        { value: 'sse', label: 'SSE (legacy)' },
                        { value: 'streamable_http', label: 'Streamable HTTP' },
                      ]}
                      onChange={(value) =>
                        setMcpForm((prev) => ({
                          ...prev,
                          transport: value as McpServerTransport,
                        }))
                      }
                    />
                    <label className="flex items-end gap-2 pb-2 text-xs text-zinc-300">
                      <input
                        type="checkbox"
                        checked={mcpForm.enabled}
                        onChange={(event) =>
                          setMcpForm((prev) => ({ ...prev, enabled: event.target.checked }))
                        }
                      />
                      {t('settings.hooks.enabled')}
                    </label>
                    {mcpForm.transport === 'stdio' ? (
                      <>
                        <Field
                          id="mcp-command"
                          label={t('settings.field.command')}
                          value={mcpForm.command}
                          onChange={(value) => setMcpForm((prev) => ({ ...prev, command: value }))}
                        />
                        <Field
                          id="mcp-args"
                          label={t('settings.field.args')}
                          value={mcpForm.argsText}
                          onChange={(value) => setMcpForm((prev) => ({ ...prev, argsText: value }))}
                        />
                      </>
                    ) : (
                      <Field
                        id="mcp-url"
                        label={t('settings.field.url')}
                        value={mcpForm.url}
                        onChange={(value) => setMcpForm((prev) => ({ ...prev, url: value }))}
                      />
                    )}
                    <Field
                      id="mcp-cwd"
                      label={t('settings.field.cwd')}
                      value={mcpForm.cwd}
                      onChange={(value) => setMcpForm((prev) => ({ ...prev, cwd: value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="mcp-env"
                      className="block text-[11px] font-semibold text-zinc-400"
                    >
                      {t('settings.field.nonSecretEnv')}
                    </label>
                    <textarea
                      id="mcp-env"
                      value={mcpForm.envText}
                      onChange={(event) =>
                        setMcpForm((prev) => ({ ...prev, envText: event.target.value }))
                      }
                      rows={3}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100"
                      placeholder={t('settings.placeholder.keyValue')}
                    />
                  </div>
                  <p className="text-[10px] text-zinc-500">{t('settings.mcp.note')}</p>
                  <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-800 pt-4">
                    {mcpForm.id ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => void testMcpServer(mcpForm.id as string)}
                          disabled={mcpBusy}
                          className="h-9 px-4 text-xs"
                        >
                          {t('settings.mcp.testConnection')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={async () => {
                            if (!mcpForm.id) return;
                            setMcpBusy(true);
                            try {
                              await workspace.deleteMcpServer(mcpForm.id);
                              setMcpForm(emptyMcpForm);
                              setMcpMessage('MCP Server を削除しました');
                            } catch (err) {
                              setMcpMessage(err instanceof Error ? err.message : String(err));
                            } finally {
                              setMcpBusy(false);
                            }
                          }}
                          disabled={mcpBusy}
                          className="h-9 px-4 text-xs text-red-300"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {t('settings.mcp.delete')}
                        </Button>
                      </>
                    ) : null}
                    <Button
                      type="button"
                      onClick={() => void saveMcpServer()}
                      disabled={mcpBusy}
                      className="h-9 px-5 text-xs"
                    >
                      {mcpBusy ? <RefreshCw className="h-3 w-3 animate-spin" /> : null}
                      {mcpForm.id ? t('settings.mcp.update') : t('settings.mcp.add')}
                    </Button>
                  </div>
                  {mcpMessage ? <p className="text-xs text-zinc-400">{mcpMessage}</p> : null}
                </div>
              </div>
            </div>
          ) : null}

          {activeSettingsSection === 'todo' ? (
            <div className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-sm font-bold text-zinc-100">{t('settings.todo.title')}</h2>
                  <p className="mt-1 text-xs text-zinc-500">{t('settings.todo.description')}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[
                  ['requirePerTodoReview', t('settings.todo.reviewEveryTodo')],
                  ['requirePerTodoFix', t('settings.todo.fixAfterReview')],
                  ['requireFinalVerification', t('settings.todo.finalVerify')],
                  ['askCommitOnCompletion', t('settings.todo.commitPrompt')],
                ].map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-300"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(
                        workspace.todoWorkflowSettings?.[
                          key as keyof typeof workspace.todoWorkflowSettings
                        ]
                      )}
                      onChange={(event) =>
                        void workspace.updateTodoWorkflowSettings({ [key]: event.target.checked })
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function GeneralSettingsPanel({
  value,
  message,
  isRefreshingFx,
  onChange,
  onSave,
  onRefreshFx,
}: {
  value: GeneralSettings;
  message: string;
  isRefreshingFx: boolean;
  onChange: (next: GeneralSettings) => void;
  onSave: () => void;
  onRefreshFx: () => void;
}) {
  const { t } = useTranslation();

  return (
    <section className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
            <Globe className="h-4 w-4 text-cyan-400" />
            {t('settings.general.title')}
          </h2>
          <p className="mt-1 text-xs text-zinc-500">{t('settings.general.panelDescription')}</p>
        </div>
        <Button type="button" onClick={onSave} className="h-9 px-4 text-xs">
          {t('settings.general.save')}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SelectField
          id="general-timezone"
          label={t('settings.general.timezone')}
          value={value.timezone}
          options={[
            { value: 'Asia/Tokyo', label: 'Asia/Tokyo' },
            { value: 'UTC', label: 'UTC' },
            { value: 'America/Los_Angeles', label: 'America/Los_Angeles' },
            { value: 'Europe/London', label: 'Europe/London' },
          ]}
          onChange={(timezone) => onChange({ ...value, timezone })}
        />
        <SelectField
          id="general-language"
          label={t('settings.general.language')}
          value={value.language}
          options={[
            { value: 'ja', label: '日本語' },
            { value: 'en', label: 'English' },
          ]}
          onChange={(language) => {
            const nextLanguage = language as 'ja' | 'en';
            void applyNightWorkersLanguage(nextLanguage);
            onChange({ ...value, language: nextLanguage });
          }}
        />
        <SelectField
          id="general-currency"
          label={t('settings.general.currency')}
          value={value.currency}
          options={[
            { value: 'JPY', label: 'JPY' },
            { value: 'USD', label: 'USD' },
            { value: 'EUR', label: 'EUR' },
          ]}
          onChange={(currency) =>
            onChange({ ...value, currency: currency as GeneralSettings['currency'] })
          }
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <div>
          <div className="text-xs font-semibold text-zinc-100">{t('settings.general.fx')}</div>
          <p className="mt-1 text-[10px] text-zinc-500">
            Source: {value.fx.source} / Last refresh: {value.fx.lastRefreshedAt || 'N/A'}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={onRefreshFx}
          disabled={isRefreshingFx}
          className="h-8 px-3 text-xs"
        >
          {isRefreshingFx ? <RefreshCw className="h-3 w-3 animate-spin" /> : null}
          {t('settings.general.refreshFx')}
        </Button>
      </div>
      {message ? <p className="text-xs text-zinc-400">{message}</p> : null}
    </section>
  );
}

function ProviderSectionHeader({
  provider,
  title,
  active,
  enabled,
  isSaving,
  onEnabledChange,
  onActivate,
  smokeBusy,
  smokeResult,
  onSmoke,
}: {
  provider: LlmProvider;
  title: string;
  active: boolean;
  enabled: boolean;
  isSaving: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onActivate: () => void;
  smokeBusy: boolean;
  smokeResult: string;
  onSmoke: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2 border-zinc-800 border-b pb-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-bold text-sm text-zinc-100">{title}</h2>
        <div className="flex items-center gap-2">
          <label
            htmlFor={`${provider}-provider-enabled`}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-300"
          >
            <input
              id={`${provider}-provider-enabled`}
              type="checkbox"
              checked={enabled}
              onChange={(event) => onEnabledChange(event.target.checked)}
            />
            Enabled
          </label>
          <button
            type="button"
            className={`inline-flex h-8 items-center rounded-lg border px-3 text-xs ${
              active
                ? 'border-indigo-500/70 bg-indigo-500/15 text-indigo-300'
                : 'border-zinc-700/70 bg-zinc-900 text-zinc-200'
            } disabled:cursor-not-allowed disabled:opacity-50`}
            disabled={!enabled || active || isSaving}
            onClick={onActivate}
          >
            {active ? t('settings.provider.active') : t('settings.provider.activate')}
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-2 rounded-lg border border-zinc-700/70 bg-zinc-900 px-3 text-xs text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!enabled || smokeBusy}
            onClick={onSmoke}
            title={t('settings.provider.smokeTitle')}
          >
            {smokeBusy ? <RefreshCw className="h-3 w-3 animate-spin" /> : null}
            {t('settings.provider.activateSmoke')}
          </button>
        </div>
      </div>
      <p className="text-[10px] text-zinc-500">{t('settings.provider.smokeDescription')}</p>
      {smokeResult ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-400">
          {smokeResult}
        </p>
      ) : null}
    </div>
  );
}

function AppearanceSettings({
  value,
  onChange,
  onReset,
}: {
  value: BlueprintPreviewDesignSettings;
  onChange: (next: BlueprintPreviewDesignSettings) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();

  return (
    <section className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
            <Palette className="h-4 w-4 text-indigo-400" />
            {t('settings.appearance.title')}
          </h2>
          <p className="mt-1 text-xs leading-5 text-zinc-400">
            {t('settings.appearance.description')}
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-zinc-700/50 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300"
          onClick={onReset}
        >
          {t('settings.appearance.reset')}
        </button>
      </div>
      <div className="grid gap-3">
        <AppearanceGroup label={t('settings.appearance.theme')} summary={value.theme}>
          <AppearanceOptionRow
            options={blueprintPreviewDesignOptions.theme}
            value={value.theme}
            onSelect={(theme) => onChange({ ...value, theme })}
          />
        </AppearanceGroup>
        <AppearanceGroup label={t('settings.appearance.density')} summary={value.density}>
          <AppearanceOptionRow
            options={blueprintPreviewDesignOptions.density}
            value={value.density}
            onSelect={(density) => onChange({ ...value, density })}
          />
        </AppearanceGroup>
        <AppearanceGroup label={t('settings.appearance.shape')} summary={value.shape}>
          <AppearanceOptionRow
            options={blueprintPreviewDesignOptions.shape}
            value={value.shape}
            onSelect={(shape) => onChange({ ...value, shape })}
          />
        </AppearanceGroup>
        <AppearanceGroup
          label={t('settings.appearance.shadow')}
          summary={`${value.shadow} / ${value.shadowDirection}`}
        >
          <div className="grid gap-2 md:grid-cols-2">
            <AppearanceVariantRow
              label={t('settings.appearance.strength')}
              options={blueprintPreviewDesignOptions.shadow}
              value={value.shadow}
              onSelect={(shadow) => onChange({ ...value, shadow })}
            />
            <AppearanceVariantRow
              label={t('settings.appearance.direction')}
              options={blueprintPreviewDesignOptions.shadowDirection}
              value={value.shadowDirection}
              onSelect={(shadowDirection) => onChange({ ...value, shadowDirection })}
            />
          </div>
        </AppearanceGroup>
        <AppearanceGroup label={t('settings.appearance.font')} summary={value.font}>
          <AppearanceOptionRow
            options={blueprintPreviewDesignOptions.font}
            value={value.font}
            onSelect={(font) => onChange({ ...value, font })}
          />
        </AppearanceGroup>
        <AppearanceGroup label={t('settings.appearance.contrast')} summary={value.contrast}>
          <AppearanceOptionRow
            options={blueprintPreviewDesignOptions.contrast}
            value={value.contrast}
            onSelect={(contrast) => onChange({ ...value, contrast })}
          />
        </AppearanceGroup>
        <AppearanceGroup label={t('settings.appearance.motion')} summary={value.motion}>
          <AppearanceOptionRow
            options={blueprintPreviewDesignOptions.motion}
            value={value.motion}
            onSelect={(motion) => onChange({ ...value, motion })}
          />
        </AppearanceGroup>
        <AppearanceGroup
          label={t('settings.appearance.componentVariants')}
          summary={t('settings.appearance.componentSummary')}
        >
          <div className="grid gap-2 md:grid-cols-2">
            <AppearanceVariantRow
              label={t('settings.appearance.button')}
              options={blueprintPreviewDesignOptions.buttonVariant}
              value={value.componentVariants.button}
              onSelect={(button) =>
                onChange({
                  ...value,
                  componentVariants: { ...value.componentVariants, button },
                })
              }
            />
            <AppearanceVariantRow
              label={t('settings.appearance.card')}
              options={blueprintPreviewDesignOptions.cardVariant}
              value={value.componentVariants.card}
              onSelect={(card) =>
                onChange({
                  ...value,
                  componentVariants: { ...value.componentVariants, card },
                })
              }
            />
            <AppearanceVariantRow
              label={t('settings.appearance.table')}
              options={blueprintPreviewDesignOptions.tableVariant}
              value={value.componentVariants.table}
              onSelect={(table) =>
                onChange({
                  ...value,
                  componentVariants: { ...value.componentVariants, table },
                })
              }
            />
            <AppearanceVariantRow
              label={t('settings.appearance.input')}
              options={blueprintPreviewDesignOptions.inputVariant}
              value={value.componentVariants.input}
              onSelect={(input) =>
                onChange({
                  ...value,
                  componentVariants: { ...value.componentVariants, input },
                })
              }
            />
          </div>
        </AppearanceGroup>
      </div>
    </section>
  );
}

function AppearanceGroup({
  label,
  summary,
  children,
}: {
  label: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/30 p-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-zinc-200">{label}</span>
        <span className="text-zinc-500">{summary}</span>
      </div>
      {children}
    </div>
  );
}

function AppearanceOptionRow<const T extends readonly string[]>({
  options,
  value,
  onSelect,
}: {
  options: T;
  value: T[number];
  onSelect: (value: T[number]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button
          type="button"
          key={option}
          className={`rounded-lg border px-2.5 py-1 text-[11px] capitalize ${
            option === value
              ? 'border-indigo-400 bg-indigo-500 text-white'
              : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'
          }`}
          onClick={() => onSelect(option)}
        >
          {option.replace(/-/g, ' ')}
        </button>
      ))}
    </div>
  );
}

function AppearanceVariantRow<const T extends readonly string[]>({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: T;
  value: T[number];
  onSelect: (value: T[number]) => void;
}) {
  return (
    <div className="grid gap-1">
      <div className="text-[10px] font-semibold uppercase text-zinc-500">{label}</div>
      <AppearanceOptionRow options={options} value={value} onSelect={onSelect} />
    </div>
  );
}

type FieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password';
};

function Field({ id, label, value, onChange, type = 'text' }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[11px] font-semibold text-zinc-400">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100"
      />
    </div>
  );
}

type NumberFieldProps = {
  id: string;
  label: string;
  value: number;
  min?: number;
  onChange: (value: number) => void;
};

function NumberField({ id, label, value, min = 1, onChange }: NumberFieldProps) {
  return (
    <div className="w-32 space-y-1.5">
      <label htmlFor={id} className="block text-[11px] font-semibold text-zinc-400">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))}
        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100"
      />
    </div>
  );
}

type SelectFieldProps = {
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
};

function SelectField({ id, label, value, options, onChange }: SelectFieldProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[11px] font-semibold text-zinc-400">
        {label}
      </label>
      <Select
        value={value}
        onValueChange={(next) => {
          if (next) onChange(next);
        }}
      >
        <SelectTrigger
          id={id}
          className="w-full rounded-lg border-zinc-800 bg-zinc-900 text-xs text-zinc-100"
        >
          <SelectValue placeholder={t('settings.selectPlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
