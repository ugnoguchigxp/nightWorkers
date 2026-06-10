import { z } from '@hono/zod-openapi';

const jsonValueSchema = z.unknown();
const dateLikeSchema = z.union([z.string(), z.date()]);

export const taskRunSchema = z
  .object({
    id: z.string().uuid(),
    taskId: z.string().uuid(),
    repositoryId: z.string().uuid().nullable().optional(),
    status: z.string(),
    workerKind: z.string(),
    baseRef: z.string().nullable().optional(),
    worktreePath: z.string().nullable().optional(),
    timeoutSeconds: z.number(),
    contextSnapshot: jsonValueSchema.nullable().optional(),
    summary: z.string().nullable().optional(),
    finalReport: z.string().nullable().optional(),
    finalJudgment: jsonValueSchema.nullable().optional(),
    startedAt: dateLikeSchema,
    endedAt: dateLikeSchema.nullable().optional(),
    finishedAt: dateLikeSchema.nullable().optional(),
    logContent: z.string().nullable().optional(),
    diffPatch: z.string().nullable().optional(),
    testResults: jsonValueSchema.nullable().optional(),
    createdAt: dateLikeSchema,
    updatedAt: dateLikeSchema,
  })
  .openapi('TaskRun');

export const taskTypeSchema = z.enum([
  'code_change',
  'test_change',
  'documentation',
  'review',
  'investigation',
  'verification',
]);

export const todoStatusSchema = z.enum([
  'pending',
  'running',
  'passed',
  'failed',
  'skipped',
  'needs_human',
]);

export const taskRunTodoSchema = z
  .object({
    id: z.string().uuid(),
    runId: z.string().uuid(),
    seq: z.number().int(),
    title: z.string(),
    description: z.string().nullable().optional(),
    taskType: taskTypeSchema,
    status: todoStatusSchema,
    procedureId: z.string().nullable().optional(),
    procedureSnapshot: jsonValueSchema.nullable().optional(),
    contextSnapshot: jsonValueSchema.nullable().optional(),
    completionGateResult: jsonValueSchema.nullable().optional(),
    dependsOn: z
      .array(z.union([z.string(), z.number()]))
      .nullable()
      .optional(),
    statusReason: z.string().nullable().optional(),
    startedAt: dateLikeSchema.nullable().optional(),
    completedAt: dateLikeSchema.nullable().optional(),
    createdAt: dateLikeSchema,
    updatedAt: dateLikeSchema,
  })
  .openapi('TaskRunTodo');

export const runtimePromptSnapshotSchema = z
  .object({
    compiledPrompt: z.string(),
    source: z.enum(['task_prompt', 'fallback']),
    degraded: z.boolean(),
    degradedReason: z.string().optional(),
    request: z.object({
      repositoryPath: z.string(),
      taskTitle: z.string(),
      taskDescriptionDigest: z.string(),
    }),
    result: z.object({
      digest: z.string(),
      charCount: z.number().int().nonnegative(),
    }),
  })
  .openapi('RuntimePromptSnapshot');
