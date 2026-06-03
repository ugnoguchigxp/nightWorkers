import { z } from '@hono/zod-openapi';

const runEventTypeSchema = z.enum([
  'run.created',
  'run.context_compiled',
  'run.runtime_started',
  'run.runtime_finished',
  'run.outcome_decided',
  'run.finalizing_started',
  'run.final_judgment_created',
  'run.recovered',
  'turn.started',
  'turn.finished',
  'model.request_started',
  'model.retry_scheduled',
  'model.retry_started',
  'model.response_delta',
  'model.response_finished',
  'model.response_repaired',
  'model.response_parse_failed',
  'supervisor.decision',
  'tool.call_started',
  'tool.call_progress',
  'tool.call_finished',
  'tool.policy_blocked',
  'hook.started',
  'hook.finished',
  'hook.blocked',
  'hook.failed',
  'verification.started',
  'verification.finished',
  'git.status_collected',
  'git.diff_collected',
  'safety.budget_reached',
  'safety.policy_violation',
  'safety.repeated_failure',
  'human.review_submitted',
  'review.rubric_loaded',
  'review.evaluation_started',
  'review.llm_started',
  'review.llm_finished',
  'review.evaluation_finished',
  'memory.candidate_generated',
  'memory.candidate_approved',
  'memory.register_started',
  'memory.register_finished',
  'memory.context_injected',
  'memory.feedback_evaluated',
  'workbench.session.created',
  'workbench.session.queued',
  'workbench.session.run_requested',
  'workbench.artifact.created',
  'workbench.review.followup_requested',
  'workbench.learning.capture_requested',
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
    finalJudgment: z.any().nullable().optional(),
    todos: z
      .array(
        z.object({
          id: z.string().uuid(),
          seq: z.number().int(),
          title: z.string(),
          taskType: z.string(),
          status: z.string(),
          procedureId: z.string().nullable().optional(),
          statusReason: z.string().nullable().optional(),
          completionGateResult: z.any().nullable().optional(),
        })
      )
      .optional(),
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
    queueEnabled: z.boolean().default(false),
    maxConcurrentSessions: z.number().int().positive().default(1),
    safetyPolicy: safetyPolicySchema.nullable().optional(),
    createdAt: z.any(),
    updatedAt: z.any(),
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
    createdAt: z.any().optional(),
    updatedAt: z.any().optional(),
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
    createdAt: z.any().optional(),
    updatedAt: z.any().optional(),
  })
  .openapi('BlueprintAdoption');

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
    finalJudgment: z.any().nullable().optional(),
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
    procedureSnapshot: z.any().nullable().optional(),
    contextSnapshot: z.any().nullable().optional(),
    completionGateResult: z.any().nullable().optional(),
    dependsOn: z
      .array(z.union([z.string(), z.number()]))
      .nullable()
      .optional(),
    statusReason: z.string().nullable().optional(),
    startedAt: z.any().nullable().optional(),
    completedAt: z.any().nullable().optional(),
    createdAt: z.any(),
    updatedAt: z.any(),
  })
  .openapi('TaskRunTodo');

export const includedMemoryRefSchema = z
  .object({
    kind: z.enum(['candidate', 'memory', 'procedure', 'unknown']),
    sourceRunId: z.string().uuid().optional(),
    candidateId: z.string().uuid().optional(),
    externalId: z.string().optional(),
    title: z.string().optional(),
    confidence: z.enum(['low', 'medium', 'high']).optional(),
  })
  .openapi('IncludedMemoryRef');

export const learningCandidateSchema = z
  .object({
    id: z.string().uuid(),
    version: z.literal(1),
    sourceRunId: z.string().uuid(),
    sourceTaskId: z.string().uuid(),
    sourceEventIds: z.array(z.string()).min(1),
    kind: z.enum(['rule', 'procedure', 'warning', 'verification']),
    title: z.string().min(1),
    body: z.string().min(1),
    appliesTo: z.object({
      repositoryId: z.string().uuid().optional(),
      repoPath: z.string().optional(),
      domains: z.array(z.string()).optional(),
      technologies: z.array(z.string()).optional(),
      changeTypes: z.array(z.string()).optional(),
    }),
    confidence: z.enum(['low', 'medium', 'high']),
    status: z.enum(['draft', 'approved', 'rejected', 'registered', 'failed']),
    createdAt: z.string(),
    approvedAt: z.string().optional(),
    registeredAt: z.string().optional(),
    externalRef: z
      .object({
        target: z.literal('context-still'),
        id: z.string().optional(),
      })
      .optional(),
  })
  .openapi('LearningCandidate');

export const contextCompileSnapshotSchema = z
  .object({
    compiledPrompt: z.string(),
    source: z.enum(['context-still', 'fallback']),
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
      sourceMetadata: z.unknown().optional(),
      includedMemoryRefs: z.array(includedMemoryRefSchema),
    }),
  })
  .openapi('ContextCompileSnapshot');

export const memoryFeedbackEvaluationSchema = z
  .object({
    baselineRunId: z.string().uuid(),
    followupRunId: z.string().uuid(),
    candidateIds: z.array(z.string().uuid()),
    verdict: z.enum(['effective', 'ineffective', 'inconclusive', 'not_injected']),
    reasons: z.array(z.string()).min(1),
    evidenceEventIds: z.array(z.string()),
  })
  .openapi('MemoryFeedbackEvaluation');

export const memoryRunEventDataSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('memory.candidate_generated'),
    candidateId: z.string().uuid(),
    sourceRunId: z.string().uuid(),
    sourceEventIds: z.array(z.string()),
    kind: z.enum(['rule', 'procedure', 'warning', 'verification']),
    title: z.string(),
    confidence: z.enum(['low', 'medium', 'high']),
    requiresHumanApproval: z.literal(true),
    status: z.literal('draft'),
  }),
  z.object({
    type: z.literal('memory.candidate_approved'),
    candidateId: z.string().uuid(),
    sourceRunId: z.string().uuid(),
    approvedBy: z.literal('human'),
    approvalNote: z.string().optional(),
    approvedAt: z.string(),
  }),
  z.object({
    type: z.literal('memory.register_started'),
    candidateId: z.string().uuid(),
    sourceRunId: z.string().uuid(),
    target: z.literal('context-still'),
    tool: z.literal('register_candidate'),
  }),
  z.object({
    type: z.literal('memory.register_finished'),
    candidateId: z.string().uuid(),
    sourceRunId: z.string().uuid(),
    target: z.literal('context-still'),
    status: z.enum(['registered', 'degraded', 'failed']),
    externalId: z.string().optional(),
    errorCode: z.string().optional(),
    errorMessage: z.string().optional(),
  }),
  z.object({
    type: z.literal('memory.context_injected'),
    runId: z.string().uuid(),
    source: z.enum(['context-still', 'fallback']),
    degraded: z.boolean(),
    compiledContextDigest: z.string(),
    includedSourceRefs: z.array(includedMemoryRefSchema),
    charCount: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('memory.feedback_evaluated'),
    baselineRunId: z.string().uuid(),
    followupRunId: z.string().uuid(),
    candidateIds: z.array(z.string().uuid()),
    verdict: z.enum(['effective', 'ineffective', 'inconclusive', 'not_injected']),
    reasons: z.array(z.string()),
    evidenceEventIds: z.array(z.string()),
  }),
]);

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
    parsedJsonl: z.any().optional(),
    replayResult: z.any().optional(),
  })
  .openapi('CreateReviewerReplayEvaluationRequest');

export const taskRunDetailSchema = taskRunSchema.extend({
  todos: z.array(z.lazy(() => taskRunTodoSchema)),
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
