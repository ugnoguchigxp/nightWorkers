import { z } from '@hono/zod-openapi';

export const taskEventSchema = z
  .object({
    id: z.string().uuid(),
    taskRunId: z.string().uuid(),
    seq: z.number(),
    actor: z.string(),
    eventType: z.string().nullable().optional(),
    type: z.string(),
    message: z.string(),
    payloadJson: z.any().nullable().optional(),
    timestamp: z.any(),
  })
  .openapi('TaskEvent');

export const artifactSchema = z
  .object({
    id: z.string().uuid(),
    runId: z.string().uuid(),
    kind: z.string(),
    path: z.string(),
    metadataJson: z.any().nullable().optional(),
    createdAt: z.any(),
  })
  .openapi('Artifact');

export const activityArtifactSchema = z
  .object({
    id: z.string().uuid(),
    taskId: z.string().uuid(),
    runId: z.string().uuid().nullable().optional(),
    kind: z.string(),
    path: z.string().nullable().optional(),
    contentText: z.string().nullable().optional(),
    metadataJson: z.any().nullable().optional(),
    createdAt: z.any(),
  })
  .openapi('ActivityArtifact');

export const activityEventSchema = z
  .object({
    id: z.string().uuid(),
    taskId: z.string().uuid(),
    runId: z.string().uuid().nullable().optional(),
    turnId: z.string().nullable().optional(),
    parentEventId: z.string().nullable().optional(),
    seq: z.number().int(),
    runSeq: z.number().int().nullable().optional(),
    kind: z.string(),
    source: z.string(),
    status: z.string().nullable().optional(),
    text: z.string().nullable().optional(),
    payloadJson: z.any().nullable().optional(),
    artifactId: z.string().uuid().nullable().optional(),
    clientTempId: z.string().nullable().optional(),
    externalId: z.string().nullable().optional(),
    dedupeKey: z.string().nullable().optional(),
    ingestError: z.string().nullable().optional(),
    visibility: z.string(),
    createdAt: z.any(),
  })
  .openapi('ActivityEvent');

export const activityReplaySchema = z
  .object({
    events: z.array(activityEventSchema),
    artifacts: z.array(activityArtifactSchema),
  })
  .openapi('ActivityReplay');

export const taskMessageSchema = z
  .object({
    id: z.string().uuid(),
    taskId: z.string().uuid(),
    runId: z.string().uuid().nullable().optional(),
    role: z.enum(['user', 'assistant', 'system', 'tool']),
    content: z.string(),
    messageType: z.string().nullable().optional(),
    metadataJson: z.any().nullable().optional(),
    createdAt: z.any(),
  })
  .openapi('TaskMessage');

export const taskLlmUsageSummarySchema = z
  .object({
    taskId: z.string().uuid(),
    promptInputTokens: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    stateCardTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    reasoningOutputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    usageMode: z.enum(['measured', 'estimated', 'mixed', 'unavailable']),
    callCount: z.number().int().nonnegative(),
    measuredCallCount: z.number().int().nonnegative(),
    estimatedCallCount: z.number().int().nonnegative(),
    lastUpdatedAt: z.string().nullable(),
  })
  .openapi('TaskLlmUsageSummary');
