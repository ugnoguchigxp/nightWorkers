import { z } from '@hono/zod-openapi';

const dateLikeSchema = z.union([z.string(), z.date()]);

export const taskStatusSchema = z.enum([
  'draft',
  'ready',
  'context_compiling',
  'queued',
  'running',
  'finalizing',
  'verifying',
  'needs_review',
  'completed',
  'blocked',
  'failed',
  'timed_out',
  'cancelled',
  'needs_human',
]);

export const safetyPolicySchema = z
  .object({
    allowedPaths: z.array(z.string()).optional(),
    externalAllowedPaths: z.array(z.string()).optional(),
    deniedPaths: z.array(z.string()).optional(),
    blockedCommands: z.array(z.string()).optional(),
    maxCommandSeconds: z.number().optional(),
    requireReadBeforeEdit: z.boolean().optional(),
    maxTimeSeconds: z.number().optional(),
  })
  .openapi('SafetyPolicy');

export const repositorySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    localPath: z.string(),
    branch: z.string(),
    allowed: z.boolean(),
    queueEnabled: z.boolean().default(false),
    maxConcurrentSessions: z.number().int().positive().default(1),
    safetyPolicy: safetyPolicySchema.nullable().optional(),
    createdAt: dateLikeSchema,
    updatedAt: dateLikeSchema,
  })
  .openapi('Repository');

export const createRepositorySchema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    localPath: z.string().min(1, 'Local path is required'),
    branch: z.string().optional().default('main'),
    allowed: z.boolean().default(true),
    queueEnabled: z.boolean().default(false),
    maxConcurrentSessions: z.number().int().positive().default(1),
    safetyPolicy: safetyPolicySchema.optional(),
  })
  .openapi('CreateRepository');

export const taskSchema = z
  .object({
    id: z.string().uuid(),
    repositoryId: z.string().uuid(),
    title: z.string(),
    description: z.string().nullable().optional(),
    objective: z.string().nullable().optional(),
    acceptanceCriteria: z.string().nullable().optional(),
    status: taskStatusSchema,
    compiledPrompt: z.string().nullable().optional(),
    timeoutSeconds: z.number(),
    priority: z.number(),
    createdBy: z.string().nullable().optional(),
    createdAt: dateLikeSchema,
    updatedAt: dateLikeSchema,
  })
  .openapi('Task');

export const createTaskSchema = z
  .object({
    repositoryId: z.string().uuid(),
    title: z.string().min(1, 'Title is required'),
    description: z.string().optional(),
    objective: z.string().optional(),
    acceptanceCriteria: z.string().optional(),
    timeoutSeconds: z.number().default(3600),
    priority: z.number().default(0),
    createdBy: z.string().optional(),
  })
  .openapi('CreateTask');

export const blueprintPreviewDesignSettingsSchema = z
  .object({
    theme: z.enum([
      'light',
      'dark',
      'eclipse',
      'macosclassic',
      'campfire',
      'mint',
      'bloom',
      'mocha',
    ]),
    density: z.enum(['compact', 'default', 'comfortable']),
    shape: z.enum(['sharp', 'default', 'rounded', 'pill']),
    shadow: z.enum(['none', 'subtle', 'medium', 'strong']),
    shadowDirection: z.enum([
      '0deg',
      '45deg',
      '90deg',
      '135deg',
      '180deg',
      '225deg',
      '270deg',
      '315deg',
    ]),
    font: z.enum(['system', 'geist', 'serif', 'mono']),
    contrast: z.enum(['standard', 'high']),
    motion: z.enum(['reduced', 'standard']),
    componentVariants: z.object({
      button: z.enum(['solid', 'soft', 'outline']),
      card: z.enum(['plain', 'outlined', 'elevated']),
      table: z.enum(['plain', 'striped', 'dense-grid']),
      input: z.enum(['outline', 'filled', 'underline']),
    }),
  })
  .openapi('BlueprintPreviewDesignSettings');

export const blueprintSessionDesignSettingsSchema = z
  .object({
    sessionId: z.string().uuid(),
    settings: blueprintPreviewDesignSettingsSchema.nullable(),
    createdAt: dateLikeSchema.optional(),
    updatedAt: dateLikeSchema.optional(),
  })
  .openapi('BlueprintSessionDesignSettings');

export const blueprintAdoptionRequestSchema = z
  .object({
    messageId: z.string().uuid(),
    adopted: z.boolean(),
  })
  .openapi('BlueprintAdoptionRequest');

export const blueprintAdoptionSchema = z
  .object({
    sessionId: z.string().uuid(),
    messageId: z.string().uuid(),
    adopted: z.boolean(),
    createdAt: dateLikeSchema.optional(),
    updatedAt: dateLikeSchema.optional(),
  })
  .openapi('BlueprintAdoption');
