import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LlmProvider } from '../types';

export function ProviderSectionHeader({
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
