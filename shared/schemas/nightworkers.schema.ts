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
    reviewResult: z.any().optional(),
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

const reviewOutcomeStatusSchema = z.enum([
  'needs_review',
  'completed',
  'needs_human',
  'failed',
  'blocked',
  'timed_out',
  'cancelled',
]);

const reviewOutcomeReasonSchema = z.enum([
  'supervisor_completed',
  'supervisor_needs_human',
  'budget_exceeded',
  'tool_failure_limit',
  'policy_violation',
  'verification_failed',
  'runner_crashed',
  'human_review',
]);

export const reviewActionSchema = z
  .enum(['complete', 'request_follow_up', 'cancel', 'accept_risk'])
  .openapi('ReviewAction');

export const reviewVerdictSchema = z
  .enum(['approved', 'changes_requested', 'cancelled', 'risk_accepted'])
  .openapi('ReviewVerdict');

export const reviewEvidenceRefSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('run_event'),
      eventId: z.string().uuid(),
      seq: z.number().int().optional(),
      eventType: z.string().optional(),
    }),
    z.object({
      kind: z.literal('diff'),
      runId: z.string().uuid(),
      bytes: z.number().int().optional(),
      hasChanges: z.boolean().optional(),
    }),
    z.object({
      kind: z.literal('final_report'),
      runId: z.string().uuid(),
    }),
    z.object({
      kind: z.literal('verification'),
      eventId: z.string().uuid().optional(),
      passed: z.boolean().optional(),
      command: z.string().optional(),
    }),
    z.object({
      kind: z.literal('policy'),
      eventId: z.string().uuid().optional(),
      code: z.string().optional(),
      message: z.string().optional(),
    }),
    z.object({
      kind: z.literal('artifact'),
      artifactId: z.string(),
      artifactKind: z.string().optional(),
    }),
    z.object({
      kind: z.literal('changed_file'),
      path: z.string(),
      added: z.number().int().optional(),
      deleted: z.number().int().optional(),
    }),
  ])
  .openapi('ReviewEvidenceRef');

export const reviewFindingSchema = z
  .object({
    severity: z.enum(['info', 'warning', 'blocking']),
    title: z.string(),
    body: z.string().optional(),
    filePath: z.string().optional(),
    line: z.number().int().optional(),
    evidenceRefs: z.array(reviewEvidenceRefSchema).optional(),
  })
  .openapi('ReviewFinding');

export const reviewResultSchema = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    runId: z.string().uuid(),
    taskId: z.string().uuid(),
    reviewer: z
      .object({
        type: z.enum(['human', 'system', 'agent']),
        id: z.string().optional(),
        label: z.string().optional(),
      })
      .openapi('ReviewReviewer'),
    action: reviewActionSchema,
    verdict: reviewVerdictSchema,
    note: z.string().optional(),
    statusBefore: z.string(),
    statusAfter: z.string(),
    outcome: z
      .object({
        status: reviewOutcomeStatusSchema,
        reason: reviewOutcomeReasonSchema,
        summary: z.string(),
      })
      .openapi('ReviewOutcome'),
    evidenceRefs: z.array(reviewEvidenceRefSchema),
    findings: z.array(reviewFindingSchema),
    humanCallouts: z.array(reviewFindingSchema),
    agentFollowUps: z.array(z.string()),
    suggestedNextTasks: z.array(z.string()),
    riskAcceptance: z
      .object({
        acceptedRisk: z.string(),
        reason: z.string().optional(),
        evidenceRefs: z.array(reviewEvidenceRefSchema).optional(),
      })
      .optional(),
    createdAt: z.string(),
  })
  .openapi('ReviewResult');

export const reviewRunRequestSchema = z
  .object({
    action: reviewActionSchema,
    note: z.string().optional(),
    evidenceRefs: z.array(reviewEvidenceRefSchema).optional(),
    findings: z.array(reviewFindingSchema).optional(),
    humanCallouts: z.array(reviewFindingSchema).optional(),
    agentFollowUps: z.array(z.string()).optional(),
    suggestedNextTasks: z.array(z.string()).optional(),
    riskAcceptance: z
      .object({
        acceptedRisk: z.string(),
        reason: z.string().optional(),
        evidenceRefs: z.array(reviewEvidenceRefSchema).optional(),
      })
      .optional(),
  })
  .openapi('ReviewRunRequest');

export const reviewRunResponseSchema = z
  .object({
    ok: z.boolean(),
    status: z.string(),
    outcome: z
      .object({
        status: reviewOutcomeStatusSchema,
        reason: reviewOutcomeReasonSchema,
        summary: z.string(),
      })
      .openapi('ReviewOutcome'),
    reviewResult: reviewResultSchema,
  })
  .openapi('ReviewRunResponse');

export const taskRunDetailSchema = taskRunSchema.extend({
  events: z.array(z.lazy(() => taskEventSchema)),
  reviews: z.array(z.lazy(() => reviewResultSchema)),
});

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
