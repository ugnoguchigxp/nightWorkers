import { z } from '@hono/zod-openapi';

export const safetyPolicySchema = z
  .object({
    blockedCommands: z.array(z.string()).optional(),
    maxTimeSeconds: z.number().optional(),
  })
  .openapi('SafetyPolicy');

export const repositorySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    localPath: z.string(),
    branch: z.string(),
    safetyPolicy: safetyPolicySchema.nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Repository');

export const createRepositorySchema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    localPath: z.string().min(1, 'Local path is required'),
    branch: z.string().default('main'),
    safetyPolicy: safetyPolicySchema.optional(),
  })
  .openapi('CreateRepository');

export const taskSchema = z
  .object({
    id: z.string().uuid(),
    repositoryId: z.string().uuid(),
    title: z.string(),
    description: z.string().nullable().optional(),
    status: z.string(),
    compiledPrompt: z.string().nullable().optional(),
    timeoutSeconds: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Task');

export const createTaskSchema = z
  .object({
    repositoryId: z.string().uuid(),
    title: z.string().min(1, 'Title is required'),
    description: z.string().optional(),
    timeoutSeconds: z.number().default(3600),
  })
  .openapi('CreateTask');

export const taskRunSchema = z
  .object({
    id: z.string().uuid(),
    taskId: z.string().uuid(),
    status: z.string(),
    startedAt: z.string(),
    endedAt: z.string().nullable().optional(),
    logContent: z.string().nullable().optional(),
    diffPatch: z.string().nullable().optional(),
    testResults: z.any().nullable().optional(),
    contextEval: z.any().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('TaskRun');

export const taskEventSchema = z
  .object({
    id: z.string().uuid(),
    taskRunId: z.string().uuid(),
    type: z.string(),
    message: z.string(),
    timestamp: z.string(),
  })
  .openapi('TaskEvent');
