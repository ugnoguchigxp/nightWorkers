import { z } from '@hono/zod-openapi';

export const blueprintComponentNameSchema = z.enum([
  'DashboardPage',
  'EntityListPage',
  'EntityDetailPage',
  'EditableFormPage',
  'ArticleFeedPage',
  'SidebarPage',
  'ListPage',
  'DetailPage',
  'FormPage',
  'ChartSection',
  'DataTableSection',
  'ImageSection',
  'VideoSection',
  'SplitHeroSection',
  'FullBleedHeroSection',
  'CarouselSection',
  'FormSection',
  'CardGridSection',
  'TimelineSection',
  'KanbanSection',
  'CalendarSection',
  'ScheduleSection',
  'MapSection',
  'AccordionSection',
  'ControlPanelSection',
  'NotificationCenterSection',
  'CheckoutSummarySection',
  'PaymentFormSection',
  'EmailInboxSection',
  'AnalyticsDashboardSection',
  'ChatPanelSection',
  'CodeEditorSection',
  'ComparisonSection',
  'TopMenuSection',
  'TabNavigationSection',
  'SidebarMenuSection',
  'LeftSidebarSection',
  'ExplorerSidebarSection',
  'RightSidebarLinksSection',
  'FooterNavigationSection',
]);

export const blueprintComponentPlacementSchema = z.enum(['page', 'section', 'shell', 'primitive']);

export const blueprintDataSourceKindSchema = z.enum([
  'none',
  'static',
  'table',
  'record',
  'computed',
  'app',
  'summary',
  'postgres',
  'api',
  'rss',
  'markdown',
  'navigation',
]);

export const blueprintComponentDefinitionSchema = z
  .object({
    name: blueprintComponentNameSchema,
    placement: blueprintComponentPlacementSchema,
    allowedSources: z.array(blueprintDataSourceKindSchema).min(1),
    variants: z.array(z.string().min(1)).default([]),
    promptGuidance: z.string().min(1),
    propsSchema: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('BlueprintComponentDefinition');

export type BlueprintComponentName = z.infer<typeof blueprintComponentNameSchema>;
export type BlueprintComponentPlacement = z.infer<typeof blueprintComponentPlacementSchema>;
export type BlueprintDataSourceKind = z.infer<typeof blueprintDataSourceKindSchema>;
export type BlueprintComponentDefinition = z.infer<typeof blueprintComponentDefinitionSchema>;
