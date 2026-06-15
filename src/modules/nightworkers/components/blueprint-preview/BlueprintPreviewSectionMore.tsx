import type { TFunction } from 'i18next';
import { PreviewBadge, PreviewCard } from './BlueprintPreviewPrimitives';
import {
  previewColumns,
  previewGenericItems,
  previewImageAlt,
  previewImageFor,
  toObjectArray,
} from './previewModel';

type AdditionalPreviewInput = {
  componentName: string;
  props: Record<string, unknown>;
  t: TFunction;
};

export function renderAdditionalPreviewSectionBody({
  componentName,
  props,
  t,
}: AdditionalPreviewInput) {
  if (componentName === 'KanbanSection') {
    const columns = buildKanbanColumns(props, t);
    const maxVisibleColumns = toObjectArray(props.columns || props.lanes || props.statuses).length
      ? 5
      : 3;
    const filters = toObjectArray(props.filters || props.views || props.segments).slice(0, 4);
    return (
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-foreground">
              {String(props.boardLabel || props.boardName || props.title || 'Kanban board')}
            </div>
            <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
              {String(
                props.boardDescription ||
                  props.description ||
                  'Cards move across columns as work progresses.'
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5 text-[10px] text-muted-foreground">
            {(filters.length > 0
              ? filters
              : [{ label: 'Search' }, { label: 'Filter' }, { label: 'Sort' }]
            ).map((filter, index) => (
              <span
                className="rounded-full border border-border bg-muted px-2 py-0.5"
                key={String(filter.label || filter.title || index)}
              >
                {String(filter.label || filter.title || filter.name || `Filter ${index + 1}`)}
              </span>
            ))}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {columns.slice(0, maxVisibleColumns).map((column, index) => (
            <div
              className="min-w-[220px] rounded-md border border-border bg-muted/70"
              key={String(column.id || column.title || index)}
            >
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${kanbanAccentClass(index)}`}
                    aria-hidden="true"
                  />
                  <div className="truncate text-xs font-semibold text-foreground">
                    {String(column.title || column.label || column.name || `Column ${index + 1}`)}
                  </div>
                </div>
                <span className="rounded-full border border-border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {column.cards.length}
                </span>
              </div>
              <div className="grid min-h-32 gap-2 p-2">
                {column.cards.slice(0, 4).map((card, cardIndex) => (
                  <PreviewCard
                    as="article"
                    className="p-2.5"
                    key={String(card.id || card.title || cardIndex)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 text-xs font-medium text-foreground">
                        {String(card.title || card.label || card.name || `Card ${cardIndex + 1}`)}
                      </div>
                      {card.priority || card.badge || card.tag ? (
                        <PreviewBadge className="shrink-0 px-1.5 py-0.5 text-[10px]">
                          {String(card.priority || card.badge || card.tag)}
                        </PreviewBadge>
                      ) : null}
                    </div>
                    <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground">
                      {String(card.description || card.body || card.summary || '')}
                    </div>
                    {card.assignee || card.dueDate || card.updatedAt ? (
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                        {card.assignee ? (
                          <span className="rounded border border-border px-1.5 py-0.5">
                            {String(card.assignee)}
                          </span>
                        ) : null}
                        {card.dueDate || card.updatedAt ? (
                          <span className="rounded border border-border px-1.5 py-0.5">
                            {String(card.dueDate || card.updatedAt)}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </PreviewCard>
                ))}
                {column.cards.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-[11px] text-muted-foreground">
                    No cards
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
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
        : previewColumns(props)
            .slice(0, 3)
            .map((column) => ({
              title: column.label,
              description: `Sample ${column.key}`,
              badge: 'Blueprint',
            }));
    return (
      <div className="grid gap-[var(--blueprint-preview-gap)] sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card, index) => (
          <PreviewCard as="article" key={String(card.title || index)} className="p-3">
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
              <PreviewBadge className="mt-3 w-fit py-0.5 text-[10px]">
                {String(card.badge)}
              </PreviewBadge>
            ) : null}
          </PreviewCard>
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
              target: t('blueprint.preview.feed.blueprint'),
            },
            {
              actor: t('blueprint.preview.feed.agent'),
              action: t('blueprint.preview.feed.mapped'),
              target: t('blueprint.preview.feed.data'),
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
          <PreviewCard className="p-3" key={index}>
            <div className="text-xs font-medium text-foreground">
              {String(item.title || item.author || item.actor || `Update ${index + 1}`)}
            </div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              {String(
                item.body || item.content || `${item.action || 'updated'} ${item.target || ''}`
              )}
            </div>
          </PreviewCard>
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
    const items = previewGenericItems(props, t);
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
            description: '',
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

function buildKanbanColumns(
  props: Record<string, unknown>,
  t: TFunction
): Array<Record<string, unknown> & { cards: Array<Record<string, unknown>> }> {
  const propColumns = toObjectArray(props.columns || props.lanes || props.statuses);
  const topLevelCards = toObjectArray(props.cards || props.items || props.tasks || props.data);
  if (propColumns.length > 0) {
    const columns = propColumns.map((column, index) => {
      const cards = toObjectArray(column.cards || column.items || column.tasks);
      return {
        ...column,
        cards:
          cards.length > 0
            ? cards
            : topLevelCards.filter((card) => cardBelongsToColumn(card, column, index)),
      };
    });
    if (columns.some((column) => column.cards.length > 0)) return columns;
    return columns.map((column, index) => ({
      ...column,
      cards: [defaultKanbanCard(column, index, t)],
    }));
  }

  const defaultColumns: Array<Record<string, unknown>> = [
    { id: 'backlog', title: t('blueprint.preview.kanban.backlog') },
    { id: 'in-progress', title: t('blueprint.preview.kanban.inProgress') },
    { id: 'done', title: t('blueprint.preview.kanban.done') },
  ];
  if (topLevelCards.length > 0) {
    return defaultColumns.map((column, index) => ({
      ...column,
      cards: topLevelCards.filter((card) => cardBelongsToColumn(card, column, index)),
    }));
  }

  return defaultColumns.map((column, index) => ({
    ...column,
    cards: [defaultKanbanCard(column, index, t)],
  }));
}

function defaultKanbanCard(
  column: Record<string, unknown>,
  index: number,
  t: TFunction
): Record<string, unknown> {
  const columnTitle = String(column.title || column.label || column.name || `Column ${index + 1}`);
  const descriptions = [
    '最初に作成するカードの内容を確認する',
    '担当者や優先度を見ながら作業中の状態を確認する',
    '完了したカードの見え方と履歴に残す情報を確認する',
  ];
  return {
    title: t('blueprint.preview.kanban.itemLabel', { title: columnTitle }),
    description: descriptions[index] || descriptions[0],
    badge: index === 0 ? 'Draft' : index === 1 ? 'Active' : 'Done',
    assignee: index === 0 ? 'Product' : index === 1 ? 'Design' : 'QA',
    dueDate: index === 0 ? '今週' : index === 1 ? '次回レビュー' : '確認済み',
  };
}

function cardBelongsToColumn(
  card: Record<string, unknown>,
  column: Record<string, unknown>,
  fallbackIndex: number
) {
  const cardColumn = String(
    card.columnId || card.column || card.statusId || card.status || card.stage || ''
  )
    .trim()
    .toLowerCase();
  if (!cardColumn) return fallbackIndex === 0;
  const columnKeys = [column.id, column.key, column.title, column.label, column.name]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());
  return columnKeys.includes(cardColumn);
}

function kanbanAccentClass(index: number) {
  return ['bg-cyan-400', 'bg-amber-300', 'bg-emerald-400', 'bg-fuchsia-400', 'bg-sky-300'][
    index % 5
  ];
}
