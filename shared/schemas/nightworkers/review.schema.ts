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

export const reviewRecommendationLevelSchema = z
  .enum(['none', 'optional', 'recommended', 'required'])
  .openapi('ReviewRecommendationLevel');

export const reviewRecommendationReasonCodeSchema = z
  .enum([
    'minor_no_review_needed',
    'large_diff',
    'many_changed_files',
    'todo_unresolved',
    'security_sensitive_change',
    'security_plugin_missing',
    'schema_or_migration_change',
    'public_contract_change',
  ])
  .openapi('ReviewRecommendationReasonCode');

export const reviewRecommendationReasonSchema = z
  .object({
    code: reviewRecommendationReasonCodeSchema,
    severity: z.enum(['info', 'warning', 'blocking']),
    label: z.string(),
    evidenceRefs: z.array(reviewEvidenceRefSchema),
  })
  .openapi('ReviewRecommendationReason');

export const reviewRecommendationSchema = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    runId: z.string().uuid(),
    taskId: z.string().uuid(),
    repositoryId: z.string().uuid(),
    level: reviewRecommendationLevelSchema,
    defaultAction: z.enum(['skip', 'offer_review', 'require_review']),
    reasons: z.array(reviewRecommendationReasonSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ReviewRecommendation');

export const reviewSectionKindSchema = z
  .enum([
    'test_coverage',
    'security_review',
    'findings',
    'prompt_suggestions',
  ])
  .openapi('ReviewSectionKind');

export const reviewArtifactKindSchema = z
  .union([z.literal('review_status'), reviewSectionKindSchema, z.literal('security_handoff')])
  .openapi('ReviewArtifactKind');

export const reviewSectionRequirementSchema = z
  .enum(['required', 'recommended', 'optional', 'omitted'])
  .openapi('ReviewSectionRequirement');

export const reviewSectionProgressSchema = z
  .enum(['not_started', 'running', 'done', 'blocked', 'needs_human'])
  .openapi('ReviewSectionProgress');

export const reviewFindingDispositionSchema = z
  .enum([
    'human_callout',
    'agent_followup',
    'prompt_suggestion',
    'security_plugin_handoff',
    'accepted_risk',
    'ignored',
  ])
  .openapi('ReviewFindingDisposition');

export const reviewFindingDispositionStatusSchema = z
  .enum(['unresolved', 'accepted', 'converted', 'dismissed'])
  .openapi('ReviewFindingDispositionStatus');

export const reviewSessionStatusSchema = z
  .enum(['not_started', 'in_progress', 'approved', 'changes_requested', 'needs_human', 'cancelled'])
  .openapi('ReviewSessionStatus');

export const reviewStatusArtifactSchema = z
  .object({
    version: z.literal(1),
    reviewSessionId: z.string().uuid(),
    runId: z.string().uuid(),
    taskId: z.string().uuid(),
    recommendation: reviewRecommendationSchema,
    sections: z.array(
      z.object({
        kind: reviewSectionKindSchema,
        requirement: reviewSectionRequirementSchema,
        progress: reviewSectionProgressSchema,
        reason: z.string(),
        artifactId: z.string().uuid().nullable(),
        findingCounts: z.object({
          blocking: z.number().int().nonnegative(),
          warning: z.number().int().nonnegative(),
          info: z.number().int().nonnegative(),
        }),
      })
    ),
    finalActionGate: z.object({
      canApprove: z.boolean(),
      blockingReason: z.string().nullable(),
      unresolvedBlockingFindingIds: z.array(z.string().uuid()),
      requiredSectionKindsRemaining: z.array(reviewSectionKindSchema),
    }),
    promptSuggestionCount: z.number().int().nonnegative(),
    securityHandoffCount: z.number().int().nonnegative().optional(),
  })
  .openapi('ReviewStatusArtifact');

export const reviewSessionSchema = z
  .object({
    id: z.string().uuid(),
    runId: z.string().uuid(),
    taskId: z.string().uuid(),
    repositoryId: z.string().uuid(),
    status: reviewSessionStatusSchema,
    recommendationId: z.string().uuid().nullable(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    finalAction: z.string().nullable(),
    finalNote: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ReviewSession');

export const reviewArtifactSchema = z
  .object({
    id: z.string().uuid(),
    reviewSessionId: z.string().uuid(),
    runId: z.string().uuid(),
    taskId: z.string().uuid(),
    kind: reviewArtifactKindSchema,
    status: reviewSectionProgressSchema,
    artifact: z.unknown(),
    sourceEvidenceRefs: z.array(reviewEvidenceRefSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ReviewArtifact');

export const reviewModeFindingSchema = z
  .object({
    id: z.string().uuid(),
    reviewSessionId: z.string().uuid(),
    runId: z.string().uuid(),
    taskId: z.string().uuid(),
    severity: z.enum(['info', 'warning', 'blocking']),
    title: z.string(),
    body: z.string().nullable(),
    disposition: reviewFindingDispositionSchema.nullable(),
    dispositionStatus: reviewFindingDispositionStatusSchema,
    dispositionNote: z.string().nullable(),
    evidenceRefs: z.array(reviewEvidenceRefSchema),
    createdGoalId: z.string().uuid().nullable(),
    createdTaskProposalId: z.string().uuid().nullable(),
    contextStillCandidateId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ReviewModeFinding');

export const reviewPromptSuggestionStatusSchema = z
  .enum(['draft', 'used', 'dismissed'])
  .openapi('ReviewPromptSuggestionStatus');

export const reviewPromptSuggestionSchema = z
  .object({
    id: z.string().uuid(),
    reviewSessionId: z.string().uuid(),
    findingId: z.string().uuid(),
    runId: z.string().uuid(),
    taskId: z.string().uuid(),
    repositoryId: z.string().uuid(),
    title: z.string(),
    prompt: z.string(),
    expectedOutcome: z.string(),
    acceptanceCriteria: z.string(),
    verificationHint: z.string(),
    evidenceRefs: z.array(reviewEvidenceRefSchema),
    status: reviewPromptSuggestionStatusSchema,
    useCount: z.number().int().nonnegative(),
    lastUsedAt: z.string().nullable(),
    dismissedAt: z.string().nullable(),
    createdMessageId: z.string().uuid().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ReviewPromptSuggestion');

export const reviewSecurityHandoffStatusSchema = z
  .enum(['needs_configuration', 'requested', 'deferred'])
  .openapi('ReviewSecurityHandoffStatus');

export const reviewSecurityHandoffSchema = z
  .object({
    id: z.string().uuid(),
    reviewSessionId: z.string().uuid(),
    findingId: z.string().uuid(),
    runId: z.string().uuid(),
    taskId: z.string().uuid(),
    repositoryId: z.string().uuid(),
    title: z.string(),
    summary: z.string(),
    requestedIntegration: z.string().nullable(),
    status: reviewSecurityHandoffStatusSchema,
    changedPaths: z.array(z.string()),
    evidenceRefs: z.array(reviewEvidenceRefSchema),
    handoffArtifact: z.unknown().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ReviewSecurityHandoff');

export const reviewSessionDetailSchema = z
  .object({
    session: reviewSessionSchema,
    recommendation: reviewRecommendationSchema,
    statusArtifact: reviewStatusArtifactSchema,
    artifacts: z.array(reviewArtifactSchema),
    findings: z.array(reviewModeFindingSchema),
    promptSuggestions: z.array(reviewPromptSuggestionSchema),
    securityHandoffs: z.array(reviewSecurityHandoffSchema),
  })
  .openapi('ReviewSessionDetail');

export const reviewSectionRunRequestSchema = z
  .object({
    section: reviewSectionKindSchema.optional(),
  })
  .openapi('ReviewSectionRunRequest');

export const reviewFindingDispositionRequestSchema = z
  .object({
    disposition: reviewFindingDispositionSchema,
    note: z.string().optional(),
    evidenceRefs: z.array(reviewEvidenceRefSchema).optional(),
  })
  .openapi('ReviewFindingDispositionRequest');

export const reviewPromptSuggestionUpdateRequestSchema = z
  .object({
    status: z.enum(['dismissed']),
  })
  .openapi('ReviewPromptSuggestionUpdateRequest');

export const reviewPromptSuggestionUseRequestSchema = z
  .object({
    createdMessageId: z.string().uuid().optional(),
  })
  .openapi('ReviewPromptSuggestionUseRequest');

export const reviewFinalActionRequestSchema = z
  .object({
    action: z.enum(['approve', 'request_changes', 'needs_human', 'exit_review']),
    note: z.string().optional(),
  })
  .openapi('ReviewFinalActionRequest');
