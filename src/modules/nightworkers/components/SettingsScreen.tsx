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
  ListTodo,
  Palette,
  PlugZap,
  RefreshCw,
  type Settings,
  Trash2,
  Workflow,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  useWorkspaceAppearanceActions,
  useWorkspaceAppearanceState,
} from '../contexts/WorkspaceAppearanceContext';
import type { NightWorkersWorkspaceState } from '../hooks/useNightWorkersWorkspace';
import {
  type AgentHookConfig,
  type AgentHookEvent,
  type AgentHookInput,
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

type SettingsSectionId = 'appearance' | 'llm' | 'hooks' | 'mcp' | 'todo';

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
  label: string;
  description: string;
  icon: typeof Settings;
}> = [
  {
    id: 'appearance',
    label: '外観',
    description: 'Design Token',
    icon: Palette,
  },
  {
    id: 'llm',
    label: 'LLM',
    description: 'Provider / Model',
    icon: Bot,
  },
  {
    id: 'hooks',
    label: 'Hooks',
    description: 'Agent Hooks',
    icon: Workflow,
  },
  {
    id: 'mcp',
    label: 'MCP',
    description: 'MCP Servers',
    icon: PlugZap,
  },
  {
    id: 'todo',
    label: 'TODO',
    description: 'Workflow gates',
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
  const [settings, setSettings] = useState<LlmSettings>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
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
  const [activeSettingsSection, setActiveSettingsSection] =
    useState<SettingsSectionId>('appearance');
  const { settings: appearanceSettings } = useWorkspaceAppearanceState();
  const { setAppearanceSettings, resetAppearanceSettings } = useWorkspaceAppearanceActions();

  const activeSectionMeta =
    settingsSections.find((section) => section.id === activeSettingsSection) || settingsSections[0];
  const ActiveSectionIcon = activeSectionMeta.icon;

  useEffect(() => {
    fetch('/api/settings/llm')
      .then((res) => res.json())
      .then((data: Partial<LlmSettings>) => {
        const merged = { ...defaultSettings, ...data };
        setSettings(merged);
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
          ← アプリに戻る
        </button>
        <div className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Settings
        </div>
        <nav className="grid gap-1" aria-label="Settings sections">
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
                  <span className="block font-semibold">{section.label}</span>
                  <span className="block truncate text-[10px] opacity-70">
                    {section.description}
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
              {activeSectionMeta.label}
            </h1>
            <p className="text-xs text-zinc-500">{activeSectionMeta.description}</p>
          </div>

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
                    label="API Key"
                    type="password"
                    value={settings.AZURE_OPENAI_API_KEY}
                    onChange={(v) => onChange('AZURE_OPENAI_API_KEY', v)}
                  />
                  <Field
                    id="azure-endpoint"
                    label="Endpoint URL"
                    value={settings.AZURE_OPENAI_ENDPOINT}
                    onChange={(v) => onChange('AZURE_OPENAI_ENDPOINT', v)}
                  />
                  <Field
                    id="azure-deployment"
                    label="Deployment Name"
                    value={settings.AZURE_OPENAI_DEPLOYMENT_NAME}
                    onChange={(v) => onChange('AZURE_OPENAI_DEPLOYMENT_NAME', v)}
                  />
                  <Field
                    id="azure-version"
                    label="API Version"
                    value={settings.AZURE_OPENAI_API_VERSION}
                    onChange={(v) => onChange('AZURE_OPENAI_API_VERSION', v)}
                  />
                </div>
              </section>

              <section className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
                <ProviderSectionHeader
                  provider="openai"
                  title="OpenAI 本家"
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
                    label="API Key"
                    type="password"
                    value={settings.OPENAI_API_KEY}
                    onChange={(v) => onChange('OPENAI_API_KEY', v)}
                  />
                  <Field
                    id="openai-base-url"
                    label="Base URL"
                    value={settings.OPENAI_BASE_URL}
                    onChange={(v) => onChange('OPENAI_BASE_URL', v)}
                  />
                  <Field
                    id="openai-model"
                    label="Model Name"
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
                    label="AWS Access Key ID"
                    value={settings.AWS_ACCESS_KEY_ID}
                    onChange={(v) => onChange('AWS_ACCESS_KEY_ID', v)}
                  />
                  <Field
                    id="aws-secret-key"
                    label="AWS Secret Access Key"
                    type="password"
                    value={settings.AWS_SECRET_ACCESS_KEY}
                    onChange={(v) => onChange('AWS_SECRET_ACCESS_KEY', v)}
                  />
                  <Field
                    id="aws-region"
                    label="AWS Region"
                    value={settings.AWS_REGION}
                    onChange={(v) => onChange('AWS_REGION', v)}
                  />
                  <Field
                    id="aws-model"
                    label="Bedrock Model ID"
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
                    label="Codex Access Token"
                    type="password"
                    value={settings.CODEX_ACCESS_TOKEN}
                    onChange={(v) => onChange('CODEX_ACCESS_TOKEN', v)}
                  />
                  <SelectField
                    id="codex-model"
                    label="Codex Model ID"
                    value={settings.CODEX_MODEL}
                    options={PROVIDER_MODEL_OPTIONS.codex}
                    onChange={(v) => onChange('CODEX_MODEL', v)}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-zinc-100">
                      OpenAI / ChatGPT ログイン
                    </div>
                    <p className="mt-1 text-[10px] leading-4 text-zinc-500">
                      この環境でログイン済みとは限らないため、Codex SDK
                      を使う前にログイン状態を確認できます。
                    </p>
                  </div>
                  <a
                    href="https://chatgpt.com/auth/login"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-zinc-700/70 bg-zinc-800 px-3 text-xs text-zinc-200 hover:border-indigo-500/70 hover:text-zinc-100"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    ログインを開く
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
                  {isSaving ? '保存中...' : '設定を保存する'}
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
                    Agent Hooks
                  </h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    ランタイムとツール実行境界で command / HTTP hook を実行します。
                  </p>
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
                  Add Hook
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr]">
                <div className="space-y-2">
                  {workspace.agentHooks.length === 0 ? (
                    <p className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-xs text-zinc-500">
                      Agent Hook は未登録です。
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
                            {hook.enabled ? 'Enabled' : 'Paused'}
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
                      label="Name"
                      value={hookForm.name}
                      onChange={(value) => setHookForm((prev) => ({ ...prev, name: value }))}
                    />
                    <SelectField
                      id="hook-event"
                      label="Event"
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
                      label="Handler"
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
                      label="Matcher"
                      value={hookForm.matcher}
                      onChange={(value) => setHookForm((prev) => ({ ...prev, matcher: value }))}
                    />
                    <NumberField
                      id="hook-timeout"
                      label="Timeout秒"
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
                      Enabled
                    </label>
                    <label className="flex items-end gap-2 pb-2 text-xs text-zinc-300">
                      <input
                        type="checkbox"
                        checked={hookForm.failClosed}
                        onChange={(event) =>
                          setHookForm((prev) => ({ ...prev, failClosed: event.target.checked }))
                        }
                      />
                      Fail closed
                    </label>
                  </div>

                  {hookForm.handlerType === 'command' ? (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <Field
                        id="hook-command"
                        label="Command"
                        value={hookForm.command}
                        onChange={(value) => setHookForm((prev) => ({ ...prev, command: value }))}
                      />
                      <Field
                        id="hook-args"
                        label="Args"
                        value={hookForm.argsText}
                        onChange={(value) => setHookForm((prev) => ({ ...prev, argsText: value }))}
                      />
                      <Field
                        id="hook-cwd"
                        label="CWD"
                        value={hookForm.cwd}
                        onChange={(value) => setHookForm((prev) => ({ ...prev, cwd: value }))}
                      />
                      <div className="space-y-1.5">
                        <label
                          htmlFor="hook-env"
                          className="block text-[11px] font-semibold text-zinc-400"
                        >
                          Non-secret Env
                        </label>
                        <textarea
                          id="hook-env"
                          value={hookForm.envText}
                          onChange={(event) =>
                            setHookForm((prev) => ({ ...prev, envText: event.target.value }))
                          }
                          rows={3}
                          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100"
                          placeholder="KEY=value"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <Field
                        id="hook-url"
                        label="URL"
                        value={hookForm.url}
                        onChange={(value) => setHookForm((prev) => ({ ...prev, url: value }))}
                      />
                      <div className="space-y-1.5">
                        <label
                          htmlFor="hook-headers"
                          className="block text-[11px] font-semibold text-zinc-400"
                        >
                          Non-secret Headers
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

                  <p className="text-[10px] text-zinc-500">
                    command / HTTP hook はローカル自動化として実行されます。secret env/header
                    は保存しません。
                  </p>
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
                          Test Hook
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
                          Delete
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
                      {hookForm.id ? 'Update Hook' : 'Add Hook'}
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
                    MCP Servers
                  </h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    認証なしの stdio / Streamable HTTP server と legacy SSE を個別に設定します。
                  </p>
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
                  Add Server
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr]">
                <div className="space-y-2">
                  {workspace.mcpServers.length === 0 ? (
                    <p className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-xs text-zinc-500">
                      MCP Server は未登録です。
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
                        <h3 className="text-xs font-semibold text-zinc-200">Paste MCP Config</h3>
                        <p className="mt-1 text-[10px] text-zinc-500">
                          JSONの mcpServers / servers / 単体 server を貼り付けて取り込みます。
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
                        Import & Test
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
                      label="Name"
                      value={mcpForm.name}
                      onChange={(value) => setMcpForm((prev) => ({ ...prev, name: value }))}
                    />
                    <Field
                      id="mcp-prefix"
                      label="Tool Prefix"
                      value={mcpForm.toolPrefix}
                      onChange={(value) => setMcpForm((prev) => ({ ...prev, toolPrefix: value }))}
                    />
                    <SelectField
                      id="mcp-transport"
                      label="Transport"
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
                      Enabled
                    </label>
                    {mcpForm.transport === 'stdio' ? (
                      <>
                        <Field
                          id="mcp-command"
                          label="Command"
                          value={mcpForm.command}
                          onChange={(value) => setMcpForm((prev) => ({ ...prev, command: value }))}
                        />
                        <Field
                          id="mcp-args"
                          label="Args"
                          value={mcpForm.argsText}
                          onChange={(value) => setMcpForm((prev) => ({ ...prev, argsText: value }))}
                        />
                      </>
                    ) : (
                      <Field
                        id="mcp-url"
                        label="URL"
                        value={mcpForm.url}
                        onChange={(value) => setMcpForm((prev) => ({ ...prev, url: value }))}
                      />
                    )}
                    <Field
                      id="mcp-cwd"
                      label="CWD"
                      value={mcpForm.cwd}
                      onChange={(value) => setMcpForm((prev) => ({ ...prev, cwd: value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="mcp-env"
                      className="block text-[11px] font-semibold text-zinc-400"
                    >
                      Non-secret Env
                    </label>
                    <textarea
                      id="mcp-env"
                      value={mcpForm.envText}
                      onChange={(event) =>
                        setMcpForm((prev) => ({ ...prev, envText: event.target.value }))
                      }
                      rows={3}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100"
                      placeholder="KEY=value"
                    />
                  </div>
                  <p className="text-[10px] text-zinc-500">
                    OAuth、Bearer token、API key header、secret env はこの版では保存しません。
                  </p>
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
                          Test Connection
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
                          Delete
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
                      {mcpForm.id ? 'Update Server' : 'Add Server'}
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
                  <h2 className="text-sm font-bold text-zinc-100">TODO Workflow</h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    Processor が各 Todo で実行する標準 gate を設定します。
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[
                  ['requireContextCompile', 'context_compile'],
                  ['requirePerTodoReview', 'Todoごとのコードレビュー'],
                  ['requirePerTodoFix', 'レビュー後の修正'],
                  ['requireFinalVerification', '最終Verify'],
                  ['requireCompileEval', 'compile_eval'],
                  ['requireRegisterCandidatePrompt', 'register_candidate'],
                  ['askCommitOnCompletion', '完了時Commit確認'],
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
            {active ? 'Active' : 'Activate'}
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-2 rounded-lg border border-zinc-700/70 bg-zinc-900 px-3 text-xs text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!enabled || smokeBusy}
            onClick={onSmoke}
            title="このProviderをActiveにしてからSmoke Testを実行します"
          >
            {smokeBusy ? <RefreshCw className="h-3 w-3 animate-spin" /> : null}
            Activate + Smoke
          </button>
        </div>
      </div>
      <p className="text-[10px] text-zinc-500">
        Smoke TestはこのProviderをActiveにしてから実行します。
      </p>
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
  return (
    <section className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
            <Palette className="h-4 w-4 text-indigo-400" />
            外観設定
          </h2>
          <p className="mt-1 text-xs leading-5 text-zinc-400">
            Blueprint Preview と同じ Design Token 軸を NightWorkers 本体に適用します。
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-zinc-700/50 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300"
          onClick={onReset}
        >
          Reset
        </button>
      </div>
      <div className="grid gap-3">
        <AppearanceGroup label="Theme" summary={value.theme}>
          <AppearanceOptionRow
            options={blueprintPreviewDesignOptions.theme}
            value={value.theme}
            onSelect={(theme) => onChange({ ...value, theme })}
          />
        </AppearanceGroup>
        <AppearanceGroup label="Density" summary={value.density}>
          <AppearanceOptionRow
            options={blueprintPreviewDesignOptions.density}
            value={value.density}
            onSelect={(density) => onChange({ ...value, density })}
          />
        </AppearanceGroup>
        <AppearanceGroup label="Shape" summary={value.shape}>
          <AppearanceOptionRow
            options={blueprintPreviewDesignOptions.shape}
            value={value.shape}
            onSelect={(shape) => onChange({ ...value, shape })}
          />
        </AppearanceGroup>
        <AppearanceGroup label="Shadow" summary={`${value.shadow} / ${value.shadowDirection}`}>
          <div className="grid gap-2 md:grid-cols-2">
            <AppearanceVariantRow
              label="Strength"
              options={blueprintPreviewDesignOptions.shadow}
              value={value.shadow}
              onSelect={(shadow) => onChange({ ...value, shadow })}
            />
            <AppearanceVariantRow
              label="Direction"
              options={blueprintPreviewDesignOptions.shadowDirection}
              value={value.shadowDirection}
              onSelect={(shadowDirection) => onChange({ ...value, shadowDirection })}
            />
          </div>
        </AppearanceGroup>
        <AppearanceGroup label="Font" summary={value.font}>
          <AppearanceOptionRow
            options={blueprintPreviewDesignOptions.font}
            value={value.font}
            onSelect={(font) => onChange({ ...value, font })}
          />
        </AppearanceGroup>
        <AppearanceGroup label="Contrast" summary={value.contrast}>
          <AppearanceOptionRow
            options={blueprintPreviewDesignOptions.contrast}
            value={value.contrast}
            onSelect={(contrast) => onChange({ ...value, contrast })}
          />
        </AppearanceGroup>
        <AppearanceGroup label="Motion" summary={value.motion}>
          <AppearanceOptionRow
            options={blueprintPreviewDesignOptions.motion}
            value={value.motion}
            onSelect={(motion) => onChange({ ...value, motion })}
          />
        </AppearanceGroup>
        <AppearanceGroup label="Component variants" summary="button / card / table / input">
          <div className="grid gap-2 md:grid-cols-2">
            <AppearanceVariantRow
              label="Button"
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
              label="Card"
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
              label="Table"
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
              label="Input"
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
          <SelectValue placeholder="モデルを選択" />
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
