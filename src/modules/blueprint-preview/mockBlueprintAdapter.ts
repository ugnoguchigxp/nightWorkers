import type {
  MockBlueprint,
  MockBlueprintDataset,
  MockBlueprintScreen,
  MockBlueprintSection,
} from '../../../shared/schemas/mock-blueprint.schema';
import { mockBlueprintSchema } from '../../../shared/schemas/mock-blueprint.schema';
import { defaultBlueprintPreviewDesignSettings } from './designSettings';
import { canUseBlueprintSideColumn, coerceBlueprintSideRegion } from './sidebarPlacement';

type PreviewBlueprint = ReturnType<typeof mockBlueprintToPreviewBlueprint>;

export function mockBlueprintToPreviewBlueprint(mockBlueprint: MockBlueprint): {
  id: string;
  name: string;
  version: number;
  description: string;
  meta: MockBlueprint['meta'];
  designPreset: typeof defaultBlueprintPreviewDesignSettings;
  screens: Array<Record<string, unknown>>;
} {
  return {
    id: mockBlueprint.id,
    name: mockBlueprint.name,
    version: mockBlueprint.version,
    description: mockBlueprint.summary,
    meta: mockBlueprint.meta,
    designPreset: defaultBlueprintPreviewDesignSettings,
    screens: mockBlueprint.screens.map((screen) => screenToPreviewScreen(screen)),
  };
}

export function mockBlueprintToPreviewBlueprintSafely(input: unknown): PreviewBlueprint | null {
  const parsed = mockBlueprintSchema.safeParse(input);
  return parsed.success ? mockBlueprintToPreviewBlueprint(parsed.data) : null;
}

function screenToPreviewScreen(screen: MockBlueprintScreen): Record<string, unknown> {
  const layout = previewLayoutForScreen(screen);
  return {
    id: screen.id,
    name: screen.name,
    path: screen.path,
    componentName: pageComponentForLayout(layout.template),
    layout,
    sections: screen.sections.map((section) => sectionToPreviewSection(section, screen)),
    actions: [],
  };
}

function previewLayoutForScreen(screen: MockBlueprintScreen): MockBlueprintScreen['layout'] {
  const hasSidebar = screen.sections.some(
    (section) => previewRegionForSection(section) === 'sidebar'
  );
  const hasAside = screen.sections.some((section) => previewRegionForSection(section) === 'aside');

  if (hasSidebar && hasAside) return { template: 'three_column' };
  if (hasSidebar) return { template: 'sidebar_left' };
  if (hasAside) return { template: 'sidebar_right' };
  if (
    screen.layout.template === 'two_column' ||
    screen.layout.template === 'sidebar_left' ||
    screen.layout.template === 'sidebar_right' ||
    screen.layout.template === 'three_column' ||
    screen.layout.template === 'article_with_sidebar'
  ) {
    return { template: 'single_column' };
  }
  return screen.layout;
}

function sectionToPreviewSection(
  section: MockBlueprintSection,
  screen: MockBlueprintScreen
): Record<string, unknown> {
  return {
    kind: 'component_section',
    id: section.id,
    name: section.name,
    componentName: section.componentName,
    region: previewRegionForSection(section),
    source: sourceForDataset(section.dataset),
    intent: section.selectionReason,
    visualIntent: section.copy.description || screen.purpose,
    props: propsForDataset(section),
    actions: actionProps(section),
  };
}

function propsForDataset(section: MockBlueprintSection): Record<string, unknown> {
  const base = {
    title: section.copy.title,
    description: section.copy.description || section.selectionReason,
    emptyState: {
      title: section.copy.emptyStateTitle || `${section.copy.title} はまだありません`,
      description:
        section.copy.emptyStateDescription || '条件に一致するサンプルがない状態を示します。',
    },
  };
  const dataset = section.dataset;
  switch (dataset.kind) {
    case 'navigation':
      return {
        ...base,
        items: dataset.items,
        menuItems: dataset.items,
        links: dataset.items,
        actions: actionProps(section),
      };
    case 'table':
      return {
        ...base,
        columns: dataset.columns,
        rows: dataset.rows,
        table: { columns: dataset.columns, rows: dataset.rows },
      };
    case 'form':
      return {
        ...base,
        fields: dataset.fields,
        submitLabel: dataset.submitLabel || section.copy.primaryActionLabel,
      };
    case 'cards':
      return {
        ...base,
        items: dataset.cards.map((card) => ({
          ...card,
          badge: card.meta,
          action: card.actionLabel,
        })),
        cards: dataset.cards,
      };
    case 'kanban':
      return {
        ...base,
        boardLabel: section.copy.title,
        boardDescription: section.copy.description || section.selectionReason,
        columns: dataset.columns.map((column) => ({
          ...column,
          cards: column.cards.map((card) => ({
            title: card.title,
            description: card.description,
            badge: card.meta,
            priority: card.meta,
          })),
        })),
      };
    case 'timeline':
      return {
        ...base,
        items: dataset.items.map((item) => ({
          title: item.title,
          description: item.timestamp
            ? `${item.timestamp} - ${item.description}`
            : item.description,
          time: item.timestamp,
        })),
      };
    case 'article':
      return {
        ...base,
        title: dataset.title || section.copy.title,
        subtitle: section.copy.description,
        body: dataset.body,
        meta: dataset.meta,
      };
    case 'metrics':
      return {
        ...base,
        metrics: dataset.metrics,
        items: dataset.metrics.map((metric) => ({
          label: metric.label,
          value: metric.value,
          trend: metric.trend,
          title: metric.label,
          description: metric.trend || metric.value,
        })),
        data: dataset.metrics,
      };
    case 'media':
      return {
        ...base,
        items: dataset.items.map((item, index) => ({
          title: item.title,
          description: item.description,
          caption: item.mediaLabel,
          image: item.mediaLabel || `${section.id}-${index + 1}`,
        })),
      };
    case 'map':
      return {
        ...base,
        points: dataset.points,
        items: dataset.points.map((point) => ({
          title: point.label,
          description: point.description,
          region: point.region,
        })),
      };
    case 'code':
      return {
        ...base,
        files: dataset.files,
        items: dataset.files.map((file) => ({
          title: file.path,
          description: file.excerpt,
          language: file.language,
        })),
      };
    case 'chat':
      return {
        ...base,
        messages: dataset.messages,
        items: dataset.messages.map((message) => ({
          title: message.author,
          description: message.body,
          status: message.state,
        })),
      };
    case 'generic':
      return {
        ...base,
        items: dataset.items,
      };
  }
}

function actionProps(section: MockBlueprintSection) {
  return [
    section.copy.primaryActionLabel
      ? {
          id: `${section.id}-primary`,
          label: section.copy.primaryActionLabel,
          type: 'custom',
        }
      : null,
    section.copy.secondaryActionLabel
      ? {
          id: `${section.id}-secondary`,
          label: section.copy.secondaryActionLabel,
          type: 'custom',
        }
      : null,
  ].filter(Boolean);
}

function pageComponentForLayout(template: MockBlueprintScreen['layout']['template']) {
  if (template === 'article_with_sidebar') return 'ArticleFeedPage';
  if (template === 'sidebar_left' || template === 'sidebar_right') return 'SidebarPage';
  if (template === 'single_column') return 'ListPage';
  return 'DashboardPage';
}

function defaultRegionForSection(componentName: MockBlueprintSection['componentName']) {
  if (componentName === 'TopMenuSection' || componentName === 'TabNavigationSection')
    return 'header';
  if (componentName === 'FooterNavigationSection') return 'footer';
  if (componentName === 'RightSidebarLinksSection') return 'aside';
  if (canUseBlueprintSideColumn({ componentName })) return 'sidebar';
  if (
    componentName === 'FullBleedHeroSection' ||
    componentName === 'SplitHeroSection' ||
    componentName === 'CarouselSection'
  ) {
    return 'full_width';
  }
  return 'main';
}

function previewRegionForSection(section: MockBlueprintSection) {
  const region = section.region || defaultRegionForSection(section.componentName);
  return coerceBlueprintSideRegion(region, section);
}

function sourceForDataset(dataset: MockBlueprintDataset) {
  if (dataset.kind === 'navigation') return 'navigation';
  if (dataset.kind === 'article') return 'markdown';
  if (dataset.kind === 'table') return 'table';
  return 'static';
}
