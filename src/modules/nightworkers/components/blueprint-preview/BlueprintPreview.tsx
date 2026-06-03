import { CheckCircle2, Database, Palette, SlidersHorizontal, XCircle } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BlueprintDbDesignPanel } from './BlueprintDbDesignPanel';
import './blueprintPreview.css';
import {
  type BlueprintPreviewDesignSettings,
  blueprintPreviewDesignOptions,
  createBlueprintDesignReference,
  createBlueprintPreviewDesignSettings,
  designReferenceSummary,
} from './designSettings';

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
    fetch(`/api/tasks/${sessionId}/blueprint-design-settings`, { signal: controller.signal })
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
      fetch(`/api/tasks/${sessionId}/blueprint-design-settings`, {
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
        No screens defined.
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
          label="Blueprint"
          adopted={blueprintAdoption.adopted}
          disabled={!blueprintAdoption.enabled || blueprintAdoption.saving}
          onToggle={blueprintAdoption.toggle}
        />
        <div className="rounded-full border border-border bg-card px-3 py-1 text-[11px] text-muted-foreground">
          {sections.length} sections
        </div>
        <button
          type="button"
          aria-expanded={settingsOpen}
          aria-controls="blueprint-design-settings"
          className="blueprint-preview-button inline-flex h-8 items-center gap-2 border border-border bg-primary px-3 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
          onClick={() => setSettingsOpen((open) => !open)}
        >
          <Palette className="h-3.5 w-3.5" />
          Design
        </button>
        <button
          type="button"
          aria-expanded={dbDesignOpen}
          aria-controls="blueprint-db-design"
          className="blueprint-preview-button inline-flex h-8 items-center gap-2 border border-border bg-card px-3 text-xs font-semibold text-foreground transition hover:bg-background"
          onClick={() => setDbDesignOpen((open) => !open)}
        >
          <Database className="h-3.5 w-3.5" />
          DB Design
        </button>
      </div>

      {settingsOpen ? (
        <DesignSettingsPanel
          id="blueprint-design-settings"
          value={settings}
          designReference={designReference}
          adoption={
            <AdoptionToggle
              label="Design Tokens"
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
          blueprint={blueprint}
          screens={screens}
          tables={tables}
          bindings={bindings}
          validationIssues={validationIssues}
          adoption={
            <AdoptionToggle
              label="DB Design"
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
    fetch(`/api/tasks/${sessionId}/${endpoint}?messageId=${encodeURIComponent(messageId)}`, {
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
    fetch(`/api/tasks/${sessionId}/${endpoint}`, {
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
      {label}: {adopted ? 'Adopted' : 'Not adopted'}
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
  return (
    <div id={id} className="blueprint-preview-card rounded-lg border p-3 text-xs">
      <div className="mb-3 flex items-start gap-2 text-muted-foreground">
        <SlidersHorizontal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-foreground">Design reference settings</div>
          <div className="mt-1 leading-5">
            Preview is a specification-review mock. These selected tokens can be attached to later
            implementation plans.
          </div>
        </div>
        {adoption ? <div className="shrink-0">{adoption}</div> : null}
      </div>
      <div className="grid gap-2">
        <SettingsGroup title="Theme" summary={value.theme}>
          <OptionRow
            options={blueprintPreviewDesignOptions.theme}
            value={value.theme}
            onSelect={(theme) => onChange({ ...value, theme })}
          />
        </SettingsGroup>
        <SettingsGroup title="Density" summary={value.density}>
          <OptionRow
            options={blueprintPreviewDesignOptions.density}
            value={value.density}
            onSelect={(density) => onChange({ ...value, density })}
          />
        </SettingsGroup>
        <SettingsGroup title="Shape" summary={value.shape}>
          <OptionRow
            options={blueprintPreviewDesignOptions.shape}
            value={value.shape}
            onSelect={(shape) => onChange({ ...value, shape })}
          />
        </SettingsGroup>
        <SettingsGroup
          title="Shadow"
          summary={`${value.shadow} / ${labelForOption(value.shadowDirection)}`}
        >
          <div className="grid gap-3">
            <VariantRow
              label="Strength"
              options={blueprintPreviewDesignOptions.shadow}
              value={value.shadow}
              onSelect={(shadow) => onChange({ ...value, shadow })}
            />
            <VariantRow
              label="Direction"
              options={blueprintPreviewDesignOptions.shadowDirection}
              value={value.shadowDirection}
              onSelect={(shadowDirection) => onChange({ ...value, shadowDirection })}
            />
          </div>
        </SettingsGroup>
        <SettingsGroup title="Font" summary={value.font}>
          <OptionRow
            options={blueprintPreviewDesignOptions.font}
            value={value.font}
            onSelect={(font) => onChange({ ...value, font })}
          />
        </SettingsGroup>
        <SettingsGroup title="Contrast" summary={value.contrast}>
          <OptionRow
            options={blueprintPreviewDesignOptions.contrast}
            value={value.contrast}
            onSelect={(contrast) => onChange({ ...value, contrast })}
          />
        </SettingsGroup>
        <SettingsGroup title="Motion" summary={value.motion}>
          <OptionRow
            options={blueprintPreviewDesignOptions.motion}
            value={value.motion}
            onSelect={(motion) => onChange({ ...value, motion })}
          />
        </SettingsGroup>
        <SettingsGroup title="Component variants" summary="button / card / table / input">
          <div className="grid gap-3">
            <VariantRow
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
            <VariantRow
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
            <VariantRow
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
            <VariantRow
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
        </SettingsGroup>
        <details className="rounded border border-border bg-card">
          <summary className="cursor-pointer select-none px-3 py-2 font-semibold text-foreground">
            Implementation-plan attachment
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

function BlueprintPreviewSection({
  section,
  table,
  binding,
}: {
  section: Record<string, any>;
  table: Record<string, any> | null;
  binding: Record<string, any> | null;
}) {
  const componentName = String(section.componentName || '');
  const props = isObject(section.props) ? section.props : {};
  const title = String(props.title || section.name || section.id || componentName || 'Section');
  const description = String(props.description || section.intent || section.visualIntent || '');
  const body = renderPreviewSectionBody(componentName, props, table, binding);

  return (
    <section className="blueprint-preview-card overflow-hidden border">
      <header className="flex items-start justify-between gap-3 border-border border-b bg-secondary px-[var(--blueprint-preview-section-padding)] py-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-card-foreground">{title}</h3>
          {description ? (
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        <span className="shrink-0 rounded border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground">
          {componentName}
        </span>
      </header>
      <div className="p-[var(--blueprint-preview-section-padding)]">{body}</div>
    </section>
  );
}

function renderPreviewSectionBody(
  componentName: string,
  props: Record<string, any>,
  table: Record<string, any> | null,
  binding: Record<string, any> | null
) {
  if (
    componentName === 'SplitHeroSection' ||
    componentName === 'HeroSection' ||
    componentName === 'LandingHeroSection' ||
    componentName === 'ProductHeroSection'
  ) {
    const title = String(props.headline || props.title || props.name || 'Hero');
    const description = String(props.description || props.subtitle || props.body || '');
    const highlights = Array.isArray(props.highlights) ? props.highlights.map(String) : [];
    const actions = [
      ...(isObject(props.primaryCta) ? [props.primaryCta] : []),
      ...(isObject(props.secondaryCta) ? [props.secondaryCta] : []),
      ...toObjectArray(props.actions),
    ];

    return (
      <div className="grid gap-[var(--blueprint-preview-gap)] md:grid-cols-[minmax(0,1fr)_minmax(16rem,24rem)]">
        <div className="grid content-center gap-3">
          <div>
            <div className="text-2xl font-semibold tracking-normal text-foreground">{title}</div>
            {description ? (
              <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {highlights.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {highlights.slice(0, 4).map((highlight, index) => (
                <span
                  className="rounded border border-border bg-muted px-2 py-1 text-[11px] text-foreground"
                  key={`${highlight}-${index}`}
                >
                  {highlight}
                </span>
              ))}
            </div>
          ) : null}
          {actions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {actions.slice(0, 2).map((action, index) => (
                <span
                  className={`blueprint-preview-button rounded px-3 py-2 text-xs font-semibold ${
                    index === 0
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border text-foreground'
                  }`}
                  key={String(action.id || action.label || index)}
                >
                  {String(action.label || action.title || `Action ${index + 1}`)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <img
          alt={previewImageAlt(props, title)}
          className="aspect-video min-h-48 w-full rounded-md border border-border object-cover"
          loading="lazy"
          src={previewImageFor(props, 'large', title)}
        />
      </div>
    );
  }

  if (
    componentName === 'ImageSection' ||
    componentName === 'MediaSection' ||
    componentName === 'BannerImageSection' ||
    componentName === 'FeatureImageSection'
  ) {
    const label = String(props.alt || props.caption || props.title || componentName);
    return (
      <figure className="grid gap-2">
        <img
          alt={label}
          className="aspect-video max-h-80 w-full rounded-md border border-border object-cover"
          loading="lazy"
          src={previewImageFor(props, 'large', label)}
        />
        {props.caption ? (
          <figcaption className="text-xs leading-5 text-muted-foreground">
            {String(props.caption)}
          </figcaption>
        ) : null}
      </figure>
    );
  }

  if (componentName === 'KpiSummarySection') {
    const items = toObjectArray(props.items);
    const metricItems =
      items.length > 0
        ? items
        : [
            { label: String(props.title || 'Primary signal'), value: '-' },
            { label: String(binding?.name || table?.label || 'Secondary signal'), value: '-' },
            { label: 'Next action', value: String(props.actionLabel || '-') },
          ];
    return (
      <div className="grid gap-[var(--blueprint-preview-gap)] sm:grid-cols-3">
        {metricItems.slice(0, 3).map((item, index) => (
          <div
            key={String(item.label || index)}
            className="blueprint-preview-card rounded-md border p-3"
          >
            <div className="text-[11px] text-muted-foreground">
              {String(item.label || 'Metric')}
            </div>
            <div className="mt-2 text-2xl font-semibold text-foreground">
              {String(item.value || ('description' in item ? item.description : '') || index + 1)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (
    componentName === 'ChartSection' ||
    componentName === 'ChartInsightSection' ||
    componentName === 'ProgressListSection' ||
    componentName === 'StatsTrendCardsSection'
  ) {
    const chartItems = chartPreviewItems(props, table, binding);
    return (
      <div className="grid gap-[var(--blueprint-preview-gap)] md:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="h-44 rounded-md border border-border bg-muted p-2">
          <ResponsiveContainer height="100%" width="100%">
            <BarChart data={chartItems} margin={{ top: 8, right: 8, bottom: 4, left: -12 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                axisLine={{ stroke: 'var(--border)' }}
                dataKey="label"
                interval={0}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
                tickFormatter={compactChartLabel}
                tickLine={false}
              />
              <YAxis
                axisLine={false}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
                tickLine={false}
                width={30}
              />
              <Tooltip
                cursor={{ fill: 'color-mix(in srgb, var(--primary) 10%, transparent)' }}
                contentStyle={{
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  color: 'var(--foreground)',
                  fontSize: 11,
                }}
                formatter={(value) => [String(value), 'Value']}
                labelStyle={{ color: 'var(--muted-foreground)' }}
              />
              <Bar dataKey="value" fill="var(--primary)" maxBarSize={44} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="grid content-start gap-2">
          {chartItems.slice(0, 4).map((item) => (
            <div
              className="flex items-center justify-between gap-3 rounded border border-border bg-card px-2 py-1.5 text-xs"
              key={item.label}
            >
              <span className="truncate text-muted-foreground">{item.label}</span>
              <span className="font-medium text-foreground">{item.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (componentName === 'DataTableSection') {
    const columns = previewColumns(props, table, binding);
    const rows = previewRows(props, columns);
    return (
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <table className="blueprint-preview-table w-full min-w-[32rem] border-collapse text-left text-xs">
          <thead className="bg-secondary text-muted-foreground">
            <tr>
              {columns.map((column) => (
                <th className="px-3 py-2 font-semibold uppercase" key={column.key}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr className="border-border border-t odd:bg-muted/50" key={rowIndex}>
                {columns.map((column) => (
                  <td className="px-3 py-2 text-foreground" key={column.key}>
                    {String(row[column.key] || '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (
    componentName === 'MainSearchNavigationSection' ||
    componentName === 'NavigationPanel' ||
    componentName === 'HoldingsListSection'
  ) {
    const links = toObjectArray(props.links).map((link) => String(link.label || link.href));
    const tabs = Array.isArray(props.tabs) ? props.tabs.map(String) : [];
    const navLabels = [...links, ...tabs];
    const labels = navLabels.length > 0 ? navLabels : ['Primary', 'In focus', 'Follow-up'];
    return (
      <div className="grid gap-[var(--blueprint-preview-gap)]">
        {componentName === 'MainSearchNavigationSection' ? (
          <div className="flex min-h-[var(--blueprint-preview-control-height)] overflow-hidden rounded-md border border-border bg-card">
            <div className="flex-1 px-3 py-2 text-xs text-muted-foreground">
              {String(props.searchPlaceholder || 'Search...')}
            </div>
            <div className="blueprint-preview-button bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground">
              {String(props.searchButtonLabel || 'Search')}
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {labels.map((label, index) => (
            <span
              className={`rounded-full border px-3 py-1 text-xs ${
                index === 0
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground'
              }`}
              key={`${label}-${index}`}
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (
    componentName === 'CarouselSection' ||
    componentName === 'ProductCarouselSection' ||
    componentName === 'ThumbnailCarouselSection'
  ) {
    const sourceItems = toObjectArray(props.items || props.slides || props.cards || props.products);
    const items: Array<Record<string, any>> =
      sourceItems.length > 0
        ? sourceItems
        : previewGenericItems(props, table, binding).map((item) => ({
            title: item.title,
            description: item.description,
          }));

    return (
      <div className="flex gap-[var(--blueprint-preview-gap)] overflow-hidden">
        {items.slice(0, 4).map((item, index) => (
          <article
            className="blueprint-preview-card min-w-44 flex-1 rounded-md border p-2"
            key={String(item.id || item.title || item.label || index)}
          >
            <img
              alt={previewImageAlt(item, `Carousel item ${index + 1}`)}
              className="aspect-video w-full rounded border border-border object-cover"
              loading="lazy"
              src={previewImageFor(item, 'small', `${componentName}-${index}`)}
            />
            <div className="mt-2 truncate text-xs font-medium text-foreground">
              {String(item.title || item.label || `Item ${index + 1}`)}
            </div>
            <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
              {String(item.description || item.body || item.caption || '')}
            </div>
          </article>
        ))}
      </div>
    );
  }

  if (componentName === 'FormSection') {
    const fields = previewColumns(props, table, binding).slice(0, 4);
    return (
      <div className="grid gap-[var(--blueprint-preview-gap)]">
        {fields.map((field) => (
          <div className="grid gap-1.5" key={field.key}>
            <span className="text-[11px] font-medium text-muted-foreground">{field.label}</span>
            <span className="blueprint-preview-field rounded-md border border-input bg-background px-3 py-2 text-xs text-muted-foreground">
              {field.label}
            </span>
          </div>
        ))}
        <div className="blueprint-preview-button mt-1 w-fit bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground">
          {String(props.submitLabel || 'Save')}
        </div>
      </div>
    );
  }

  if (componentName === 'KanbanSection') {
    const propColumns = toObjectArray(props.columns);
    const columns =
      propColumns.length > 0
        ? propColumns
        : ['Backlog', 'In progress', 'Done'].map((title, index) => ({
            title,
            cards: [
              {
                title: `${title} item`,
                description: index === 0 ? binding?.name : table?.label || table?.name,
              },
            ],
          }));
    return (
      <div className="grid gap-[var(--blueprint-preview-gap)] md:grid-cols-3">
        {columns.slice(0, 4).map((column, index) => (
          <div
            className="rounded-md border border-border bg-muted p-3"
            key={String(column.title || index)}
          >
            <div className="mb-3 text-xs font-semibold uppercase text-muted-foreground">
              {String(column.title || `Column ${index + 1}`)}
            </div>
            <div className="grid gap-2">
              {toObjectArray(column.cards)
                .slice(0, 3)
                .map((card, cardIndex) => (
                  <div
                    className="blueprint-preview-card rounded border p-2"
                    key={String(card.title || cardIndex)}
                  >
                    <div className="text-xs font-medium text-foreground">
                      {String(card.title || 'Card')}
                    </div>
                    <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                      {String(card.description || '')}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (
    componentName === 'CardGridSection' ||
    componentName === 'ProductGridSection' ||
    componentName === 'CollectionGridSection'
  ) {
    const items = toObjectArray(props.items || props.cards || props.products);
    const cards =
      items.length > 0
        ? items
        : previewColumns(props, table, binding)
            .slice(0, 3)
            .map((column) => ({
              title: column.label,
              description: `Bound to ${column.key}`,
              badge: table ? String(table.label || table.name) : 'Blueprint',
            }));
    return (
      <div className="grid gap-[var(--blueprint-preview-gap)] sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card, index) => (
          <article
            key={String(card.title || index)}
            className="blueprint-preview-card rounded-md border p-3"
          >
            <img
              alt={previewImageAlt(card, `Card ${index + 1}`)}
              className="mb-3 aspect-video w-full rounded border border-border object-cover"
              loading="lazy"
              src={previewImageFor(card, 'small', `${componentName}-${index}`)}
            />
            <div className="font-medium text-foreground">{String(card.title || 'Card')}</div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {String(card.description || '')}
            </p>
            {card.badge ? (
              <div className="mt-3 w-fit rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                {String(card.badge)}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    );
  }

  if (
    componentName === 'CalendarSection' ||
    componentName === 'ScheduleSection' ||
    componentName === 'CheckoutSummarySection'
  ) {
    const entries = toObjectArray(props.entries || props.events || props.lines);
    const rows =
      entries.length > 0
        ? entries
        : [
            { title: 'Planning review', date: '2026-06-03', amount: '$1,240' },
            { title: 'Implementation', date: '2026-06-04', amount: '$860' },
            { title: 'Validation', date: '2026-06-05', amount: '$420' },
          ];
    const showThumbnails = componentName === 'CheckoutSummarySection';
    return (
      <div className="grid gap-2">
        {rows.slice(0, 5).map((row, index) => (
          <div
            className="flex items-center justify-between gap-3 rounded border border-border bg-card px-3 py-2 text-xs"
            key={String(row.title || row.label || index)}
          >
            <div className="flex min-w-0 items-center gap-3">
              {showThumbnails ? (
                <img
                  alt={previewImageAlt(row, `Line item ${index + 1}`)}
                  className="aspect-video h-12 w-20 shrink-0 rounded border border-border object-cover"
                  loading="lazy"
                  src={previewImageFor(row, 'small', `${componentName}-${index}`)}
                />
              ) : null}
              <div className="min-w-0">
                <div className="truncate font-medium text-foreground">
                  {String(row.title || row.label || `Item ${index + 1}`)}
                </div>
                <div className="mt-0.5 truncate text-muted-foreground">
                  {String(row.date || row.status || '')}
                </div>
              </div>
            </div>
            <div className="shrink-0 text-foreground">{String(row.amount || row.value || '')}</div>
          </div>
        ))}
      </div>
    );
  }

  if (
    componentName === 'ActivityFeedSection' ||
    componentName === 'NotificationCenterSection' ||
    componentName === 'ChatPanelSection'
  ) {
    const items = toObjectArray(props.items || props.messages);
    const feed =
      items.length > 0
        ? items
        : [
            { actor: 'System', action: 'validated', target: binding?.name || 'Blueprint' },
            { actor: 'Agent', action: 'mapped', target: table?.label || table?.name || 'Data' },
            { actor: 'User', action: 'reviewed', target: 'Preview' },
          ];
    return (
      <div className="grid gap-2">
        {feed.slice(0, 5).map((item, index) => (
          <div className="blueprint-preview-card rounded-md border p-3" key={index}>
            <div className="text-xs font-medium text-foreground">
              {String(item.title || item.author || item.actor || `Update ${index + 1}`)}
            </div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              {String(
                item.body || item.content || `${item.action || 'updated'} ${item.target || ''}`
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (
    componentName === 'AccordionSection' ||
    componentName === 'ComparisonSection' ||
    componentName === 'QuickActionsSection' ||
    componentName === 'ControlPanelSection' ||
    componentName === 'EditorPreviewSection' ||
    componentName === 'InsightPanel' ||
    componentName === 'EmptyState' ||
    componentName === 'ErrorState'
  ) {
    const items = previewGenericItems(props, table, binding);
    return (
      <div className="grid gap-2">
        {items.map((item, index) => (
          <div
            className="rounded-md border border-border bg-card px-3 py-2"
            key={`${item.title}-${index}`}
          >
            <div className="text-xs font-medium text-foreground">{item.title}</div>
            <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
              {item.description}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (componentName === 'StepperSection' || componentName === 'TimelineSection') {
    const steps = toObjectArray(props.steps || props.items);
    const timeline =
      steps.length > 0
        ? steps
        : ['Draft', 'Validate', 'Implement'].map((label) => ({
            title: label,
            description: binding?.name,
          }));
    return (
      <div className="grid gap-[var(--blueprint-preview-gap)]">
        {timeline.slice(0, 4).map((step, index) => (
          <div className="flex gap-3" key={String(step.title || index)}>
            <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />
            <div>
              <div className="text-sm font-medium text-foreground">
                {String(step.title || ('label' in step ? step.label : `Step ${index + 1}`))}
              </div>
              <div className="text-xs leading-5 text-muted-foreground">
                {String(step.description || '')}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-dashed border-border bg-muted p-3 text-xs leading-5 text-muted-foreground">
      {String(sectionFallbackText(componentName, table, binding))}
    </div>
  );
}

function bindingForSection(section: Record<string, any>, bindings: Array<Record<string, any>>) {
  return (
    bindings.find((binding) => binding.id && binding.id === section.dataBindingId) ||
    bindings.find((binding) => binding.mode === section.source) ||
    null
  );
}

function tableForSection(
  section: Record<string, any>,
  bindings: Array<Record<string, any>>,
  tables: Array<Record<string, any>>
) {
  const binding = bindingForSection(section, bindings);
  return tables.find((table) => table.name && table.name === binding?.table) || tables[0] || null;
}

function previewColumns(
  props: Record<string, any>,
  table: Record<string, any> | null,
  binding: Record<string, any> | null
) {
  const propColumns = toObjectArray(props.columns);
  if (propColumns.length > 0) {
    return propColumns.map((column, index) => ({
      key: String(column.key || column.name || index),
      label: String(column.label || column.name || column.key || `Column ${index + 1}`),
    }));
  }

  const tableColumns = toObjectArray(table?.columns);
  const bindingFields = Array.isArray(binding?.fields) ? binding.fields.map(String) : [];
  const visibleColumns =
    bindingFields.length > 0
      ? tableColumns.filter((column) => bindingFields.includes(String(column.name)))
      : tableColumns;

  const columns = visibleColumns.length > 0 ? visibleColumns : tableColumns;
  return columns.slice(0, 5).map((column, index) => ({
    key: String(column.name || index),
    label: titleCase(String(column.label || column.name || `Column ${index + 1}`)),
  }));
}

function previewRows(props: Record<string, any>, columns: Array<{ key: string; label: string }>) {
  const rows = toObjectArray(props.rows);
  if (rows.length > 0) return rows.slice(0, 4);

  return Array.from({ length: 3 }, (_, rowIndex) =>
    Object.fromEntries(
      columns.map((column, columnIndex) => [
        column.key,
        columnIndex === 0 ? `${column.label} ${rowIndex + 1}` : `Sample ${rowIndex + 1}`,
      ])
    )
  );
}

type PreviewImageSize = 'small' | 'large';

const PREVIEW_IMAGE_SIZES: Record<PreviewImageSize, { width: number; height: number }> = {
  small: { width: 240, height: 135 },
  large: { width: 768, height: 432 },
};

function previewImageFor(item: Record<string, any>, size: PreviewImageSize, seed: string) {
  const image = firstString(
    item.imageUrl,
    item.thumbnailUrl,
    item.posterUrl,
    item.coverUrl,
    item.src,
    item.image,
    item.thumbnail,
    nestedImageValue(item.image),
    nestedImageValue(item.media)
  );
  if (image) return image;

  const dimensions = PREVIEW_IMAGE_SIZES[size];
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${dimensions.width}/${dimensions.height}.webp`;
}

function previewImageAlt(item: Record<string, any>, fallback: string) {
  return firstString(item.alt, item.title, item.label, item.name, item.caption) || fallback;
}

function nestedImageValue(value: unknown) {
  if (!isObject(value)) return '';
  return firstString(value.url, value.src, value.imageUrl, value.thumbnailUrl);
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function chartPreviewItems(
  props: Record<string, any>,
  table: Record<string, any> | null,
  binding: Record<string, any> | null
) {
  const sourceItems = toObjectArray(props.data || props.items || props.cards);
  if (sourceItems.length > 0) {
    return sourceItems.slice(0, 6).map((item, index) => ({
      label: String(item.label || item.title || `Item ${index + 1}`),
      value: previewChartValue(item.value ?? item.max, 24 + index * 14),
    }));
  }

  const columns = previewColumns(props, table, binding);
  return columns.slice(0, 5).map((column, index) => ({
    label: column.label,
    value: 24 + index * 14,
  }));
}

function previewChartValue(value: unknown, fallback: number) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function compactChartLabel(value: unknown) {
  const label = String(value || '');
  return label.length > 9 ? `${label.slice(0, 8)}...` : label;
}

function previewGenericItems(
  props: Record<string, any>,
  table: Record<string, any> | null,
  binding: Record<string, any> | null
) {
  const propItems = toObjectArray(
    props.items || props.columns || props.controls || props.lines || props.insights
  );
  if (propItems.length > 0) {
    return propItems.slice(0, 5).map((item, index) => ({
      title: String(item.title || item.label || item.id || `Item ${index + 1}`),
      description: String(item.description || item.body || item.content || item.value || ''),
    }));
  }

  const columns = previewColumns(props, table, binding);
  if (columns.length > 0) {
    return columns.slice(0, 4).map((column) => ({
      title: column.label,
      description: binding
        ? `Mapped from ${String(binding.name || binding.id)}`
        : `Field ${column.key}`,
    }));
  }

  return [
    {
      title: String(
        props.title || binding?.name || table?.label || table?.name || 'Blueprint section'
      ),
      description: String(
        props.description || props.body || 'Catalog-backed section preview placeholder.'
      ),
    },
  ];
}

function sectionFallbackText(
  componentName: string,
  table: Record<string, any> | null,
  binding: Record<string, any> | null
) {
  const source = binding
    ? `binding "${String(binding.name || binding.id)}"`
    : 'static blueprint data';
  const tableName = table ? ` over "${String(table.label || table.name)}"` : '';
  return `${componentName || 'Section'} preview uses ${source}${tableName}.`;
}

function titleCase(value: string) {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function labelForOption(value: string) {
  if (value in shadowDirectionLabels) return shadowDirectionLabels[value];
  if (value in optionLabels) return optionLabels[value];
  return titleCase(value);
}

function labelForOptionA11y(value: string) {
  if (value in shadowDirectionLabels) return `Shadow direction ${shadowDirectionA11yLabels[value]}`;
  return labelForOption(value);
}

const shadowDirectionLabels: Record<string, string> = {
  '0deg': '↓',
  '45deg': '↘',
  '90deg': '→',
  '135deg': '↗',
  '180deg': '↑',
  '225deg': '↖',
  '270deg': '←',
  '315deg': '↙',
};

const optionLabels: Record<string, string> = {
  campfire: 'Camp Fire',
};

const shadowDirectionA11yLabels: Record<string, string> = {
  '0deg': 'down',
  '45deg': 'down right',
  '90deg': 'right',
  '135deg': 'up right',
  '180deg': 'up',
  '225deg': 'up left',
  '270deg': 'left',
  '315deg': 'down left',
};

function isObject(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toObjectArray(value: unknown): Array<Record<string, any>> {
  return Array.isArray(value) ? value.filter(isObject) : [];
}
