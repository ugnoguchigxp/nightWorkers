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
  fetchTestQualitySettings,
  refreshFxRates as refreshFxRatesCommand,
  saveGeneralSettings as saveGeneralSettingsCommand,
  saveLlmSettings,
  saveTestQualitySettings as saveTestQualitySettingsCommand,
} from '../nightWorkersCommands';
import {
  defaultTestQualitySettings,
  type GeneralSettings,
  type LlmSettings,
  type McpServerConfig,
  type TestQualitySettings,
} from '../types';
import { AppearanceSettings } from './SettingsAppearancePanel';
import { GeneralSettingsPanel } from './SettingsGeneralPanel';
import { SettingsHooksPanel } from './SettingsHooksPanel';
import { SettingsLlmPanel } from './SettingsLlmPanel';
import { SettingsMcpPanel } from './SettingsMcpPanel';
import { SettingsPlanModePanel } from './SettingsPlanModePanel';
import { SettingsTestPanel } from './SettingsTestPanel';

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
  CODEX_MODEL: 'gpt-5.4-mini',
  IMPLEMENTATION_RUNTIME_LANE: '',
  SESSION_QUEUE_MAX_CONCURRENCY: 2,
  providerEndpoints: [],
  roleRoutes: [],
};

type SaveFeedbackStatus = 'idle' | 'success' | 'error';

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
  mergeGeneralSettings,
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
  const [llmSaveStatus, setLlmSaveStatus] = useState<SaveFeedbackStatus>('idle');
  const [llmSaveMessage, setLlmSaveMessage] = useState('');
  const [generalMessage, setGeneralMessage] = useState('');
  const [generalMessageStatus, setGeneralMessageStatus] = useState<SaveFeedbackStatus>('idle');
  const [isRefreshingFx, setIsRefreshingFx] = useState(false);
  const [mcpForm, setMcpForm] = useState<McpServerForm>(emptyMcpForm);
  const [mcpPasteText, setMcpPasteText] = useState('');
  const [mcpMessage, setMcpMessage] = useState<string>('');
  const [mcpMessageStatus, setMcpMessageStatus] = useState<SaveFeedbackStatus>('idle');
  const [mcpBusy, setMcpBusy] = useState(false);
  const [hookForm, setHookForm] = useState<AgentHookForm>(emptyHookForm);
  const [hookMessage, setHookMessage] = useState<string>('');
  const [hookMessageStatus, setHookMessageStatus] = useState<SaveFeedbackStatus>('idle');
  const [hookBusy, setHookBusy] = useState(false);
  const [testQualitySettings, setTestQualitySettings] = useState<TestQualitySettings>(
    defaultTestQualitySettings
  );
  const [testQualityMessage, setTestQualityMessage] = useState('');
  const [testQualityMessageStatus, setTestQualityMessageStatus] =
    useState<SaveFeedbackStatus>('idle');
  const [testQualityBusy, setTestQualityBusy] = useState(false);
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
        setGeneralSettings(mergeGeneralSettings(generalData));
      })
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (!workspace.activeProject) {
      setTestQualitySettings(defaultTestQualitySettings);
      setTestQualityMessage('');
      setTestQualityMessageStatus('idle');
      return;
    }

    let cancelled = false;
    setTestQualityBusy(true);
    setTestQualityMessage('');
    setTestQualityMessageStatus('idle');
    fetchTestQualitySettings(workspace.activeProject.id)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(t('settings.test.loadFailed', { status: res.status }));
        }
        return (await res.json()) as TestQualitySettings;
      })
      .then((settingsData) => {
        if (!cancelled) {
          setTestQualitySettings({ ...defaultTestQualitySettings, ...settingsData });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setTestQualitySettings(defaultTestQualitySettings);
          setTestQualityMessage(err instanceof Error ? err.message : String(err));
          setTestQualityMessageStatus('error');
        }
      })
      .finally(() => {
        if (!cancelled) setTestQualityBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workspace.activeProject, t]);

  const handleSave = async () => {
    setIsSaving(true);
    setLlmSaveStatus('idle');
    setLlmSaveMessage('');
    try {
      const res = await saveLlmSettings(settings);
      if (!res.ok) {
        throw new Error(t('settings.saveFailedWithStatus', { status: res.status }));
      }
      setSettings(settings);
      setLlmSaveStatus('success');
      setLlmSaveMessage(t('settings.saveSucceeded'));
    } catch (err) {
      setLlmSaveStatus('error');
      setLlmSaveMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const onChange = <K extends keyof LlmSettings>(key: K, value: LlmSettings[K]) => {
    setLlmSaveStatus('idle');
    setLlmSaveMessage('');
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const saveGeneralSettings = async () => {
    setGeneralMessage('');
    setGeneralMessageStatus('idle');
    const res = await saveGeneralSettingsCommand(generalSettings);
    if (!res.ok) {
      setGeneralMessage(t('settings.general.saveFailed'));
      setGeneralMessageStatus('error');
      return;
    }
    const saved = mergeGeneralSettings((await res.json()) as Partial<GeneralSettings>);
    setGeneralSettings(saved);
    void applyNightWorkersLanguage(saved.language);
    setGeneralMessage(t('settings.general.saveSucceeded'));
    setGeneralMessageStatus('success');
  };

  const refreshFxRates = async () => {
    setIsRefreshingFx(true);
    setGeneralMessage('');
    setGeneralMessageStatus('idle');
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
      setGeneralMessageStatus('success');
    } catch (err) {
      setGeneralMessage(err instanceof Error ? err.message : String(err));
      setGeneralMessageStatus('error');
    } finally {
      setIsRefreshingFx(false);
    }
  };

  const saveTestQualitySettings = async () => {
    if (!workspace.activeProject) {
      setTestQualityMessage(t('settings.test.noProject'));
      setTestQualityMessageStatus('error');
      return;
    }

    setTestQualityBusy(true);
    setTestQualityMessage('');
    setTestQualityMessageStatus('idle');
    try {
      const res = await saveTestQualitySettingsCommand(
        workspace.activeProject.id,
        testQualitySettings
      );
      if (!res.ok) {
        throw new Error(t('settings.test.saveFailed', { status: res.status }));
      }
      const saved = (await res.json()) as TestQualitySettings;
      setTestQualitySettings({ ...defaultTestQualitySettings, ...saved });
      setTestQualityMessage(t('settings.test.saveSucceeded'));
      setTestQualityMessageStatus('success');
    } catch (err) {
      setTestQualityMessage(err instanceof Error ? err.message : String(err));
      setTestQualityMessageStatus('error');
    } finally {
      setTestQualityBusy(false);
    }
  };

  const saveMcpServer = async () => {
    setMcpBusy(true);
    setMcpMessage('');
    setMcpMessageStatus('idle');
    try {
      const input = mcpFormToInput(mcpForm);
      const saved = mcpForm.id
        ? await workspace.updateMcpServer(mcpForm.id, input)
        : await workspace.createMcpServer(input);
      setMcpForm(formFromMcpServer(saved));
      if (!saved.enabled) {
        setMcpMessage('MCP Server を保存しました。OFF のため疎通テストはスキップしました');
        setMcpMessageStatus('success');
        return;
      }
      const result = await workspace.testMcpServer(saved.id);
      setMcpMessage(
        `MCP Server を保存しました。疎通テスト: ${result.ok ? 'OK' : 'NG'} ${result.message}`
      );
      setMcpMessageStatus('success');
    } catch (err) {
      setMcpMessage(err instanceof Error ? err.message : String(err));
      setMcpMessageStatus('error');
    } finally {
      setMcpBusy(false);
    }
  };

  const importMcpServers = async () => {
    setMcpBusy(true);
    setMcpMessage('');
    setMcpMessageStatus('idle');
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
      setMcpMessageStatus('success');
    } catch (err) {
      setMcpMessage(err instanceof Error ? err.message : String(err));
      setMcpMessageStatus('error');
    } finally {
      setMcpBusy(false);
    }
  };

  const toggleMcpServer = async (server: McpServerConfig, enabled: boolean) => {
    setMcpBusy(true);
    setMcpMessage('');
    setMcpMessageStatus('idle');
    try {
      const updated = await workspace.updateMcpServer(server.id, { enabled });
      if (mcpForm.id === server.id) {
        setMcpForm((prev) => ({ ...prev, enabled: updated.enabled }));
      }
      if (!updated.enabled) {
        setMcpMessage(`${updated.name} をOFFにしました`);
        setMcpMessageStatus('success');
        return;
      }
      const result = await workspace.testMcpServer(updated.id);
      setMcpMessage(
        `${updated.name} をONにしました。疎通テスト: ${result.ok ? 'OK' : 'NG'} ${result.message}`
      );
      setMcpMessageStatus(result.ok ? 'success' : 'error');
    } catch (err) {
      setMcpMessage(err instanceof Error ? err.message : String(err));
      setMcpMessageStatus('error');
    } finally {
      setMcpBusy(false);
    }
  };

  const testMcpServer = async (id: string) => {
    setMcpBusy(true);
    setMcpMessage('');
    setMcpMessageStatus('idle');
    try {
      const result = await workspace.testMcpServer(id);
      setMcpMessage(`${result.ok ? 'OK' : 'NG'} ${result.message}`);
      setMcpMessageStatus(result.ok ? 'success' : 'error');
    } catch (err) {
      setMcpMessage(err instanceof Error ? err.message : String(err));
      setMcpMessageStatus('error');
    } finally {
      setMcpBusy(false);
    }
  };

  const saveAgentHook = async () => {
    setHookBusy(true);
    setHookMessage('');
    setHookMessageStatus('idle');
    try {
      const input = hookFormToInput(hookForm);
      if (hookForm.id) {
        await workspace.updateAgentHook(hookForm.id, input);
        setHookMessage('Agent Hook を更新しました');
        setHookMessageStatus('success');
      } else {
        const created = await workspace.createAgentHook(input);
        setHookForm(formFromAgentHook(created));
        setHookMessage('Agent Hook を追加しました');
        setHookMessageStatus('success');
      }
    } catch (err) {
      setHookMessage(err instanceof Error ? err.message : String(err));
      setHookMessageStatus('error');
    } finally {
      setHookBusy(false);
    }
  };

  const testAgentHook = async (id: string) => {
    setHookBusy(true);
    setHookMessage('');
    setHookMessageStatus('idle');
    try {
      const result = await workspace.testAgentHook(id);
      setHookMessage(`${result.ok ? 'OK' : 'NG'} ${result.message}`);
      setHookMessageStatus(result.ok ? 'success' : 'error');
    } catch (err) {
      setHookMessage(err instanceof Error ? err.message : String(err));
      setHookMessageStatus('error');
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
              messageStatus={generalMessageStatus}
              isRefreshingFx={isRefreshingFx}
              onChange={setGeneralSettings}
              onSave={() => void saveGeneralSettings()}
              onRefreshFx={() => void refreshFxRates()}
            />
          ) : null}

          {activeSettingsSection === 'plan-mode' ? (
            <SettingsPlanModePanel
              value={generalSettings}
              message={generalMessage}
              messageStatus={generalMessageStatus}
              onChange={setGeneralSettings}
              onSave={() => void saveGeneralSettings()}
            />
          ) : null}

          {activeSettingsSection === 'appearance' ? (
            <AppearanceSettings
              value={appearanceSettings}
              onChange={setAppearanceSettings}
              onReset={resetAppearanceSettings}
            />
          ) : null}

          {activeSettingsSection === 'llm-providers' ? (
            <SettingsLlmPanel
              section="providers"
              settings={settings}
              isSaving={isSaving}
              saveStatus={llmSaveStatus}
              saveMessage={llmSaveMessage}
              onChange={onChange}
              handleSave={handleSave}
            />
          ) : null}

          {activeSettingsSection === 'llm-routing' ? (
            <SettingsLlmPanel
              section="routing"
              settings={settings}
              isSaving={isSaving}
              saveStatus={llmSaveStatus}
              saveMessage={llmSaveMessage}
              onChange={onChange}
              handleSave={handleSave}
            />
          ) : null}

          {activeSettingsSection === 'test' ? (
            <SettingsTestPanel
              activeProject={workspace.activeProject}
              value={testQualitySettings}
              message={testQualityMessage}
              messageStatus={testQualityMessageStatus}
              isSaving={testQualityBusy}
              onChange={(next) => {
                setTestQualitySettings(next);
                setTestQualityMessage('');
                setTestQualityMessageStatus('idle');
              }}
              onSave={() => void saveTestQualitySettings()}
            />
          ) : null}

          {activeSettingsSection === 'hooks' ? (
            <SettingsHooksPanel
              workspace={workspace}
              hookForm={hookForm}
              setHookForm={setHookForm}
              hookMessage={hookMessage}
              hookMessageStatus={hookMessageStatus}
              setHookMessage={setHookMessage}
              setHookMessageStatus={setHookMessageStatus}
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
              mcpMessageStatus={mcpMessageStatus}
              setMcpMessage={setMcpMessage}
              setMcpMessageStatus={setMcpMessageStatus}
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
        </div>
      </main>
    </div>
  );
}
