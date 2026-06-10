import { z } from '@hono/zod-openapi';

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
  'hook_blocked',
  'verification_failed',
  'runner_crashed',
  'human_review',
]);

export const reviewActionSchema = z.enum(['complete', 'cancel']).openapi('ReviewAction');

export const reviewVerdictSchema = z
  .enum(['approved', 'changes_requested', 'cancelled'])
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
    createdAt: z.string(),
  })
  .openapi('ReviewResult');

export const rubricEvidenceSelectorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('run_event_type'), type: z.string().min(1) }),
  z.object({
    kind: z.literal('verification'),
    required: z.boolean().optional(),
    passed: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('diff'),
    required: z.boolean().optional(),
    maxBytes: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal('policy'),
    allowViolations: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('review_result'),
    required: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('review_followup'),
    requiredForBlocking: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('review_callout_separation'),
  }),
  z.object({
    kind: z.literal('final_report'),
    required: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('tool_failure'),
    maxConsecutive: z.number().int().positive().optional(),
  }),
]);

export const rubricCriterionSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    severity: z.enum(['info', 'warning', 'blocking']),
    evaluationMode: z.enum(['deterministic', 'llm']),
    evidenceSelectors: z.array(rubricEvidenceSelectorSchema).min(1),
    rule: z
      .object({
        required: z.boolean(),
        failWhenMissing: z.boolean().optional(),
        failWhenPresent: z.boolean().optional(),
      })
      .optional(),
    llmPrompt: z.string().optional(),
  })
  .strict()
  .openapi('RubricCriterion');

export const rubricDefinitionSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    scope: z
      .object({
        repositoryIds: z.array(z.string()).optional(),
        paths: z.array(z.string()).optional(),
        taskKinds: z.array(z.string()).optional(),
      })
      .strict(),
    criteria: z.array(rubricCriterionSchema).min(1),
    llm: z
      .object({
        enabledByDefault: z.boolean(),
        promptHints: z.array(z.string()).optional(),
        maxEvidenceChars: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .openapi('RubricDefinition');

export const reviewEvidencePackSchema = z
  .object({
    version: z.literal(1),
    runId: z.string(),
    taskId: z.string(),
    status: z.string(),
    outcome: z
      .object({
        status: z.string(),
        reason: z.string().optional(),
        summary: z.string().optional(),
      })
      .optional(),
    finalReport: z.string().optional(),
    diff: z.object({
      hasChanges: z.boolean(),
      bytes: z.number().int().nonnegative(),
      changedFiles: z.array(z.string()),
    }),
    verification: z.array(
      z.object({
        eventId: z.string().optional(),
        command: z.string().optional(),
        passed: z.boolean().optional(),
        summary: z.string().optional(),
      })
    ),
    policy: z.array(
      z.object({
        eventId: z.string().optional(),
        code: z.string().optional(),
        message: z.string(),
      })
    ),
    reviewResults: z.array(z.unknown()),
    selectedEvents: z.array(
      z.object({
        id: z.string().optional(),
        seq: z.number().int().optional(),
        type: z.string(),
        severity: z.string(),
        message: z.string(),
      })
    ),
    eventTypes: z.array(z.string()),
    diagnostics: z.array(z.string()),
  })
  .openapi('ReviewEvidencePack');

export const reviewerDraftSchema = z
  .object({
    version: z.literal(1),
    verdict: reviewVerdictSchema,
    summary: z.string(),
    findings: z.array(reviewFindingSchema),
    humanCallouts: z.array(reviewFindingSchema),
    agentFollowUps: z.array(z.string()),
    suggestedNextTasks: z.array(z.string()),
  })
  .strict()
  .openapi('ReviewerDraft');

export const reviewerEvaluationSchema = z
  .object({
    evaluationId: z.string().uuid(),
    rubricId: z.string(),
    status: z.enum(['completed', 'degraded', 'failed']),
    mode: z.enum(['deterministic_only', 'llm_assisted', 'replay']),
    deterministicVerdict: reviewVerdictSchema,
    llmVerdict: reviewVerdictSchema.optional(),
    finalReviewerVerdict: reviewVerdictSchema,
    reviewResult: reviewResultSchema,
    blockingFindingCount: z.number().int().nonnegative(),
    degradedReasons: z.array(z.string()),
    evidencePack: reviewEvidencePackSchema,
  })
  .openapi('ReviewerEvaluation');

export const createReviewerEvaluationRequestSchema = z
  .object({
    rubricId: z.string().default('basic-coding-run'),
    mode: z.enum(['deterministic_only', 'llm_assisted']).default('deterministic_only'),
    persist: z.boolean().default(true),
  })
  .openapi('CreateReviewerEvaluationRequest');

export const createReviewerReplayEvaluationRequestSchema = z
  .object({
    rubricId: z.string().default('basic-coding-run'),
    mode: z.enum(['deterministic_only', 'llm_assisted']).default('deterministic_only'),
    jsonl: z.string().optional(),
    parsedJsonl: z.unknown().optional(),
    replayResult: z.unknown().optional(),
  })
  .openapi('CreateReviewerReplayEvaluationRequest');
