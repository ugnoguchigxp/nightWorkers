import { z } from '@hono/zod-openapi';

const mockBlueprintIdSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/);

const mockBlueprintScalarSchema = z.union([z.string(), z.number(), z.boolean()]);

export const renderableMockBlueprintSectionNames = [
  'AccordionSection',
  'AnalyticsDashboardSection',
  'BlogPostSection',
  'CalendarSection',
  'CardGridSection',
  'CarouselSection',
  'ChartSection',
  'ChatPanelSection',
  'CheckoutSummarySection',
  'CodeEditorSection',
  'ComparisonSection',
  'ControlPanelSection',
  'DataTableSection',
  'EmailInboxSection',
  'ExplorerSidebarSection',
  'FooterNavigationSection',
  'FormSection',
  'FullBleedHeroSection',
  'ImageSection',
  'KanbanSection',
  'LeftSidebarSection',
  'MapSection',
  'MediaTextSection',
  'NotificationCenterSection',
  'PaymentFormSection',
  'RightSidebarLinksSection',
  'ScheduleSection',
  'SidebarMenuSection',
  'SplitHeroSection',
  'TabNavigationSection',
  'TimelineSection',
  'TopMenuSection',
  'VideoSection',
] as const;

export const renderableMockBlueprintSectionNameSchema = z.enum(renderableMockBlueprintSectionNames);

const navigationDatasetSchema = z
  .object({
    kind: z.literal('navigation'),
    items: z
      .array(
        z
          .object({
            label: z.string().min(1),
            href: z.string().min(1).optional(),
            active: z.boolean().optional(),
          })
          .strict()
      )
      .min(1),
  })
  .strict();

const tableDatasetSchema = z
  .object({
    kind: z.literal('table'),
    columns: z
      .array(z.object({ key: mockBlueprintIdSchema, label: z.string().min(1) }).strict())
      .min(1),
    rows: z.array(z.record(z.string(), mockBlueprintScalarSchema)).min(1),
  })
  .strict();

const formDatasetSchema = z
  .object({
    kind: z.literal('form'),
    fields: z
      .array(
        z
          .object({
            name: mockBlueprintIdSchema,
            label: z.string().min(1),
            type: z.enum(['text', 'textarea', 'select', 'checkbox', 'date', 'number']),
            placeholder: z.string().min(1).optional(),
            options: z.array(z.string().min(1)).optional(),
          })
          .strict()
      )
      .min(1),
    submitLabel: z.string().min(1),
  })
  .strict();

const cardsDatasetSchema = z
  .object({
    kind: z.literal('cards'),
    cards: z
      .array(
        z
          .object({
            title: z.string().min(1),
            description: z.string().min(1),
            meta: z.string().min(1).optional(),
            actionLabel: z.string().min(1).optional(),
          })
          .strict()
      )
      .min(1),
  })
  .strict();

const kanbanDatasetSchema = z
  .object({
    kind: z.literal('kanban'),
    columns: z
      .array(
        z
          .object({
            id: mockBlueprintIdSchema,
            title: z.string().min(1),
            cards: z
              .array(
                z
                  .object({
                    title: z.string().min(1),
                    description: z.string().min(1),
                    meta: z.string().min(1).optional(),
                  })
                  .strict()
              )
              .default([]),
          })
          .strict()
      )
      .min(1),
  })
  .strict();

const timelineDatasetSchema = z
  .object({
    kind: z.literal('timeline'),
    items: z
      .array(
        z
          .object({
            title: z.string().min(1),
            description: z.string().min(1),
            timestamp: z.string().min(1).optional(),
          })
          .strict()
      )
      .min(1),
  })
  .strict();

const articleDatasetSchema = z
  .object({
    kind: z.literal('article'),
    title: z.string().min(1),
    body: z.string().min(1),
    meta: z
      .array(z.object({ label: z.string().min(1), value: z.string().min(1) }).strict())
      .optional(),
  })
  .strict();

const metricsDatasetSchema = z
  .object({
    kind: z.literal('metrics'),
    metrics: z
      .array(
        z
          .object({
            label: z.string().min(1),
            value: mockBlueprintScalarSchema,
            trend: z.string().min(1).optional(),
          })
          .strict()
      )
      .min(1),
  })
  .strict();

const mediaDatasetSchema = z
  .object({
    kind: z.literal('media'),
    items: z
      .array(
        z
          .object({
            title: z.string().min(1),
            description: z.string().min(1),
            mediaLabel: z.string().min(1).optional(),
          })
          .strict()
      )
      .min(1),
  })
  .strict();

const mapDatasetSchema = z
  .object({
    kind: z.literal('map'),
    points: z
      .array(
        z
          .object({
            label: z.string().min(1),
            description: z.string().min(1),
            region: z.string().min(1).optional(),
          })
          .strict()
      )
      .min(1),
  })
  .strict();

const codeDatasetSchema = z
  .object({
    kind: z.literal('code'),
    files: z
      .array(
        z
          .object({
            path: z.string().min(1),
            language: z.string().min(1),
            excerpt: z.string().min(1),
          })
          .strict()
      )
      .min(1),
  })
  .strict();

const chatDatasetSchema = z
  .object({
    kind: z.literal('chat'),
    messages: z
      .array(
        z
          .object({
            author: z.string().min(1),
            body: z.string().min(1),
            state: z.string().min(1).optional(),
          })
          .strict()
      )
      .min(1),
  })
  .strict();

const genericDatasetSchema = z
  .object({
    kind: z.literal('generic'),
    items: z
      .array(z.object({ title: z.string().min(1), description: z.string().min(1) }).strict())
      .min(1),
  })
  .strict();

export const mockBlueprintDatasetSchema = z.discriminatedUnion('kind', [
  navigationDatasetSchema,
  tableDatasetSchema,
  formDatasetSchema,
  cardsDatasetSchema,
  kanbanDatasetSchema,
  timelineDatasetSchema,
  articleDatasetSchema,
  metricsDatasetSchema,
  mediaDatasetSchema,
  mapDatasetSchema,
  codeDatasetSchema,
  chatDatasetSchema,
  genericDatasetSchema,
]);

export const mockBlueprintDatasetKinds = [
  'navigation',
  'table',
  'form',
  'cards',
  'kanban',
  'timeline',
  'article',
  'metrics',
  'media',
  'map',
  'code',
  'chat',
  'generic',
] as const;

export type MockBlueprintDatasetKind = (typeof mockBlueprintDatasetKinds)[number];

const datasetKindsBySection = {
  TopMenuSection: ['navigation', 'generic'],
  TabNavigationSection: ['navigation', 'generic'],
  SidebarMenuSection: ['navigation', 'generic'],
  LeftSidebarSection: ['navigation', 'generic'],
  RightSidebarLinksSection: ['navigation', 'generic'],
  FooterNavigationSection: ['navigation', 'generic'],
  ExplorerSidebarSection: ['navigation', 'generic'],
  DataTableSection: ['table'],
  EmailInboxSection: ['table'],
  FormSection: ['form'],
  PaymentFormSection: ['form'],
  CardGridSection: ['cards', 'generic', 'metrics'],
  AccordionSection: ['cards', 'generic', 'metrics'],
  ComparisonSection: ['cards', 'generic', 'metrics'],
  ControlPanelSection: ['cards', 'generic', 'metrics'],
  CheckoutSummarySection: ['cards', 'generic', 'metrics'],
  NotificationCenterSection: ['cards', 'generic', 'metrics'],
  KanbanSection: ['kanban'],
  TimelineSection: ['timeline', 'generic'],
  ScheduleSection: ['timeline', 'generic'],
  CalendarSection: ['timeline', 'generic'],
  BlogPostSection: ['article'],
  MediaTextSection: ['media', 'article', 'cards'],
  ImageSection: ['media', 'article', 'cards'],
  VideoSection: ['media', 'article', 'cards'],
  CarouselSection: ['media', 'article', 'cards'],
  SplitHeroSection: ['media', 'article', 'cards'],
  FullBleedHeroSection: ['media', 'article', 'cards'],
  ChartSection: ['metrics', 'table'],
  AnalyticsDashboardSection: ['metrics', 'table'],
  MapSection: ['map', 'generic'],
  ChatPanelSection: ['chat'],
  CodeEditorSection: ['code'],
} as const satisfies Record<
  (typeof renderableMockBlueprintSectionNames)[number],
  readonly MockBlueprintDatasetKind[]
>;

export function getMockBlueprintDatasetKindsForSection(
  sectionName: RenderableMockBlueprintSectionName
): readonly MockBlueprintDatasetKind[] {
  return datasetKindsBySection[sectionName];
}

export const mockBlueprintSectionRegionSchema = z.enum([
  'header',
  'main',
  'sidebar',
  'aside',
  'full_width',
  'footer',
]);

export const mockBlueprintScreenLayoutTemplateSchema = z.enum([
  'single_column',
  'two_column',
  'three_column',
  'sidebar_left',
  'sidebar_right',
  'article_with_sidebar',
]);

export const mockBlueprintSectionSchema = z
  .object({
    id: mockBlueprintIdSchema,
    name: z.string().min(1),
    componentName: renderableMockBlueprintSectionNameSchema,
    region: mockBlueprintSectionRegionSchema.nullish(),
    selectionReason: z.string().min(1),
    copy: z
      .object({
        title: z.string().min(1),
        description: z.string().min(1).nullish(),
        primaryActionLabel: z.string().min(1).nullish(),
        secondaryActionLabel: z.string().min(1).nullish(),
        emptyStateTitle: z.string().min(1).nullish(),
        emptyStateDescription: z.string().min(1).nullish(),
      })
      .strict(),
    dataset: mockBlueprintDatasetSchema,
  })
  .strict()
  .superRefine((section, ctx) => {
    const allowedKinds = getMockBlueprintDatasetKindsForSection(section.componentName);
    if (allowedKinds.includes(section.dataset.kind)) return;
    ctx.addIssue({
      code: 'custom',
      path: ['dataset', 'kind'],
      message: `${section.componentName} does not support ${section.dataset.kind} mock dataset.`,
    });
  });

export const mockBlueprintScreenSchema = z
  .object({
    id: mockBlueprintIdSchema,
    name: z.string().min(1),
    path: z.string().min(1),
    purpose: z.string().min(1),
    layout: z
      .object({
        template: mockBlueprintScreenLayoutTemplateSchema,
      })
      .strict(),
    sections: z.array(mockBlueprintSectionSchema).min(1).max(6),
  })
  .strict();

export const mockBlueprintSchema = z
  .object({
    artifactKind: z.literal('mock_blueprint'),
    id: mockBlueprintIdSchema,
    name: z.string().min(1),
    version: z.literal(1),
    summary: z.string().min(1),
    tone: z.string().min(1),
    screens: z.array(mockBlueprintScreenSchema).min(1).max(3),
    generationNotes: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type RenderableMockBlueprintSectionName = z.infer<
  typeof renderableMockBlueprintSectionNameSchema
>;
export type MockBlueprintDataset = z.infer<typeof mockBlueprintDatasetSchema>;
export type MockBlueprintSection = z.infer<typeof mockBlueprintSectionSchema>;
export type MockBlueprintScreen = z.infer<typeof mockBlueprintScreenSchema>;
export type MockBlueprint = z.infer<typeof mockBlueprintSchema>;
