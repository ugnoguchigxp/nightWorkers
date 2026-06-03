import type {
  BlueprintComponentDefinition,
  BlueprintComponentName,
  BlueprintDataSourceKind,
} from '../../../shared/schemas/blueprint-catalog.schema';

export const blueprintCatalog: BlueprintComponentDefinition[] = [
  component('DashboardPage', 'page', ['none', 'app'], 'Dashboard page shell.'),
  component('EntityListPage', 'page', ['none', 'app'], 'Entity list page shell.'),
  component('EntityDetailPage', 'page', ['none', 'app', 'record'], 'Entity detail page shell.'),
  component('EditableFormPage', 'page', ['none', 'app'], 'Editable form page shell.'),
  component('ArticleFeedPage', 'page', ['none', 'app'], 'Article feed page shell.'),
  component('SidebarPage', 'page', ['none', 'app'], 'Page shell with persistent navigation.'),
  component('ListPage', 'page', ['none', 'app'], 'Legacy alias for entity collection browsing.'),
  component('DetailPage', 'page', ['none', 'app', 'record'], 'Legacy alias for record inspection.'),
  component('FormPage', 'page', ['none', 'app'], 'Legacy alias for create or edit flows.'),
  component(
    'KpiSummarySection',
    'section',
    ['computed', 'table', 'summary', 'postgres', 'api'],
    'Summarize key metrics.'
  ),
  component(
    'ChartSection',
    'section',
    ['computed', 'table', 'summary', 'postgres', 'api', 'app'],
    'Use for numeric comparisons, trends, shares, or radar scores.',
    ['bar', 'line', 'area', 'pie', 'radar']
  ),
  component(
    'ChartInsightSection',
    'section',
    ['computed', 'table', 'summary', 'postgres', 'api', 'app'],
    'Pair a bar or pie chart with companion insight text blocks.',
    ['bar-with-insights', 'pie-with-insights']
  ),
  component(
    'ProgressListSection',
    'section',
    ['computed', 'table', 'summary', 'postgres', 'api', 'app'],
    'Render progress, completion, quota, health, or score lists.'
  ),
  component(
    'DataTableSection',
    'section',
    ['table', 'postgres', 'api'],
    'Show bounded table data.'
  ),
  component(
    'InsightPanel',
    'section',
    ['computed', 'summary', 'rss', 'postgres', 'api', 'markdown'],
    'Show a concise insight, recommendation, or explanation.'
  ),
  component(
    'ImageSection',
    'section',
    ['static', 'app', 'api', 'markdown'],
    'Show a validated image.'
  ),
  component(
    'SplitHeroSection',
    'section',
    ['static', 'app', 'api', 'markdown'],
    'Show a strong feature intro with optional image and actions.'
  ),
  component(
    'CarouselSection',
    'section',
    ['static', 'app', 'api', 'markdown', 'rss'],
    'Show products, articles, gallery items, or recommendations.'
  ),
  component(
    'FormSection',
    'section',
    ['record', 'table', 'app', 'api', 'postgres'],
    'Collect or edit fields.'
  ),
  component(
    'CardGridSection',
    'section',
    ['table', 'static', 'app', 'api', 'markdown', 'rss', 'postgres'],
    'Show scannable cards for products, projects, templates, files, or choices.'
  ),
  component(
    'StepperSection',
    'section',
    ['static', 'computed', 'summary', 'api', 'markdown', 'app'],
    'Show workflows, onboarding, setup, ordering, or incident response.',
    ['vertical-split', 'vertical-accordion', 'horizontal']
  ),
  component(
    'TimelineSection',
    'section',
    ['table', 'record', 'rss', 'api', 'markdown'],
    'Show chronological events.'
  ),
  component(
    'KanbanSection',
    'section',
    ['table', 'app', 'api', 'postgres'],
    'Show workflow columns.'
  ),
  component(
    'CalendarSection',
    'section',
    ['table', 'app', 'api', 'postgres'],
    'Show events or deadlines.'
  ),
  component(
    'ScheduleSection',
    'section',
    ['table', 'app', 'api', 'postgres'],
    'Show upcoming scheduled items in a monthly card.',
    ['upcoming-schedule-monthly']
  ),
  component(
    'HoldingsListSection',
    'section',
    ['table', 'computed', 'app', 'api', 'postgres', 'summary'],
    'Show a searchable holdings list with category tabs.',
    ['portfolio-holdings-list']
  ),
  component(
    'AccordionSection',
    'section',
    ['static', 'app', 'api', 'markdown', 'summary'],
    'Show FAQ, policy notes, or collapsible detail groups.',
    ['faq-accordion', 'details-accordion']
  ),
  component(
    'ControlPanelSection',
    'section',
    ['static', 'computed', 'app', 'api', 'summary'],
    'Show settings controls, mode tabs, and range controls.',
    ['ambient-control-panel', 'settings-sliders']
  ),
  component(
    'StatsTrendCardsSection',
    'section',
    ['computed', 'summary', 'api', 'postgres', 'app'],
    'Show metric cards with comparison deltas.',
    ['kpi-trends']
  ),
  component(
    'ActivityFeedSection',
    'section',
    ['computed', 'table', 'summary', 'api', 'postgres', 'app'],
    'Show actor/action/target operational activity.',
    ['audit-activity-feed']
  ),
  component(
    'NotificationCenterSection',
    'section',
    ['computed', 'summary', 'api', 'app'],
    'Show notifications with read-state and severity.',
    ['notification-center']
  ),
  component(
    'QuickActionsSection',
    'section',
    ['static', 'computed', 'app', 'api', 'summary'],
    'Show immediate task shortcuts.',
    ['quick-actions-grid']
  ),
  component(
    'CheckoutSummarySection',
    'section',
    ['table', 'app', 'api', 'postgres'],
    'Show checkout line items, totals, and action row.',
    ['checkout-summary']
  ),
  component(
    'ChatPanelSection',
    'section',
    ['static', 'app', 'api', 'markdown'],
    'Show a conversation surface.'
  ),
  component(
    'EditorPreviewSection',
    'section',
    ['static', 'app', 'api', 'markdown'],
    'Show an editor and preview split.'
  ),
  component(
    'ComparisonSection',
    'section',
    ['table', 'computed', 'app', 'api', 'postgres', 'markdown'],
    'Compare plans, diffs, options, candidates, or versions.'
  ),
  component(
    'NavigationPanel',
    'section',
    ['static', 'navigation'],
    'Show compact local navigation.'
  ),
  component(
    'MainSearchNavigationSection',
    'section',
    ['static', 'navigation', 'app'],
    'Show a main search bar, flexible tabs, and visible result cards.',
    ['search-navigation-tabs']
  ),
  component(
    'EmptyState',
    'section',
    ['none', 'static', 'app', 'summary', 'rss', 'postgres', 'api', 'markdown', 'navigation'],
    'Show an empty-state fallback.'
  ),
  component(
    'ErrorState',
    'section',
    ['none', 'static', 'app', 'summary', 'rss', 'postgres', 'api', 'markdown', 'navigation'],
    'Show an error-state fallback.'
  ),
];

export const blueprintCatalogByName = new Map(
  blueprintCatalog.map((definition) => [definition.name, definition])
);

export function getBlueprintComponentDefinition(name: string) {
  return blueprintCatalogByName.get(name as BlueprintComponentName) || null;
}

export function isAllowedBlueprintSource(name: string, source: BlueprintDataSourceKind): boolean {
  const definition = getBlueprintComponentDefinition(name);
  return Boolean(definition?.allowedSources.includes(source));
}

function component(
  name: BlueprintComponentName,
  placement: BlueprintComponentDefinition['placement'],
  allowedSources: BlueprintDataSourceKind[],
  promptGuidance: string,
  variants: string[] = ['default']
): BlueprintComponentDefinition {
  return {
    name,
    placement,
    allowedSources,
    variants,
    promptGuidance,
  };
}
