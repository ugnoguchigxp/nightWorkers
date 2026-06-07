import { CheckCircle2, Database, Palette, SlidersHorizontal, XCircle } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../../../lib/api-base';
import { BlueprintDbDesignPanel } from './BlueprintDbDesignPanel';
import { BlueprintPreviewSection } from './BlueprintPreviewSection';
import './blueprintPreview.css';
import {
  type BlueprintPreviewDesignSettings,
  blueprintPreviewDesignOptions,
  createBlueprintDesignReference,
  createBlueprintPreviewDesignSettings,
  designReferenceSummary,
} from './designSettings';
import {
  bindingForSection,
  labelForOption,
  labelForOptionA11y,
  tableForSection,
  toObjectArray,
} from './previewModel';

type BlueprintPreviewProps = {
  sessionId?: string | null;
  messageId?: string | null;
  blueprint: Record<string, any>;
  screens: Array<Record<string, any>>;
  tables: Array<Record<string, any>>;
  bindings: Array<Record<string, any>>;
  validationIssues?: Array<Record<string, any>>;
  isDbDesignSubmitting?: boolean;
  onSubmitDbDesignRequest?: (prompt: string) => Promise<void>;
};

export function BlueprintPreview({
  sessionId,
  messageId,
  blueprint,
  screens,
  tables,
  bindings,
  validationIssues = [],
  isDbDesignSubmitting = false,
  onSubmitDbDesignRequest,
}: BlueprintPreviewProps) {
  const { t } = useTranslation();
  const blueprintId = String(blueprint.id || blueprint.name || screens[0]?.id || 'draft-blueprint');
  const previousBlueprintId = useRef(blueprintId);
  const initialSettings = useMemo(
    () => createBlueprintPreviewDesignSettings(blueprint.designPreset),
    [blueprint.designPreset]
  );
  const [settings, setSettings] = useState<BlueprintPreviewDesignSettings>(initialSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dbDesignOpen, setDbDesignOpen] = useState(false);
  const blueprintAdoption = useBlueprintAdoption({
    sessionId,
    messageId,
    endpoint: 'blueprint-adoption',
  });
  const dbDesignAdoption = useBlueprintAdoption({
    sessionId,
    messageId,
    endpoint: 'blueprint-db-design-adoption',
  });
  const designTokenAdoption = useBlueprintAdoption({
    sessionId,
    messageId,
    endpoint: 'blueprint-design-token-adoption',
  });
  const saveRequestSeqRef = useRef(0);

  useEffect(() => {
    setSettings(initialSettings);
    if (!sessionId) return;
    const controller = new AbortController();
    apiFetch(`/api/tasks/${sessionId}/blueprint-design-settings`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as { settings?: unknown };
      })
      .then((data) => {
        if (controller.signal.aborted || !data?.settings) return;
        setSettings(createBlueprintPreviewDesignSettings(data.settings));
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          console.warn('Failed to load Blueprint design settings', error);
        }
      });
    return () => controller.abort();
  }, [initialSettings, sessionId]);

  useEffect(() => {
    if (previousBlueprintId.current === blueprintId) return;
    previousBlueprintId.current = blueprintId;
    setSettingsOpen(false);
    setDbDesignOpen(false);
  }, [blueprintId]);

  const designReference = useMemo(
    () =>
      createBlueprintDesignReference({
        blueprintId,
        settings,
      }),
    [blueprintId, settings]
  );

  const updateSettings = useCallback(
    (next: BlueprintPreviewDesignSettings) => {
      setSettings(next);
      if (!sessionId) return;
      const requestSeq = ++saveRequestSeqRef.current;
      apiFetch(`/api/tasks/${sessionId}/blueprint-design-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to save Blueprint design settings: ${res.status}`);
          return res.json();
        })
        .then((data: { settings?: unknown }) => {
          if (requestSeq !== saveRequestSeqRef.current || !data.settings) return;
          setSettings(createBlueprintPreviewDesignSettings(data.settings));
        })
        .catch((error) => {
          console.warn('Failed to save Blueprint design settings', error);
        });
    },
    [sessionId]
  );

  if (screens.length === 0) {
    return (
      <div className="rounded border border-slate-700/80 p-3 text-xs text-slate-400">
        {t('blueprint.preview.noScreens')}
      </div>
    );
  }

  const firstScreen = screens[0];
  const sections = toObjectArray(firstScreen?.sections);

  return (
    <div
      className="blueprint-preview grid gap-[var(--blueprint-preview-gap)] rounded-xl border border-border p-[var(--blueprint-preview-section-padding)] text-ui"
      data-blueprint-preview
      data-theme={settings.theme}
      data-density={settings.density}
      data-shape={settings.shape}
      data-shadow={settings.shadow}
      data-shadow-direction={settings.shadowDirection}
      data-font={settings.font}
      data-contrast={settings.contrast}
      data-motion={settings.motion}
      data-button-variant={settings.componentVariants.button}
      data-card-variant={settings.componentVariants.card}
      data-table-variant={settings.componentVariants.table}
      data-input-variant={settings.componentVariants.input}
    >
      <div className="flex flex-wrap items-center justify-end gap-2">
        <AdoptionToggle
          label={t('blueprint.preview.blueprint')}
          adopted={blueprintAdoption.adopted}
          disabled={!blueprintAdoption.enabled || blueprintAdoption.saving}
          onToggle={blueprintAdoption.toggle}
        />
        <div className="rounded-full border border-border bg-card px-3 py-1 text-[11px] text-muted-foreground">
          {t('blueprint.preview.sectionsCount', { count: sections.length })}
        </div>
        <button
          type="button"
          aria-expanded={settingsOpen}
          aria-controls="blueprint-design-settings"
          className={`blueprint-preview-button inline-flex h-8 items-center gap-2 border border-border px-3 text-xs font-semibold transition ${
            settingsOpen
              ? 'bg-primary text-primary-foreground hover:opacity-90'
              : 'bg-card text-foreground hover:bg-background'
          }`}
          onClick={() => setSettingsOpen((open) => !open)}
        >
          <Palette className="h-3.5 w-3.5" />
          {t('blueprint.preview.design')}
        </button>
        <button
          type="button"
          aria-expanded={dbDesignOpen}
          aria-controls="blueprint-db-design"
          className={`blueprint-preview-button inline-flex h-8 items-center gap-2 border border-border px-3 text-xs font-semibold transition ${
            dbDesignOpen
              ? 'bg-primary text-primary-foreground hover:opacity-90'
              : 'bg-card text-foreground hover:bg-background'
          }`}
          onClick={() => setDbDesignOpen((open) => !open)}
        >
          <Database className="h-3.5 w-3.5" />
          {t('blueprint.db.title')}
        </button>
      </div>

      {settingsOpen ? (
        <DesignSettingsPanel
          id="blueprint-design-settings"
          value={settings}
          designReference={designReference}
          adoption={
            <AdoptionToggle
              label={t('blueprint.preview.designTokens')}
              adopted={designTokenAdoption.adopted}
              disabled={!designTokenAdoption.enabled || designTokenAdoption.saving}
              onToggle={designTokenAdoption.toggle}
            />
          }
          onChange={updateSettings}
        />
      ) : null}

      {dbDesignOpen ? (
        <BlueprintDbDesignPanel
          id="blueprint-db-design"
          blueprint={blueprint}
          screens={screens}
          tables={tables}
          bindings={bindings}
          validationIssues={validationIssues}
          adoption={
            <AdoptionToggle
              label={t('blueprint.db.title')}
              adopted={dbDesignAdoption.adopted}
              disabled={!dbDesignAdoption.enabled || dbDesignAdoption.saving}
              onToggle={dbDesignAdoption.toggle}
            />
          }
          isSubmitting={isDbDesignSubmitting}
          onSubmitDbDesignRequest={onSubmitDbDesignRequest}
        />
      ) : null}

      <div className="grid gap-[var(--blueprint-preview-gap)]">
        {sections.map((section, index) => (
          <BlueprintPreviewSection
            key={String(section.id || index)}
            section={section}
            table={tableForSection(section, bindings, tables)}
            binding={bindingForSection(section, bindings)}
          />
        ))}
      </div>
    </div>
  );
}

type BlueprintAdoptionEndpoint =
  | 'blueprint-adoption'
  | 'blueprint-db-design-adoption'
  | 'blueprint-design-token-adoption';

function useBlueprintAdoption({
  sessionId,
  messageId,
  endpoint,
}: {
  sessionId?: string | null;
  messageId?: string | null;
  endpoint: BlueprintAdoptionEndpoint;
}) {
  const [adopted, setAdopted] = useState(false);
  const [saving, setSaving] = useState(false);
  const enabled = Boolean(sessionId && messageId);

  useEffect(() => {
    setAdopted(false);
    if (!sessionId || !messageId) return;
    const controller = new AbortController();
    apiFetch(`/api/tasks/${sessionId}/${endpoint}?messageId=${encodeURIComponent(messageId)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as { adopted?: boolean };
      })
      .then((data) => {
        if (controller.signal.aborted || !data) return;
        setAdopted(Boolean(data.adopted));
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          console.warn(`Failed to load Blueprint adoption state for ${endpoint}`, error);
        }
      });
    return () => controller.abort();
  }, [endpoint, messageId, sessionId]);

  const toggle = useCallback(() => {
    if (!sessionId || !messageId || saving) return;
    const next = !adopted;
    setAdopted(next);
    setSaving(true);
    apiFetch(`/api/tasks/${sessionId}/${endpoint}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, adopted: next }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to save Blueprint adoption: ${res.status}`);
        return res.json();
      })
      .then((data: { adopted?: boolean }) => {
        setAdopted(Boolean(data.adopted));
      })
      .catch((error) => {
        setAdopted(!next);
        console.warn(`Failed to save Blueprint adoption state for ${endpoint}`, error);
      })
      .finally(() => setSaving(false));
  }, [adopted, endpoint, messageId, saving, sessionId]);

  return { adopted, enabled, saving, toggle };
}

function AdoptionToggle({
  label,
  adopted,
  disabled,
  onToggle,
}: {
  label: string;
  adopted: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const Icon = adopted ? CheckCircle2 : XCircle;
  return (
    <button
      type="button"
      aria-pressed={adopted}
      className={`blueprint-preview-button inline-flex h-8 items-center gap-2 border px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
        adopted
          ? 'border-primary bg-primary text-primary-foreground hover:opacity-90'
          : 'border-border bg-card text-foreground hover:bg-background'
      }`}
      disabled={disabled}
      onClick={onToggle}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}: {adopted ? t('blueprint.preview.adopted') : t('blueprint.preview.notAdopted')}
    </button>
  );
}

function DesignSettingsPanel({
  id,
  value,
  designReference,
  adoption,
  onChange,
}: {
  id: string;
  value: BlueprintPreviewDesignSettings;
  designReference: ReturnType<typeof createBlueprintDesignReference>;
  adoption?: ReactNode;
  onChange: (next: BlueprintPreviewDesignSettings) => void;
}) {
  const { t } = useTranslation();

  return (
    <div id={id} className="blueprint-preview-card rounded-lg border p-3 text-xs">
      <div className="mb-3 flex items-start gap-2 text-muted-foreground">
        <SlidersHorizontal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-foreground">{t('blueprint.designSettings.title')}</div>
          <div className="mt-1 leading-5">{t('blueprint.designSettings.description')}</div>
        </div>
        {adoption ? <div className="shrink-0">{adoption}</div> : null}
      </div>
      <div className="grid gap-2">
        <SettingsGroup title={t('settings.appearance.theme')} summary={value.theme}>
          <OptionRow
            options={blueprintPreviewDesignOptions.theme}
            value={value.theme}
            onSelect={(theme) => onChange({ ...value, theme })}
          />
        </SettingsGroup>
        <SettingsGroup title={t('settings.appearance.density')} summary={value.density}>
          <OptionRow
            options={blueprintPreviewDesignOptions.density}
            value={value.density}
            onSelect={(density) => onChange({ ...value, density })}
          />
        </SettingsGroup>
        <SettingsGroup title={t('settings.appearance.shape')} summary={value.shape}>
          <OptionRow
            options={blueprintPreviewDesignOptions.shape}
            value={value.shape}
            onSelect={(shape) => onChange({ ...value, shape })}
          />
        </SettingsGroup>
        <SettingsGroup
          title={t('settings.appearance.shadow')}
          summary={`${value.shadow} / ${labelForOption(value.shadowDirection)}`}
        >
          <div className="grid gap-3">
            <VariantRow
              label={t('settings.appearance.strength')}
              options={blueprintPreviewDesignOptions.shadow}
              value={value.shadow}
              onSelect={(shadow) => onChange({ ...value, shadow })}
            />
            <VariantRow
              label={t('settings.appearance.direction')}
              options={blueprintPreviewDesignOptions.shadowDirection}
              value={value.shadowDirection}
              onSelect={(shadowDirection) => onChange({ ...value, shadowDirection })}
            />
          </div>
        </SettingsGroup>
        <SettingsGroup title={t('settings.appearance.font')} summary={value.font}>
          <OptionRow
            options={blueprintPreviewDesignOptions.font}
            value={value.font}
            onSelect={(font) => onChange({ ...value, font })}
          />
        </SettingsGroup>
        <SettingsGroup title={t('settings.appearance.contrast')} summary={value.contrast}>
          <OptionRow
            options={blueprintPreviewDesignOptions.contrast}
            value={value.contrast}
            onSelect={(contrast) => onChange({ ...value, contrast })}
          />
        </SettingsGroup>
        <SettingsGroup title={t('settings.appearance.motion')} summary={value.motion}>
          <OptionRow
            options={blueprintPreviewDesignOptions.motion}
            value={value.motion}
            onSelect={(motion) => onChange({ ...value, motion })}
          />
        </SettingsGroup>
        <SettingsGroup
          title={t('settings.appearance.componentVariants')}
          summary={t('settings.appearance.componentSummary')}
        >
          <div className="grid gap-3">
            <VariantRow
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
            <VariantRow
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
            <VariantRow
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
            <VariantRow
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
        </SettingsGroup>
        <details className="rounded border border-border bg-card">
          <summary className="cursor-pointer select-none px-3 py-2 font-semibold text-foreground">
            {t('blueprint.designSettings.implementationPlanAttachment')}
          </summary>
          <div className="border-border border-t p-3">
            <pre className="whitespace-pre-wrap rounded border border-border bg-background p-2 font-mono text-[11px] leading-5 text-foreground">
              {designReferenceSummary(designReference.settings)}
            </pre>
          </div>
        </details>
      </div>
    </div>
  );
}

function SettingsGroup({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded border border-border bg-card">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <span className="font-semibold text-foreground">{title}</span>
        <span className="rounded border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
          {summary}
        </span>
      </div>
      <div className="border-border border-t p-3">{children}</div>
    </section>
  );
}

function VariantRow<const T extends readonly string[]>({
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
    <div className="grid gap-1.5">
      <div className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</div>
      <OptionRow options={options} value={value} onSelect={onSelect} />
    </div>
  );
}

function OptionRow<const T extends readonly string[]>({
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
          aria-label={labelForOptionA11y(option)}
          className={`blueprint-preview-option rounded border px-2.5 py-1 text-[11px] font-semibold transition ${
            option === value
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-foreground hover:bg-secondary'
          }`}
          aria-pressed={option === value}
          onClick={() => onSelect(option)}
        >
          {labelForOption(option)}
        </button>
      ))}
    </div>
  );
}
