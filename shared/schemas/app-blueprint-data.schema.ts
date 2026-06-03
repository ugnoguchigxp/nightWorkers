import { z } from '@hono/zod-openapi';

const blueprintIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9-]*$/);

export const blueprintColumnSchema = z
  .object({
    name: blueprintIdSchema,
    type: z.enum(['string', 'text', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'json']),
    nullable: z.boolean().default(false),
    primaryKey: z.boolean().default(false),
    unique: z.boolean().default(false),
    label: z.string().min(1).optional(),
    uiHint: z
      .enum(['short_text', 'long_text', 'number', 'money', 'date', 'status', 'relation'])
      .optional(),
  })
  .openapi('BlueprintColumn');

export const blueprintRelationSchema = z
  .object({
    id: blueprintIdSchema,
    fromTable: blueprintIdSchema,
    fromColumn: blueprintIdSchema,
    toTable: blueprintIdSchema,
    toColumn: blueprintIdSchema,
    cardinality: z.enum(['one_to_one', 'one_to_many', 'many_to_one', 'many_to_many']),
  })
  .openapi('BlueprintRelation');

export const blueprintTableSchema = z
  .object({
    name: blueprintIdSchema,
    label: z.string().min(1),
    columns: z.array(blueprintColumnSchema).min(1),
    indexes: z.array(z.array(blueprintIdSchema).min(1)).default([]),
  })
  .openapi('BlueprintTable');

export const blueprintDatabaseSchema = z
  .object({
    tables: z.array(blueprintTableSchema).default([]),
    relations: z.array(blueprintRelationSchema).default([]),
  })
  .openapi('BlueprintDatabaseSchema');

export type BlueprintColumn = z.infer<typeof blueprintColumnSchema>;
export type BlueprintRelation = z.infer<typeof blueprintRelationSchema>;
export type BlueprintTable = z.infer<typeof blueprintTableSchema>;
export type BlueprintDatabaseSchema = z.infer<typeof blueprintDatabaseSchema>;
