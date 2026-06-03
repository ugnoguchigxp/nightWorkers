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

export const blueprintSectionSchema = z
  .object({
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
export type BlueprintSection = z.infer<typeof blueprintSectionSchema>;
export type BlueprintScreen = z.infer<typeof blueprintScreenSchema>;
