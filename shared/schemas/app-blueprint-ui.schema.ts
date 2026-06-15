import { z } from '@hono/zod-openapi';
import {
  blueprintComponentNameSchema,
  blueprintDataSourceKindSchema,
} from './blueprint-catalog.schema';

const blueprintIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9-]*$/);

export const blueprintActionSchema = z
  .object({
    id: blueprintIdSchema,
    label: z.string().min(1),
    type: z.enum(['navigate', 'submit', 'open', 'filter', 'custom']),
    target: z.string().min(1).optional(),
  })
  .openapi('BlueprintAction');

const blueprintLayoutWidthSchema = z.enum(['auto', 'full', '1/2', '1/3', '2/3']);
const blueprintLayoutAlignSchema = z.enum(['start', 'center', 'end', 'stretch']);
const blueprintLayoutGapSchema = z.enum(['none', 'xs', 'sm', 'md', 'lg']);
const blueprintLayoutKindSchema = z.enum(['stack', 'row', 'grid', 'split', 'tabs']);
const blueprintNodeComponentSchema = z.enum([
  'Text',
  'Button',
  'IconButton',
  'Input',
  'InputGroup',
  'Select',
  'Checkbox',
  'Switch',
  'Card',
  'Badge',
  'Avatar',
  'DataTable',
  'Table',
  'List',
  'Tabs',
  'Accordion',
  'Alert',
  'Progress',
  'Tooltip',
  'Dialog',
  'Sidebar',
  'Breadcrumb',
  'Pagination',
  'Separator',
]);

export const blueprintNodeLayoutSchema = z
  .object({
    width: blueprintLayoutWidthSchema.optional(),
    colSpan: z.number().int().min(1).max(12).optional(),
    align: blueprintLayoutAlignSchema.optional(),
    gap: blueprintLayoutGapSchema.optional(),
  })
  .openapi('BlueprintNodeLayout');

export const blueprintNodeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('layout'),
      id: blueprintIdSchema.optional(),
      layout: blueprintLayoutKindSchema.default('stack'),
      props: z.record(z.string(), z.unknown()).default({}),
      children: z.array(blueprintNodeSchema).default([]),
    }),
    z.object({
      kind: z.literal('component'),
      id: blueprintIdSchema,
      component: blueprintNodeComponentSchema,
      props: z.record(z.string(), z.unknown()).default({}),
      layout: blueprintNodeLayoutSchema.default({}),
      children: z.array(blueprintNodeSchema).default([]),
    }),
  ])
);

export const blueprintPresetNameSchema = z.enum([
  'search_header',
  'table_workspace',
  'metrics_overview',
  'chart_insight',
  'kanban_board',
]);

export const blueprintSectionOverrideSchema = z
  .object({
    target: z.string().min(1),
    set: z
      .object({
        props: z.record(z.string(), z.unknown()).optional(),
        layout: blueprintNodeLayoutSchema.optional(),
      })
      .optional(),
    insert: blueprintNodeSchema.optional(),
    position: z.enum(['start', 'end', 'before', 'after']).optional(),
    remove: z.boolean().optional(),
    replace: blueprintNodeSchema.optional(),
  })
  .superRefine((override, ctx) => {
    if (override.set || override.insert || override.remove || override.replace) return;
    ctx.addIssue({
      code: 'custom',
      message: 'Override must define set, insert, remove, or replace.',
      path: ['target'],
    });
  })
  .openapi('BlueprintSectionOverride');

export const blueprintSectionPatchSchema = z
  .discriminatedUnion('op', [
    z.object({
      op: z.literal('set'),
      target: z.string().min(1),
      path: z.string().min(1),
      value: z.unknown(),
    }),
    z.object({
      op: z.literal('insert'),
      target: z.string().min(1),
      position: z.enum(['start', 'end', 'before', 'after']).default('end'),
      node: blueprintNodeSchema,
    }),
    z.object({
      op: z.literal('remove'),
      target: z.string().min(1),
    }),
    z.object({
      op: z.literal('replace'),
      target: z.string().min(1),
      node: blueprintNodeSchema,
    }),
  ])
  .openapi('BlueprintSectionPatch');

export const legacyBlueprintSectionSchema = z
  .object({
    kind: z.literal('legacy_section').optional(),
    id: blueprintIdSchema,
    name: z.string().min(1),
    componentName: blueprintComponentNameSchema,
    source: blueprintDataSourceKindSchema.default('none'),
    dataBindingId: blueprintIdSchema.optional(),
    intent: z.string().min(1).optional(),
    visualIntent: z.string().min(1).optional(),
    props: z.record(z.string(), z.unknown()).default({}),
    actions: z.array(blueprintActionSchema).default([]),
  })
  .openapi('LegacyBlueprintSection');

export const presetBlueprintSectionSchema = z
  .object({
    kind: z.literal('preset_section'),
    id: blueprintIdSchema,
    name: z.string().min(1).optional(),
    preset: blueprintPresetNameSchema,
    props: z.record(z.string(), z.unknown()).default({}),
    overrides: z.array(blueprintSectionOverrideSchema).default([]),
    actions: z.array(blueprintActionSchema).default([]),
  })
  .openapi('PresetBlueprintSection');

export const customBlueprintSectionSchema = z
  .object({
    kind: z.literal('custom_section'),
    id: blueprintIdSchema,
    title: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    root: blueprintNodeSchema,
    actions: z.array(blueprintActionSchema).default([]),
  })
  .openapi('CustomBlueprintSection');

export const blueprintSectionSchema = z
  .union([legacyBlueprintSectionSchema, presetBlueprintSectionSchema, customBlueprintSectionSchema])
  .openapi('BlueprintSection');

export const blueprintScreenSchema = z
  .object({
    id: blueprintIdSchema,
    name: z.string().min(1),
    path: z.string().regex(/^\/[a-zA-Z0-9/_-]*$/),
    componentName: blueprintComponentNameSchema,
    sections: z.array(blueprintSectionSchema).min(1),
    actions: z.array(blueprintActionSchema).default([]),
  })
  .openapi('BlueprintScreen');

export type BlueprintAction = z.infer<typeof blueprintActionSchema>;
export type BlueprintNode = z.infer<typeof blueprintNodeSchema>;
export type BlueprintSectionPatch = z.infer<typeof blueprintSectionPatchSchema>;
export type BlueprintSectionOverride = z.infer<typeof blueprintSectionOverrideSchema>;
export type LegacyBlueprintSection = z.infer<typeof legacyBlueprintSectionSchema>;
export type PresetBlueprintSection = z.infer<typeof presetBlueprintSectionSchema>;
export type CustomBlueprintSection = z.infer<typeof customBlueprintSectionSchema>;
export type BlueprintSection = z.infer<typeof blueprintSectionSchema>;
export type BlueprintScreen = z.infer<typeof blueprintScreenSchema>;
