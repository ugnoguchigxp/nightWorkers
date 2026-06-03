import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/design-system';
import { Pause, Play, RefreshCw, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { NightWorkersWorkspaceState } from '../hooks/useNightWorkersWorkspace';
import { type LlmProvider, type LlmSettings, PROVIDER_MODEL_OPTIONS } from '../types';

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

type ProviderDef = { id: LlmProvider; name: string };

export function SettingsScreen({
  onClose,
  workspace,
}: {
  onClose: () => void;
  workspace: NightWorkersWorkspaceState;
}) {
  const [activeTab, setActiveTab] = useState<LlmProvider>('azure');
  const [settings, setSettings] = useState<LlmSettings>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [smokeResult, setSmokeResult] = useState<string>('');

  const providers: ProviderDef[] = [
    { id: 'azure', name: 'Azure OpenAI' },
    { id: 'openai', name: 'OpenAI 本家' },
    { id: 'bedrock', name: 'AWS Bedrock' },
    { id: 'codex', name: 'Codex SDK' },
  ];

  useEffect(() => {
    fetch('/api/settings/llm')
      .then((res) => res.json())
      .then((data: Partial<LlmSettings>) => {
        const merged = { ...defaultSettings, ...data };
        setSettings(merged);
        setActiveTab(merged.ACTIVE_LLM_PROVIDER || 'azure');
      })
      .finally(() => setIsLoading(false));
  }, []);

  const handleSave = async (providerOverride?: LlmProvider) => {
    setIsSaving(true);
    const updated = {
      ...settings,
      ACTIVE_LLM_PROVIDER: providerOverride ?? activeTab,
    };
    const res = await fetch('/api/settings/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    if (res.ok) {
      setSettings(updated);
      if (providerOverride) setActiveTab(providerOverride);
    } else {
      alert('設定の保存に失敗しました');
    }
    setIsSaving(false);
  };

  const onChange = <K extends keyof LlmSettings>(key: K, value: LlmSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const providerEnabledMap: Record<LlmProvider, boolean> = {
    openai: settings.OPENAI_ENABLED,
    azure: settings.AZURE_OPENAI_ENABLED,
    bedrock: settings.AWS_BEDROCK_ENABLED,
    codex: settings.CODEX_ENABLED,
  };

  const setProviderEnabled = (provider: LlmProvider, enabled: boolean) => {
    if (provider === 'openai') onChange('OPENAI_ENABLED', enabled);
    if (provider === 'azure') onChange('AZURE_OPENAI_ENABLED', enabled);
    if (provider === 'bedrock') onChange('AWS_BEDROCK_ENABLED', enabled);
    if (provider === 'codex') onChange('CODEX_ENABLED', enabled);
    void workspace.toggleProviderEnabled(provider, enabled);
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#121214] text-zinc-500">
        設定をロード中...
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#121214] p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
          <h1 className="flex items-center gap-2 text-xl font-bold text-zinc-100">
            <Settings className="h-5 w-5 text-indigo-400" />
            LLMプロバイダー設定
          </h1>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-700/50 bg-zinc-800 px-4 py-1.5 text-xs text-zinc-300"
          >
            戻る
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {providers.map((provider) => {
            const isActive = settings.ACTIVE_LLM_PROVIDER === provider.id;
            return (
              <div
                key={provider.id}
                className={`rounded-xl border-2 p-3 text-xs ${isActive ? 'border-indigo-500 text-indigo-400' : 'border-zinc-800 text-zinc-400'}`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span>{provider.name}</span>
                  <label htmlFor={`${provider.id}-enabled`} className="text-[10px] text-zinc-400">
                    Enabled
                  </label>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <input
                    id={`${provider.id}-enabled`}
                    type="checkbox"
                    checked={providerEnabledMap[provider.id]}
                    onChange={(e) => setProviderEnabled(provider.id, e.target.checked)}
                  />
                  <button
                    type="button"
                    onClick={() => void handleSave(provider.id)}
                    disabled={!providerEnabledMap[provider.id]}
                    className="rounded bg-zinc-800 px-2 py-1 text-[10px] disabled:opacity-50"
                  >
                    {isActive ? 'Active' : 'Activate'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-b border-zinc-800">
          <div className="flex gap-4 text-xs font-semibold">
            {providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                onClick={() => setActiveTab(provider.id)}
                className={`pb-3 ${activeTab === provider.id ? 'border-b-2 border-indigo-500 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                {provider.name}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
          {activeTab === 'azure' ? (
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
          ) : null}

          {activeTab === 'openai' ? (
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
          ) : null}

          {activeTab === 'bedrock' ? (
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
          ) : null}

          {activeTab === 'codex' ? (
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
          ) : null}

          <div className="flex justify-end border-t border-zinc-800/80 pt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={async () => {
                const result = await workspace.runLlmSmokeTest();
                setSmokeResult(`${result.provider}: ${result.ok ? 'OK' : 'NG'} ${result.message}`);
              }}
              className="mr-2 h-9 px-5 text-xs"
            >
              Smoke Test
            </Button>
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
          {smokeResult ? <p className="text-xs text-zinc-400">{smokeResult}</p> : null}
        </div>

        <div className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-bold text-zinc-100">Session Queue</h2>
              <p className="mt-1 text-xs text-zinc-500">
                queued Session の自動起動数を制御します。
              </p>
            </div>
            <div className="flex items-end gap-2">
              <NumberField
                id="session-queue-global"
                label="全体同時Processing"
                value={settings.SESSION_QUEUE_MAX_CONCURRENCY}
                min={1}
                onChange={(v) => onChange('SESSION_QUEUE_MAX_CONCURRENCY', v)}
              />
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSaving}
                className="h-9 px-4 text-xs"
              >
                {isSaving ? <RefreshCw className="h-3 w-3 animate-spin" /> : null}
                保存
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            {workspace.projects.length === 0 ? (
              <p className="text-xs text-zinc-500">登録済みプロジェクトはありません。</p>
            ) : (
              workspace.projects.map((project) => (
                <div
                  key={project.id}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-zinc-200">
                      {project.name}
                    </div>
                    <div className="truncate text-[10px] text-zinc-500">{project.localPath}</div>
                  </div>
                  <NumberField
                    id={`project-max-${project.id}`}
                    label="Project上限"
                    value={project.maxConcurrentSessions}
                    min={1}
                    onChange={(value) =>
                      void workspace.updateProject(project.id, {
                        maxConcurrentSessions: value,
                      })
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      void workspace.updateProject(project.id, {
                        queueEnabled: !project.queueEnabled,
                      })
                    }
                    className={`flex h-9 items-center gap-2 rounded-lg border px-3 text-xs ${
                      project.queueEnabled
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-300'
                    }`}
                  >
                    {project.queueEnabled ? (
                      <Pause className="h-3.5 w-3.5" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    {project.queueEnabled ? 'Pause' : 'Play'}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
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
