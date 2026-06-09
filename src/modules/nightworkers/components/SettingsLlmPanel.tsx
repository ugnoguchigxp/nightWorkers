import { ExternalLink, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { LlmProvider, LlmSettings } from '../types';
import { PROVIDER_MODEL_OPTIONS } from '../types';
import { Field, SelectField } from './SettingsFields';
import { ProviderSectionHeader } from './SettingsProviderHeader';

type SmokeResult = { provider: LlmProvider; message: string } | null;

export function SettingsLlmPanel({
  settings,
  isSaving,
  smokingProvider,
  smokeResult,
  onChange,
  setProviderEnabled,
  handleSave,
  runProviderSmokeTest,
}: {
  settings: LlmSettings;
  isSaving: boolean;
  smokingProvider: LlmProvider | null;
  smokeResult: SmokeResult;
  onChange: <K extends keyof LlmSettings>(key: K, value: LlmSettings[K]) => void;
  setProviderEnabled: (provider: LlmProvider, enabled: boolean) => void;
  handleSave: (provider?: LlmProvider) => Promise<void>;
  runProviderSmokeTest: (provider: LlmProvider) => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
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
  );
}
