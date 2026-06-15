import type {
  BlueprintComponentName,
  BlueprintDataSourceKind,
} from './schemas/blueprint-catalog.schema';

export type BlueprintSectionReferenceEntry = {
  name: BlueprintComponentName;
  displayName: string;
  category: 'content' | 'data' | 'input' | 'workflow' | 'navigation' | 'feedback' | 'commerce';
  allowedSources: BlueprintDataSourceKind[];
  variants: string[];
  promptGuidance: string;
  llmReference: string;
};

export const blueprintSectionReference = [
  section(
    'ChartSection',
    'Chart',
    'data',
    ['computed', 'table', 'summary', 'postgres', 'api', 'app'],
    'Use for numeric comparisons, trends, shares, or radar scores.',
    ['bar', 'line', 'area', 'pie', 'radar'],
    'Use when the screen needs a real chart surface for metrics, comparisons, distribution, or trends.'
  ),
  section(
    'DataTableSection',
    'Data Table',
    'data',
    ['table', 'postgres', 'api'],
    'Show bounded table data.',
    ['default'],
    'Use when users need row/column scanning, sorting expectations, or operational records.'
  ),
  section(
    'ImageSection',
    'Image',
    'content',
    ['static', 'app', 'api', 'markdown'],
    'Show a validated image.',
    ['default'],
    'Use for a single image with clear alt text, caption, or content context.'
  ),
  section(
    'VideoSection',
    'Video',
    'content',
    ['static', 'app', 'api', 'markdown'],
    'Show a video player preview without playback behavior.',
    ['video-player-preview'],
    'Use when a screen needs a video-player shaped media block with poster, controls, and duration.'
  ),
  section(
    'SplitHeroSection',
    'Split Hero',
    'content',
    ['static', 'app', 'api', 'markdown'],
    'Show a strong feature intro with optional image and actions.',
    ['default'],
    'Use for a landing or feature intro where copy and visual context sit side by side.'
  ),
  section(
    'FullBleedHeroSection',
    'Full Bleed Hero',
    'content',
    ['static', 'app', 'api', 'markdown'],
    'Show a full-bleed image hero with overlaid text and actions.',
    ['image-overlay-hero'],
    'Use when the image should stretch across the hero and text sits over the media.'
  ),
  section(
    'CarouselSection',
    'Carousel',
    'content',
    ['static', 'app', 'api', 'markdown', 'rss'],
    'Show products, articles, gallery items, or recommendations.',
    ['default'],
    'Use for horizontally browsable repeated media or content items.'
  ),
  section(
    'FormSection',
    'Form',
    'input',
    ['record', 'table', 'app', 'api', 'postgres'],
    'Collect or edit fields.',
    ['default'],
    'Use when the screen must capture text, select, checkbox, textarea, or record fields.'
  ),
  section(
    'CardGridSection',
    'Card Grid',
    'content',
    ['table', 'static', 'app', 'api', 'markdown', 'rss', 'postgres'],
    'Show scannable cards for products, projects, templates, files, or choices.',
    ['default'],
    'Use for repeated items that benefit from visual scanning rather than tabular comparison.'
  ),
  section(
    'TimelineSection',
    'Timeline',
    'workflow',
    ['table', 'record', 'rss', 'api', 'markdown'],
    'Show chronological events.',
    ['default'],
    'Use for ordered events, audit trails, milestones, or activity history.'
  ),
  section(
    'KanbanSection',
    'Kanban',
    'workflow',
    ['table', 'app', 'api', 'postgres'],
    'Show workflow columns.',
    ['kanban-board'],
    'Use for workflow states where each table cell contains draggable task cards.'
  ),
  section(
    'CalendarSection',
    'Calendar',
    'workflow',
    ['table', 'app', 'api', 'postgres'],
    'Show events or deadlines.',
    ['default'],
    'Use for month-grid date placement, deadlines, and scheduled markers.'
  ),
  section(
    'ScheduleSection',
    'Schedule',
    'workflow',
    ['table', 'app', 'api', 'postgres'],
    'Show upcoming scheduled items in a monthly card.',
    ['upcoming-schedule-monthly'],
    'Use for agenda-style upcoming items with date, time, owner, and location context.'
  ),
  section(
    'MapSection',
    'Map',
    'data',
    ['static', 'table', 'app', 'api', 'postgres'],
    'Show a map surface with search, markers, and nearby location details.',
    ['location-map', 'store-locator-map'],
    'Use for geographic surfaces with search, map markers, nearby results, or route stops.'
  ),
  section(
    'AccordionSection',
    'Accordion',
    'content',
    ['static', 'app', 'api', 'markdown', 'summary'],
    'Show FAQ, policy notes, or collapsible detail groups.',
    ['faq-accordion', 'details-accordion'],
    'Use for expandable detail groups where only one or a few answers should be open.'
  ),
  section(
    'ControlPanelSection',
    'Control Panel',
    'input',
    ['static', 'computed', 'app', 'api', 'summary'],
    'Show settings controls, mode tabs, and range controls.',
    ['ambient-control-panel', 'settings-sliders'],
    'Use for configuration surfaces with tabs, toggles, sliders, modes, and swatches.'
  ),
  section(
    'NotificationCenterSection',
    'Notification Center',
    'feedback',
    ['computed', 'summary', 'api', 'app'],
    'Show notifications with read-state and severity.',
    ['notification-center'],
    'Use for unread/read updates, severity states, and notification filtering.'
  ),
  section(
    'CheckoutSummarySection',
    'Checkout Summary',
    'commerce',
    ['table', 'app', 'api', 'postgres'],
    'Show checkout line items, totals, and action row.',
    ['checkout-summary'],
    'Use for commerce totals, line items, taxes, and checkout summary actions.'
  ),
  section(
    'PaymentFormSection',
    'Payment Form',
    'commerce',
    ['static', 'record', 'app', 'api'],
    'Show a payment form with card fields, order total, and pay action.',
    ['stripe-like-payment'],
    'Use for a Stripe-like payment entry surface with card fields and payment action.'
  ),
  section(
    'EmailInboxSection',
    'Email Inbox',
    'workflow',
    ['static', 'table', 'app', 'api', 'postgres'],
    'Show an email inbox with folders, toolbar, and message rows.',
    ['gmail-like-inbox'],
    'Use for Gmail-like message browsing with folders, search, toolbar, and read state.'
  ),
  section(
    'AnalyticsDashboardSection',
    'Analytics Dashboard',
    'data',
    ['computed', 'summary', 'table', 'app', 'api', 'postgres'],
    'Show dashboard metric cards with chart and analytics panel.',
    ['analytics-dashboard'],
    'Use for dashboard screens with metric cards, a Recharts report chart, and analytics summary.'
  ),
  section(
    'ChatPanelSection',
    'Chat Panel',
    'workflow',
    ['static', 'app', 'api', 'markdown'],
    'Show a conversation surface.',
    ['default'],
    'Use for conversation, review comments, assistant responses, or threaded discussion.'
  ),
  section(
    'CodeEditorSection',
    'Code Editor',
    'input',
    ['static', 'app', 'api', 'markdown'],
    'Show a full-width code or content editor surface.',
    ['default'],
    'Use for code or text editing surfaces with line numbers, compact code density, and editor chrome.'
  ),
  section(
    'ComparisonSection',
    'Comparison',
    'data',
    ['table', 'computed', 'app', 'api', 'postgres', 'markdown'],
    'Compare plans, diffs, options, candidates, or versions.',
    ['default'],
    'Use for side-by-side tradeoffs, current versus proposed states, or plan comparison.'
  ),
  section(
    'TopMenuSection',
    'Top Menu',
    'navigation',
    ['static', 'navigation', 'app'],
    'Show a persistent top menu with brand, global links, and right-side actions.',
    ['top-menu', 'application-header'],
    'Use for a one-line application header with brand, links, dropdown-like menu, and search.'
  ),
  section(
    'TabNavigationSection',
    'Tab Navigation',
    'navigation',
    ['static', 'navigation', 'app'],
    'Show horizontal tabs for switching between sibling views or filtered states.',
    ['tabs', 'segmented-tabs'],
    'Use for sibling views, mode switching, or filtered panels.'
  ),
  section(
    'SidebarMenuSection',
    'Sidebar Menu',
    'navigation',
    ['static', 'navigation', 'app'],
    'Show a left sidebar menu with grouped primary navigation and badges.',
    ['left-sidebar-menu'],
    'Use for grouped left-side primary navigation with badges and active states.'
  ),
  section(
    'LeftSidebarSection',
    'Left Sidebar',
    'navigation',
    ['static', 'navigation', 'app'],
    'Show a fixed left application sidebar with navigation groups and active state.',
    ['left-sidebar-layout'],
    'Use for persistent application sidebars with logo, icons, groups, and active item.'
  ),
  section(
    'ExplorerSidebarSection',
    'Side Bar',
    'navigation',
    ['static', 'navigation', 'app'],
    'Show an explorer-style sidebar for nested files, pages, projects, or collections.',
    ['explorer-tree-sidebar'],
    'Use for nested tree navigation such as files, pages, project folders, or collections.'
  ),
  section(
    'RightSidebarLinksSection',
    'Right Sidebar Links',
    'navigation',
    ['static', 'navigation', 'app', 'markdown'],
    'Show a right sidebar link rail for related pages, anchors, docs, or resources.',
    ['right-link-rail'],
    'Use for related links, table-of-contents anchors, resources, or document side rails.'
  ),
  section(
    'FooterNavigationSection',
    'Footer',
    'navigation',
    ['static', 'navigation', 'app', 'markdown'],
    'Show footer navigation columns with secondary links and support destinations.',
    ['footer-nav-columns'],
    'Use for secondary navigation at the bottom of product, docs, or app screens.'
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
  displayName: string,
  category: BlueprintSectionReferenceEntry['category'],
  allowedSources: BlueprintDataSourceKind[],
  promptGuidance: string,
  variants: string[],
  llmReference: string
): BlueprintSectionReferenceEntry {
  return {
    name,
    displayName,
    category,
    allowedSources,
    variants,
    promptGuidance,
    llmReference,
  };
}
