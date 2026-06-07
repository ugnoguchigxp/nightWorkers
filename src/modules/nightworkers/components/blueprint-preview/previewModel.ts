import type { TFunction } from 'i18next';

export function bindingForSection(
  section: Record<string, any>,
  bindings: Array<Record<string, any>>
) {
  return (
    bindings.find((binding) => binding.id && binding.id === section.dataBindingId) ||
    bindings.find((binding) => binding.mode === section.source) ||
    null
  );
}

export function tableForSection(
  section: Record<string, any>,
  bindings: Array<Record<string, any>>,
  tables: Array<Record<string, any>>
) {
  const binding = bindingForSection(section, bindings);
  return tables.find((table) => table.name && table.name === binding?.table) || tables[0] || null;
}

export function previewColumns(
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

export function previewRows(
  props: Record<string, any>,
  columns: Array<{ key: string; label: string }>
) {
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

export const PREVIEW_CHART_HEIGHT = 176;
export const PREVIEW_CHART_MIN_WIDTH = 280;

const PREVIEW_IMAGE_SIZES: Record<PreviewImageSize, { width: number; height: number }> = {
  small: { width: 240, height: 135 },
  large: { width: 768, height: 432 },
};

export function previewImageFor(item: Record<string, any>, size: PreviewImageSize, seed: string) {
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

export function previewImageAlt(item: Record<string, any>, fallback: string) {
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

export function chartPreviewItems(
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

export function compactChartLabel(value: unknown) {
  const label = String(value || '');
  return label.length > 9 ? `${label.slice(0, 8)}...` : label;
}

export function previewGenericItems(
  props: Record<string, any>,
  table: Record<string, any> | null,
  binding: Record<string, any> | null,
  t: TFunction
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
        props.title ||
          binding?.name ||
          table?.label ||
          table?.name ||
          t('blueprint.preview.sectionFallbackTitle')
      ),
      description: String(
        props.description || props.body || t('blueprint.preview.sectionFallbackDescription')
      ),
    },
  ];
}

export function sectionFallbackText(
  componentName: string,
  table: Record<string, any> | null,
  binding: Record<string, any> | null,
  t: TFunction
) {
  const source = binding
    ? t('blueprint.preview.bindingSource', { name: String(binding.name || binding.id) })
    : t('blueprint.preview.staticSource');
  const tableName = table
    ? t('blueprint.preview.tableContext', { name: String(table.label || table.name) })
    : '';
  return t('blueprint.preview.sectionFallbackText', {
    componentName: componentName || 'Section',
    source,
    tableName,
  });
}

export function titleCase(value: string) {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

export function labelForOption(value: string) {
  if (value in shadowDirectionLabels) return shadowDirectionLabels[value];
  if (value in optionLabels) return optionLabels[value];
  return titleCase(value);
}

export function labelForOptionA11y(value: string) {
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

export function isObject(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function toObjectArray(value: unknown): Array<Record<string, any>> {
  return Array.isArray(value) ? value.filter(isObject) : [];
}
