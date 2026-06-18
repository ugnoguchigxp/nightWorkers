import { CheckCircle2, Globe, RefreshCw, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { applyNightWorkersLanguage } from '../i18n/NightWorkersI18nProvider';
import type { GeneralSettings } from '../types';
import { SelectField } from './SettingsFields';

export function GeneralSettingsPanel({
  value,
  message,
  messageStatus,
  isRefreshingFx,
  onChange,
  onSave,
  onRefreshFx,
}: {
  value: GeneralSettings;
  message: string;
  messageStatus: 'idle' | 'success' | 'error';
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
      {message ? (
        <p
          role={messageStatus === 'error' ? 'alert' : 'status'}
          className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
            messageStatus === 'success'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
          }`}
        >
          {messageStatus === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <XCircle className="h-4 w-4 shrink-0" />
          )}
          <span>{message}</span>
        </p>
      ) : null}
    </section>
  );
}
