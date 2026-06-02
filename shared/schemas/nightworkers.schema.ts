import { z } from '@hono/zod-openapi';

const runEventTypeSchema = z.enum([
  'run.created',
  'run.context_compiled',
  'run.runtime_started',
  'run.runtime_finished',
  'run.outcome_decided',
  'run.recovered',
  'turn.started',
  'turn.finished',
  'model.request_started',
  'model.response_delta',
  'model.response_finished',
  'supervisor.decision',
  'tool.call_started',
  'tool.call_progress',
  'tool.call_finished',
  'tool.policy_blocked',
  'verification.started',
  'verification.finished',
  'git.status_collected',
  'git.diff_collected',
  'safety.budget_reached',
  'safety.policy_violation',
  'safety.repeated_failure',
  'human.review_submitted',
  'system.warning',
  'system.error',
]);

const runEventSeveritySchema = z.enum(['debug', 'info', 'warning', 'error', 'checkpoint']);
const runEventActorSchema = z.enum([
  'system',
  'runtime',
  'supervisor',
  'worker',
  'tool',
  'verifier',
  'human',
]);

export const runEventSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid().optional(),
  runId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  seq: z.number().int().optional(),
  timestamp: z.string(),
  type: runEventTypeSchema,
  severity: runEventSeveritySchema,
  actor: runEventActorSchema,
  message: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const runEventJsonlLineSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('nightworkers_run'),
    version: z.literal(1),
    runId: z.string().uuid(),
    taskId: z.string().uuid(),
    repositoryId: z.string().uuid().nullable().optional(),
    createdAt: z.string(),
    cwd: z.string().nullable().optional(),
    workerKind: z.string().nullable().optional(),
    exportedAt: z.string(),
  }),
  z.object({
    type: z.literal('run_event'),
    version: z.literal(1),
    runId: z.string().uuid(),
    seq: z.number().int(),
    event: runEventSchema,
  }),
  z.object({
    type: z.literal('run_summary'),
    version: z.literal(1),
    runId: z.string().uuid(),
    status: z.string(),
    summary: z.string().nullable().optional(),
    finalReport: z.string().nullable().optional(),
    diffBytes: z.number().int(),
    eventCount: z.number().int(),
  }),
]);

export const safetyPolicySchema = z
  .object({
    allowedPaths: z.array(z.string()).optional(),
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
    safetyPolicy: safetyPolicySchema.nullable().optional(),
    createdAt: z.any(),
    updatedAt: z.any(),
  })
  .openapi('Repository');

export const createRepositorySchema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    localPath: z.string().min(1, 'Local path is required'),
    branch: z.string().default('main'),
    allowed: z.boolean().default(true),
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
    status: z.string(),
    compiledPrompt: z.string().nullable().optional(),
    timeoutSeconds: z.number(),
    priority: z.number(),
    createdBy: z.string().nullable().optional(),
    createdAt: z.any(),
    updatedAt: z.any(),
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
    contextSnapshot: z.any().nullable().optional(),
    summary: z.string().nullable().optional(),
    finalReport: z.string().nullable().optional(),
    startedAt: z.any(),
    endedAt: z.any().nullable().optional(),
    finishedAt: z.any().nullable().optional(),
    logContent: z.string().nullable().optional(),
    diffPatch: z.string().nullable().optional(),
    testResults: z.any().nullable().optional(),
    contextEval: z.any().nullable().optional(),
    createdAt: z.any(),
    updatedAt: z.any(),
  })
  .openapi('TaskRun');

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
