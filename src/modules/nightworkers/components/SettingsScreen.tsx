import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useWorkspaceAppearanceActions,
  useWorkspaceAppearanceState,
} from '../contexts/WorkspaceAppearanceContext';
import type { NightWorkersWorkspaceState } from '../hooks/useNightWorkersWorkspace';
import { applyNightWorkersLanguage } from '../i18n/NightWorkersI18nProvider';
import {
  fetchGeneralSettings,
  fetchLlmSettings,
  refreshFxRates as refreshFxRatesCommand,
  saveGeneralSettings as saveGeneralSettingsCommand,
  saveLlmSettings,
} from '../nightWorkersCommands';
import type { GeneralSettings, LlmProvider, LlmSettings, McpServerConfig } from '../types';
import { AppearanceSettings } from './SettingsAppearancePanel';
import { GeneralSettingsPanel } from './SettingsGeneralPanel';
import { SettingsHooksPanel } from './SettingsHooksPanel';
import { SettingsLlmPanel } from './SettingsLlmPanel';
import { SettingsMcpPanel } from './SettingsMcpPanel';
import { SettingsTodoPanel } from './SettingsTodoPanel';

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
  IMPLEMENTATION_RUNTIME_LANE: '',
  SESSION_QUEUE_MAX_CONCURRENCY: 2,
};

import {
  type AgentHookForm,
  defaultGeneralSettings,
  emptyHookForm,
  emptyMcpForm,
  formFromAgentHook,
  formFromMcpServer,
  hookFormToInput,
  type McpServerForm,
  mcpFormToInput,
  type SettingsSectionId,
  settingsSections,
} from './SettingsForms';

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
      fetchLlmSettings().then((res) => res.json()),
      fetchGeneralSettings().then((res) => res.json()),
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
    const res = await saveLlmSettings(updated);
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
      const saveRes = await saveLlmSettings(updated);
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
    const res = await saveGeneralSettingsCommand(generalSettings);
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
      const res = await refreshFxRatesCommand();
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
            <SettingsLlmPanel
              settings={settings}
              isSaving={isSaving}
              smokingProvider={smokingProvider}
              smokeResult={smokeResult}
              onChange={onChange}
              setProviderEnabled={setProviderEnabled}
              handleSave={handleSave}
              runProviderSmokeTest={runProviderSmokeTest}
            />
          ) : null}

          {activeSettingsSection === 'hooks' ? (
            <SettingsHooksPanel
              workspace={workspace}
              hookForm={hookForm}
              setHookForm={setHookForm}
              hookMessage={hookMessage}
              setHookMessage={setHookMessage}
              hookBusy={hookBusy}
              setHookBusy={setHookBusy}
              saveAgentHook={saveAgentHook}
              testAgentHook={testAgentHook}
            />
          ) : null}

          {activeSettingsSection === 'mcp' ? (
            <SettingsMcpPanel
              workspace={workspace}
              mcpForm={mcpForm}
              setMcpForm={setMcpForm}
              mcpMessage={mcpMessage}
              setMcpMessage={setMcpMessage}
              mcpBusy={mcpBusy}
              setMcpBusy={setMcpBusy}
              mcpPasteText={mcpPasteText}
              setMcpPasteText={setMcpPasteText}
              toggleMcpServer={toggleMcpServer}
              importMcpServers={importMcpServers}
              testMcpServer={testMcpServer}
              saveMcpServer={saveMcpServer}
            />
          ) : null}

          {activeSettingsSection === 'todo' ? <SettingsTodoPanel workspace={workspace} /> : null}
        </div>
      </main>
    </div>
  );
}
