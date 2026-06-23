import { CheckCircle2, TestTube2, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { Repository, TestQualitySettings } from '../types';
import { NumberField, SelectField } from './SettingsFields';

const coverageThresholdOptions = [70, 75, 80, 85, 90, 95, 100].map((value) => ({
  value: String(value),
  label: `${value}%`,
}));

export function SettingsTestPanel({
  activeProject,
  value,
  message,
  messageStatus,
  isSaving,
  onChange,
  onSave,
}: {
  activeProject: Repository | null;
  value: TestQualitySettings;
  message: string;
  messageStatus: 'idle' | 'success' | 'error';
  isSaving: boolean;
  onChange: (next: TestQualitySettings) => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const disabled = !activeProject || isSaving;

  return (
    <section className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
            <TestTube2 className="h-4 w-4 text-emerald-400" />
            {t('settings.test.title')}
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            {activeProject
              ? t('settings.test.projectFile', { project: activeProject.name })
              : t('settings.test.noProject')}
          </p>
        </div>
        <Button type="button" onClick={onSave} disabled={disabled} className="h-9 px-4 text-xs">
          {isSaving ? t('settings.saving') : t('settings.test.save')}
        </Button>
      </div>

      <label className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <input
          type="checkbox"
          checked={value.coverageGateEnabled}
          disabled={!activeProject}
          onChange={(event) => onChange({ ...value, coverageGateEnabled: event.target.checked })}
          className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-900"
        />
        <span>
          <span className="block text-xs font-semibold text-zinc-100">
            {t('settings.test.coverageGateEnabled')}
          </span>
          <span className="mt-1 block text-[10px] text-zinc-500">
            {t('settings.test.coverageGateHelp')}
          </span>
        </span>
      </label>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SelectField
          id="test-coverage-minimum"
          label={t('settings.test.coverageMinimum')}
          value={String(value.coverageMinimumPercent)}
          options={coverageThresholdOptions}
          onChange={(coverageMinimumPercent) =>
            onChange({ ...value, coverageMinimumPercent: Number(coverageMinimumPercent) })
          }
        />
        <NumberField
          id="test-coverage-max-iterations"
          label={t('settings.test.maxIterations')}
          value={value.coverageMaxIterations}
          min={1}
          onChange={(coverageMaxIterations) =>
            onChange({ ...value, coverageMaxIterations: Math.min(20, coverageMaxIterations) })
          }
        />
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
