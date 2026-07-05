import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyAppLanguage } from '../../i18n/I18nProvider';
import { AppearanceSettings } from '../blueprint-preview';
import { SettingsHooksPanel } from '../hooks/SettingsHooksPanel';
import { SettingsMcpPanel } from '../mcp/SettingsMcpPanel';
import {
  useWorkspaceAppearanceActions,
  useWorkspaceAppearanceState,
} from '../nightworkers/contexts/WorkspaceAppearanceContext';
import { handleWorkbenchAnchorClick } from '../nightworkers/routing/workbench-link-click';
import { serializeWorkbenchRoute } from '../nightworkers/routing/workbench-route-state';
import {
  defaultTestQualitySettings,
  type GeneralSettings,
  type LlmSettings,
  type Repository,
  type TestQualitySettings,
} from '../nightworkers/types';
import { GeneralSettingsPanel } from './SettingsGeneralPanel';
import { SettingsLlmPanel } from './SettingsLlmPanel';
import { SettingsPlanModePanel } from './SettingsPlanModePanel';
import { SettingsTestPanel } from './SettingsTestPanel';
import {
  fetchGeneralSettings,
  fetchLlmSettings,
  fetchTestQualitySettings,
  refreshFxRates as refreshFxRatesCommand,
  saveGeneralSettings as saveGeneralSettingsCommand,
  saveLlmSettings,
  saveTestQualitySettings as saveTestQualitySettingsCommand,
} from './settingsCommands';

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
  defaultGeneralSettings,
  mergeGeneralSettings,
  type SettingsSectionId,
  settingsSections,
} from './SettingsForms';

export function SettingsScreen({
  activeProject,
  activeSection = 'general',
  onSectionChange,
  onClose,
}: {
  activeProject: Repository | null;
  activeSection?: SettingsSectionId;
  onSectionChange?: (section: SettingsSectionId) => void;
  onClose: () => void;
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
  const [testQualitySettings, setTestQualitySettings] = useState<TestQualitySettings>(
    defaultTestQualitySettings
  );
  const [testQualityMessage, setTestQualityMessage] = useState('');
  const [testQualityMessageStatus, setTestQualityMessageStatus] =
    useState<SaveFeedbackStatus>('idle');
  const [testQualityBusy, setTestQualityBusy] = useState(false);
  const { settings: appearanceSettings } = useWorkspaceAppearanceState();
  const { setAppearanceSettings, resetAppearanceSettings } = useWorkspaceAppearanceActions();

  const activeSectionMeta =
    settingsSections.find((section) => section.id === activeSection) || settingsSections[0];
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
    if (!activeProject) {
      setTestQualitySettings(defaultTestQualitySettings);
      setTestQualityMessage('');
      setTestQualityMessageStatus('idle');
      return;
    }

    let cancelled = false;
    setTestQualityBusy(true);
    setTestQualityMessage('');
    setTestQualityMessageStatus('idle');
    fetchTestQualitySettings(activeProject.id)
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
  }, [activeProject, t]);

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
    void applyAppLanguage(saved.language);
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
    if (!activeProject) {
      setTestQualityMessage(t('settings.test.noProject'));
      setTestQualityMessageStatus('error');
      return;
    }

    setTestQualityBusy(true);
    setTestQualityMessage('');
    setTestQualityMessageStatus('idle');
    try {
      const res = await saveTestQualitySettingsCommand(activeProject.id, testQualitySettings);
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
        <a
          href={serializeWorkbenchRoute({ kind: 'overview', range: '30d', projectId: null })}
          onClick={(event) => handleWorkbenchAnchorClick(event, onClose)}
          className="mb-5 inline-flex items-center gap-2 rounded-lg border border-zinc-700/50 bg-zinc-800 px-3 py-2 text-left text-xs text-zinc-300"
        >
          ← {t('settings.backToApp')}
        </a>
        <div className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          {t('settings.title')}
        </div>
        <nav className="grid gap-1" aria-label={t('settings.sections')}>
          {settingsSections.map((section) => {
            const Icon = section.icon;
            const active = activeSection === section.id;
            return (
              <a
                key={section.id}
                href={serializeWorkbenchRoute({ kind: 'settings', section: section.id })}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-xs ${
                  active
                    ? 'border-indigo-500/70 bg-indigo-500/15 text-zinc-100'
                    : 'border-transparent text-zinc-400 hover:border-zinc-800 hover:bg-zinc-900/60 hover:text-zinc-200'
                }`}
                aria-current={active ? 'page' : undefined}
                onClick={(event) =>
                  handleWorkbenchAnchorClick(event, () => onSectionChange?.(section.id))
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block font-semibold">{t(section.labelKey)}</span>
                  <span className="block truncate text-[10px] opacity-70">
                    {t(section.descriptionKey)}
                  </span>
                </span>
              </a>
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

          {activeSection === 'general' ? (
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

          {activeSection === 'plan-mode' ? (
            <SettingsPlanModePanel
              value={generalSettings}
              message={generalMessage}
              messageStatus={generalMessageStatus}
              onChange={setGeneralSettings}
              onSave={() => void saveGeneralSettings()}
            />
          ) : null}

          {activeSection === 'appearance' ? (
            <AppearanceSettings
              value={appearanceSettings}
              onChange={setAppearanceSettings}
              onReset={resetAppearanceSettings}
            />
          ) : null}

          {activeSection === 'llm-providers' ? (
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

          {activeSection === 'llm-routing' ? (
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

          {activeSection === 'test' ? (
            <SettingsTestPanel
              activeProject={activeProject}
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

          {activeSection === 'hooks' ? <SettingsHooksPanel /> : null}

          {activeSection === 'mcp' ? <SettingsMcpPanel /> : null}
        </div>
      </main>
    </div>
  );
}
