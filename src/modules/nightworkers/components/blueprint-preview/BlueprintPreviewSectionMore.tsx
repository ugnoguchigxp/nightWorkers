import type { TFunction } from 'i18next';
import {
  previewColumns,
  previewGenericItems,
  previewImageAlt,
  previewImageFor,
  toObjectArray,
} from './previewModel';

type AdditionalPreviewInput = {
  componentName: string;
  props: Record<string, any>;
  table: Record<string, any> | null;
  binding: Record<string, any> | null;
  t: TFunction;
};

export function renderAdditionalPreviewSectionBody({
  componentName,
  props,
  table,
  binding,
  t,
}: AdditionalPreviewInput) {
  if (componentName === 'KanbanSection') {
    const propColumns = toObjectArray(props.columns);
    const columns =
      propColumns.length > 0
        ? propColumns
        : [
            t('blueprint.preview.kanban.backlog'),
            t('blueprint.preview.kanban.inProgress'),
            t('blueprint.preview.kanban.done'),
          ].map((title, index) => ({
            title,
            cards: [
              {
                title: t('blueprint.preview.kanban.itemLabel', { title }),
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
            {
              title: t('blueprint.preview.row.planningReview'),
              date: '2026-06-03',
              amount: '$1,240',
            },
            {
              title: t('blueprint.preview.row.implementation'),
              date: '2026-06-04',
              amount: '$860',
            },
            { title: t('blueprint.preview.row.validation'), date: '2026-06-05', amount: '$420' },
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
            {
              actor: t('blueprint.preview.feed.system'),
              action: t('blueprint.preview.feed.validated'),
              target: binding?.name || t('blueprint.preview.feed.blueprint'),
            },
            {
              actor: t('blueprint.preview.feed.agent'),
              action: t('blueprint.preview.feed.mapped'),
              target: table?.label || table?.name || t('blueprint.preview.feed.data'),
            },
            {
              actor: t('blueprint.preview.feed.user'),
              action: t('blueprint.preview.feed.reviewed'),
              target: t('blueprint.preview.feed.preview'),
            },
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
    const items = previewGenericItems(props, table, binding, t);
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
        : [
            t('blueprint.preview.timeline.draft'),
            t('blueprint.preview.timeline.validate'),
            t('blueprint.preview.timeline.implement'),
          ].map((label) => ({
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

  return null;
}
