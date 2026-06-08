import type { BlueprintNode } from './schemas/app-blueprint-ui.schema';

export type BlueprintPreviewComponentDefinition = {
  name: string;
  category: 'layout' | 'display' | 'input' | 'action' | 'navigation' | 'feedback';
  description: string;
  allowedChildren?: string[];
  defaultProps?: Record<string, unknown>;
  previewHints?: {
    minWidth?: string;
    preferredSlot?: string;
  };
};

export type BlueprintSectionPresetDefinition = {
  name: 'search_header' | 'table_workspace' | 'metrics_overview' | 'chart_insight' | 'kanban_board';
  description: string;
  slots: Array<{
    name: string;
    accepts: string[];
    cardinality: 'one' | 'many' | 'optional';
  }>;
  legacyComponents: string[];
};

type PresetLabels = {
  searchPlaceholder: string;
  primarySignal: string;
  secondarySignal: string;
  nextAction: string;
};

export const blueprintPreviewComponentCatalog: BlueprintPreviewComponentDefinition[] = [
  component('Text', 'display', 'Render titles, labels, and short supporting copy.'),
  component('Button', 'action', 'Render a primary or secondary command.'),
  component('IconButton', 'action', 'Render a compact icon command.'),
  component('Input', 'input', 'Render a single text input or search field.'),
  component('InputGroup', 'input', 'Render grouped input controls.'),
  component('Select', 'input', 'Render a compact option picker.'),
  component('Checkbox', 'input', 'Render a boolean choice.'),
  component('Switch', 'input', 'Render a binary mode toggle.'),
  component('Card', 'display', 'Render a metric, summary, or bounded content surface.'),
  component('Badge', 'display', 'Render a compact status or category label.'),
  component('Avatar', 'display', 'Render a person or account marker.'),
  component('DataTable', 'display', 'Render mock columns and rows.', [], {
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'status', label: 'Status' },
      { key: 'owner', label: 'Owner' },
    ],
  }),
  component('Table', 'display', 'Render mock columns and rows.'),
  component('List', 'display', 'Render a vertical list of mock items.'),
  component('Tabs', 'navigation', 'Render local navigation tabs.', ['Text', 'Badge']),
  component('Accordion', 'display', 'Render collapsible detail groups.', ['Text', 'Card']),
  component('Alert', 'feedback', 'Render an insight, warning, or confirmation.'),
  component('Progress', 'feedback', 'Render a bounded progress value.'),
  component('Tooltip', 'feedback', 'Render supplementary hover content.'),
  component('Dialog', 'feedback', 'Render a modal preview surface.'),
  component('Sidebar', 'navigation', 'Render persistent local navigation.'),
  component('Breadcrumb', 'navigation', 'Render location hierarchy.'),
  component('Pagination', 'navigation', 'Render page controls.'),
  component('Separator', 'layout', 'Render a visual divider.'),
];

export const blueprintSectionPresetCatalog: BlueprintSectionPresetDefinition[] = [
  {
    name: 'search_header',
    description: 'Title, search input, optional filters, and action buttons.',
    legacyComponents: ['MainSearchNavigationSection'],
    slots: [
      slot('title', ['Text'], 'one'),
      slot('searchInput', ['Input', 'InputGroup'], 'one'),
      slot('filters', ['Select', 'Checkbox', 'Switch', 'Tabs'], 'many'),
      slot('actions', ['Button', 'IconButton'], 'many'),
    ],
  },
  {
    name: 'table_workspace',
    description: 'Toolbar, optional filters/actions, and a mock data table.',
    legacyComponents: ['DataTableSection'],
    slots: [
      slot('toolbar', ['Text', 'Input', 'Select', 'Button'], 'optional'),
      slot('filters', ['Input', 'Select', 'Checkbox', 'Switch'], 'many'),
      slot('table', ['DataTable', 'Table'], 'one'),
      slot('emptyState', ['Alert', 'Card'], 'optional'),
    ],
  },
  {
    name: 'metrics_overview',
    description: 'Metric cards and optional supporting insight.',
    legacyComponents: ['KpiSummarySection', 'StatsTrendCardsSection'],
    slots: [
      slot('metrics', ['Card', 'Badge', 'Progress'], 'many'),
      slot('insight', ['Alert', 'Card'], 'optional'),
    ],
  },
  {
    name: 'chart_insight',
    description: 'Chart-like mock data paired with explanatory insight.',
    legacyComponents: ['ChartSection', 'ChartInsightSection'],
    slots: [
      slot('chart', ['DataTable', 'Card'], 'one'),
      slot('insight', ['Alert', 'Card'], 'optional'),
    ],
  },
  {
    name: 'kanban_board',
    description: 'Workflow columns with mock cards.',
    legacyComponents: ['KanbanSection'],
    slots: [
      slot('toolbar', ['Text', 'Input', 'Select', 'Button'], 'optional'),
      slot('columns', ['List', 'Card'], 'many'),
    ],
  },
];

export const legacyBlueprintSectionPresetMap = Object.fromEntries(
  blueprintSectionPresetCatalog.flatMap((preset) =>
    preset.legacyComponents.map((componentName) => [componentName, preset.name])
  )
) as Record<string, BlueprintSectionPresetDefinition['name']>;

export function createPresetBlueprintNodeTree(input: {
  preset: string;
  sectionId?: string;
  sectionName?: string;
  props?: Record<string, any>;
  labels: PresetLabels;
}): BlueprintNode {
  const props = input.props || {};
  const title = String(props.title || input.sectionName || input.sectionId || 'Section');
  const description = String(props.description || '');

  if (input.preset === 'search_header') {
    return layoutNode('root', 'stack', { gap: 'md' }, [
      componentNode('title', 'Text', { title, description }),
      layoutNode('controls', 'row', { gap: 'sm', align: 'stretch' }, [
        componentNode(
          'searchInput',
          'Input',
          {
            placeholder: String(
              props.placeholder || props.searchPlaceholder || input.labels.searchPlaceholder
            ),
          },
          { width: 'full' }
        ),
        layoutNode(
          'actions',
          'row',
          { gap: 'sm' },
          objectArray(props.actions).map((action, index) =>
            componentNode(String(action.id || `action-${index + 1}`), 'Button', action)
          )
        ),
      ]),
    ]);
  }

  if (input.preset === 'table_workspace') {
    return layoutNode('root', 'stack', { gap: 'md' }, [
      layoutNode('toolbar', 'row', { gap: 'sm', align: 'center' }, [
        componentNode('title', 'Text', { title, description }),
        layoutNode(
          'actions',
          'row',
          { gap: 'sm' },
          objectArray(props.actions).map((action, index) =>
            componentNode(String(action.id || `action-${index + 1}`), 'Button', action)
          )
        ),
      ]),
      componentNode('table', 'DataTable', props),
    ]);
  }

  if (input.preset === 'metrics_overview') {
    const items = objectArray(props.items || props.metrics || props.cards);
    const metrics =
      items.length > 0
        ? items
        : [
            { label: input.labels.primarySignal, value: '-' },
            { label: input.labels.secondarySignal, value: '-' },
            { label: input.labels.nextAction, value: '-' },
          ];
    return layoutNode(
      'metrics',
      'grid',
      { columns: Math.min(Math.max(metrics.length, 1), 4), gap: 'md' },
      metrics.map((item, index) =>
        componentNode(String(item.id || `metric-${index + 1}`), 'Card', item)
      )
    );
  }

  if (input.preset === 'chart_insight') {
    return layoutNode('root', 'split', { gap: 'md' }, [
      componentNode('chart', 'DataTable', props),
      componentNode('insight', 'Alert', {
        title,
        description: description || String(props.insight || ''),
      }),
    ]);
  }

  if (input.preset === 'kanban_board') {
    return layoutNode(
      'root',
      'grid',
      { columns: 3, gap: 'md' },
      objectArray(props.columns).map((column, index) =>
        componentNode(String(column.id || `column-${index + 1}`), 'List', {
          title: String(column.title || `Column ${index + 1}`),
          items: objectArray(column.cards),
        })
      )
    );
  }

  return layoutNode('root', 'stack', { gap: 'md' }, [
    componentNode('fallback', 'Card', { title, description }),
  ]);
}

function component(
  name: string,
  category: BlueprintPreviewComponentDefinition['category'],
  description: string,
  allowedChildren: string[] = [],
  defaultProps: Record<string, unknown> = {}
): BlueprintPreviewComponentDefinition {
  return { name, category, description, allowedChildren, defaultProps };
}

function slot(
  name: string,
  accepts: string[],
  cardinality: 'one' | 'many' | 'optional'
): BlueprintSectionPresetDefinition['slots'][number] {
  return { name, accepts, cardinality };
}

function layoutNode(
  id: string,
  layout: string,
  props: Record<string, unknown>,
  children: BlueprintNode[]
) {
  return { kind: 'layout', id, layout, props, children } as BlueprintNode;
}

function componentNode(
  id: string,
  component: string,
  props: Record<string, unknown>,
  layout?: Record<string, unknown>
) {
  return {
    kind: 'component',
    id,
    component,
    props,
    layout: layout || {},
    children: [],
  } as BlueprintNode;
}

function objectArray(value: unknown): Array<Record<string, any>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, any> =>
        Boolean(item && typeof item === 'object' && !Array.isArray(item))
      )
    : [];
}
