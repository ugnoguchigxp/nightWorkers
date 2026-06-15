import type { TFunction } from 'i18next';
import { toObjectArray } from '../previewModel';

export const chartTooltipStyle = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  color: 'var(--foreground)',
  fontSize: 11,
};

export const analyticsTooltipStyle = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  color: 'var(--foreground)',
  fontSize: 11,
};

export function buildKanbanColumns(
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

export function analyticsDashboardChartData(props: Record<string, unknown>) {
  const rows = toObjectArray(props.chartData || props.data || props.reportData || props.series);
  if (rows.length > 0) {
    return rows.slice(0, 8).map((row, index) => ({
      label: String(row.label || row.title || row.time || row.date || `Point ${index + 1}`),
      value: previewNumber(row.value ?? row.sales ?? row.count ?? row.total, 24 + index * 9),
    }));
  }

  return [
    { label: '10am', value: 54 },
    { label: '11am', value: 32 },
    { label: '12pm', value: 58 },
    { label: '01am', value: 36 },
    { label: '02am', value: 24 },
    { label: '03am', value: 50 },
    { label: '04am', value: 18 },
    { label: '05am', value: 35 },
    { label: '06am', value: 68 },
    { label: '07am', value: 73 },
  ];
}

function previewNumber(value: unknown, fallback: number) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
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

export function kanbanAccentClass(index: number) {
  return ['bg-cyan-400', 'bg-amber-300', 'bg-emerald-400', 'bg-fuchsia-400', 'bg-sky-300'][
    index % 5
  ];
}
