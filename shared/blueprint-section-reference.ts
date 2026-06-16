import type {
  BlueprintComponentName,
  BlueprintDataSourceKind,
} from './schemas/blueprint-catalog.schema';

export type BlueprintSectionReferenceEntry = {
  name: BlueprintComponentName;
  allowedSources: BlueprintDataSourceKind[];
  variants: string[];
};

export const blueprintSectionReference = [
  section(
    'ChartSection',
    ['computed', 'table', 'summary', 'postgres', 'api', 'app'],
    ['bar', 'line', 'area', 'pie', 'radar']
  ),
  section('DataTableSection', ['table', 'postgres', 'api']),
  section('ImageSection', ['static', 'app', 'api', 'markdown']),
  section('VideoSection', ['static', 'app', 'api', 'markdown'], ['video-player-preview']),
  section(
    'BlogPostSection',
    ['static', 'markdown', 'rss', 'app', 'api'],
    ['blog-post', 'article-body']
  ),
  section(
    'MediaTextSection',
    ['static', 'markdown', 'rss', 'app', 'api'],
    ['media-left', 'media-right', 'feature-story']
  ),
  section('SplitHeroSection', ['static', 'app', 'api', 'markdown']),
  section('FullBleedHeroSection', ['static', 'app', 'api', 'markdown'], ['image-overlay-hero']),
  section('CarouselSection', ['static', 'app', 'api', 'markdown', 'rss']),
  section('FormSection', ['record', 'table', 'app', 'api', 'postgres']),
  section('CardGridSection', ['table', 'static', 'app', 'api', 'markdown', 'rss', 'postgres']),
  section('TimelineSection', ['table', 'record', 'rss', 'api', 'markdown']),
  section('KanbanSection', ['table', 'app', 'api', 'postgres'], ['kanban-board']),
  section('CalendarSection', ['table', 'app', 'api', 'postgres']),
  section('ScheduleSection', ['table', 'app', 'api', 'postgres'], ['upcoming-schedule-monthly']),
  section(
    'MapSection',
    ['static', 'table', 'app', 'api', 'postgres'],
    ['location-map', 'store-locator-map']
  ),
  section(
    'AccordionSection',
    ['static', 'app', 'api', 'markdown', 'summary'],
    ['faq-accordion', 'details-accordion']
  ),
  section(
    'ControlPanelSection',
    ['static', 'computed', 'app', 'api', 'summary'],
    ['ambient-control-panel', 'settings-sliders']
  ),
  section(
    'NotificationCenterSection',
    ['computed', 'summary', 'api', 'app'],
    ['notification-center']
  ),
  section('CheckoutSummarySection', ['table', 'app', 'api', 'postgres'], ['checkout-summary']),
  section('PaymentFormSection', ['static', 'record', 'app', 'api'], ['stripe-like-payment']),
  section('EmailInboxSection', ['static', 'table', 'app', 'api', 'postgres'], ['gmail-like-inbox']),
  section(
    'AnalyticsDashboardSection',
    ['computed', 'summary', 'table', 'app', 'api', 'postgres'],
    ['analytics-dashboard']
  ),
  section('ChatPanelSection', ['static', 'app', 'api', 'markdown']),
  section('CodeEditorSection', ['static', 'app', 'api', 'markdown']),
  section('ComparisonSection', ['table', 'computed', 'app', 'api', 'postgres', 'markdown']),
  section('TopMenuSection', ['static', 'navigation', 'app'], ['top-menu', 'application-header']),
  section('TabNavigationSection', ['static', 'navigation', 'app'], ['tabs', 'segmented-tabs']),
  section('SidebarMenuSection', ['static', 'navigation', 'app'], ['left-sidebar-menu']),
  section('LeftSidebarSection', ['static', 'navigation', 'app'], ['left-body-sidebar']),
  section('ExplorerSidebarSection', ['static', 'navigation', 'app'], ['explorer-tree-sidebar']),
  section(
    'RightSidebarLinksSection',
    ['static', 'navigation', 'app', 'markdown'],
    ['right-body-sidebar']
  ),
  section(
    'FooterNavigationSection',
    ['static', 'navigation', 'app', 'markdown'],
    ['footer-nav-columns']
  ),
] satisfies BlueprintSectionReferenceEntry[];

export const blueprintSectionReferenceByName = new Map(
  blueprintSectionReference.map((entry) => [entry.name, entry])
);

export function getBlueprintSectionReference(name: string) {
  return blueprintSectionReferenceByName.get(name as BlueprintComponentName) || null;
}

function section(
  name: BlueprintComponentName,
  allowedSources: BlueprintDataSourceKind[],
  variants: string[] = ['default']
): BlueprintSectionReferenceEntry {
  return {
    name,
    allowedSources,
    variants,
  };
}
