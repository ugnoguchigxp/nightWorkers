import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { renderAdditionalPreviewSectionBody } from './BlueprintPreviewSectionMore';
import {
  chartPreviewItems,
  compactChartLabel,
  isObject,
  PREVIEW_CHART_HEIGHT,
  PREVIEW_CHART_MIN_WIDTH,
  previewColumns,
  previewGenericItems,
  previewImageAlt,
  previewImageFor,
  previewRows,
  sectionFallbackText,
  toObjectArray,
} from './previewModel';

export function BlueprintPreviewSection({
  section,
  table,
  binding,
}: {
  section: Record<string, any>;
  table: Record<string, any> | null;
  binding: Record<string, any> | null;
}) {
  const { t } = useTranslation();
  const componentName = String(section.componentName || '');
  const props = isObject(section.props) ? section.props : {};
  const title = String(props.title || section.name || section.id || componentName || 'Section');
  const description = String(props.description || section.intent || section.visualIntent || '');
  const body = renderPreviewSectionBody(componentName, props, table, binding, t);

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
  binding: Record<string, any> | null,
  t: ReturnType<typeof useTranslation>['t']
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
            { label: String(props.title || t('blueprint.preview.kpi.primarySignal')), value: '-' },
            {
              label: String(
                binding?.name || table?.label || t('blueprint.preview.kpi.secondarySignal')
              ),
              value: '-',
            },
            {
              label: t('blueprint.preview.kpi.nextAction'),
              value: String(props.actionLabel || '-'),
            },
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
        <div className="min-h-44 overflow-x-auto rounded-md border border-border bg-muted p-2">
          <ResponsiveContainer
            height={PREVIEW_CHART_HEIGHT}
            minHeight={PREVIEW_CHART_HEIGHT}
            minWidth={PREVIEW_CHART_MIN_WIDTH}
            width="100%"
          >
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
          {chartItems.slice(0, 4).map((item, index) => (
            <div
              className="flex items-center justify-between gap-3 rounded border border-border bg-card px-2 py-1.5 text-xs"
              key={`${item.label}-${index}`}
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
    const labels =
      navLabels.length > 0
        ? navLabels
        : [
            t('blueprint.preview.nav.primary'),
            t('blueprint.preview.nav.inFocus'),
            t('blueprint.preview.nav.followUp'),
          ];
    return (
      <div className="grid gap-[var(--blueprint-preview-gap)]">
        {componentName === 'MainSearchNavigationSection' ? (
          <div className="flex min-h-[var(--blueprint-preview-control-height)] overflow-hidden rounded-md border border-border bg-card">
            <div className="flex-1 px-3 py-2 text-xs text-muted-foreground">
              {String(props.searchPlaceholder || t('blueprint.preview.searchPlaceholder'))}
            </div>
            <div className="blueprint-preview-button bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground">
              {String(props.searchButtonLabel || t('blueprint.preview.search'))}
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
        : previewGenericItems(props, table, binding, t).map((item) => ({
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
          {String(props.submitLabel || t('artifact.action.save'))}
        </div>
      </div>
    );
  }

  const additionalSectionBody = renderAdditionalPreviewSectionBody({
    componentName,
    props,
    table,
    binding,
    t,
  });
  if (additionalSectionBody) return additionalSectionBody;

  return (
    <div className="rounded-md border border-dashed border-border bg-muted p-3 text-xs leading-5 text-muted-foreground">
      {String(sectionFallbackText(componentName, table, binding, t))}
    </div>
  );
}
