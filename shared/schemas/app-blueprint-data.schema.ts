import { z } from '@hono/zod-openapi';

const blueprintDataIdentifierSchema = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9_-]*$/);

export const blueprintColumnSchema = z
  .object({
    name: blueprintDataIdentifierSchema,
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
    id: blueprintDataIdentifierSchema,
    fromTable: blueprintDataIdentifierSchema,
    fromColumn: blueprintDataIdentifierSchema,
    toTable: blueprintDataIdentifierSchema,
    toColumn: blueprintDataIdentifierSchema,
    cardinality: z.enum(['one_to_one', 'one_to_many', 'many_to_one', 'many_to_many']),
  })
  .openapi('BlueprintRelation');

export const blueprintTableSchema = z
  .object({
    name: blueprintDataIdentifierSchema,
    label: z.string().min(1),
    columns: z.array(blueprintColumnSchema).min(1),
    indexes: z.array(z.array(blueprintDataIdentifierSchema).min(1)).default([]),
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
