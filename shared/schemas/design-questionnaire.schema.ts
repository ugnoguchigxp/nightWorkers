import { z } from '@hono/zod-openapi';

const kebabIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const questionnaireChoiceQuestionSchema = z.object({
  text: z.string().min(1),
  type: z.enum(['radio', 'checkbox']),
  options: z.array(z.string().min(1)).min(2).max(6),
});

export const questionnaireChoiceFormSchema = z.object({
  title: z.string().min(1).default('実装前に決めたいこと'),
  questions: z.array(questionnaireChoiceQuestionSchema).min(1).max(15),
});

export const designQuestionnaireFollowUpDecisionSchema = z
  .object({
    action: z.enum(['follow_up', 'ready_for_design_assembly']),
    rationale: z.string().min(1),
    questionnaire: questionnaireChoiceFormSchema.nullable().default(null),
  })
  .superRefine((decision, ctx) => {
    if (decision.action === 'follow_up' && !decision.questionnaire) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['questionnaire'],
        message: 'follow_up requires a questionnaire.',
      });
    }
    if (decision.action === 'ready_for_design_assembly' && decision.questionnaire) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['questionnaire'],
        message: 'ready_for_design_assembly must not include a questionnaire.',
      });
    }
  });

export const designQuestionOptionSchema = z.object({
  id: kebabIdSchema,
  label: z.string().min(1),
  tradeoff: z.string().min(1),
  recommended: z.boolean().optional(),
});

export const designQuestionDependencySchema = z.object({
  questionId: kebabIdSchema,
  operator: z.enum(['equals', 'not_equals', 'includes', 'excludes']),
  value: z.union([z.string(), z.boolean(), z.array(z.string())]),
});

export const designQuestionSchema = z
  .object({
    id: kebabIdSchema,
    topic: z.string().min(1),
    question: z.string().min(1),
    why: z.string().min(1),
    answerType: z.enum(['single_choice', 'multi_choice', 'boolean', 'free_text', 'ranked']),
    recommendedAnswerId: kebabIdSchema.optional(),
    options: z.array(designQuestionOptionSchema).optional(),
    allowsCustomAnswer: z.boolean().optional(),
    blocks: z.array(z.string().min(1)).min(1),
    outputSection: z.string().min(1),
    dependsOn: z.array(designQuestionDependencySchema).optional(),
  })
  .superRefine((question, ctx) => {
    if (
      ['single_choice', 'multi_choice', 'ranked'].includes(question.answerType) &&
      (!question.options || question.options.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'Choice-based questions require options.',
      });
    }
  });

export const designQuestionSetSchema = z.object({
  id: kebabIdSchema,
  title: z.string().min(1),
  category: z.string().min(1),
  purpose: z.string().min(1),
  questions: z.array(designQuestionSchema).min(1),
});

export const designOpenQuestionSchema = z.object({
  id: kebabIdSchema,
  topic: z.string().min(1),
  reason: z.string().min(1),
  blocks: z.array(z.string().min(1)).min(1),
  suggestedOwner: z.enum(['user', 'designer', 'engineer', 'db-design', 'later']).optional(),
});

export const dbDesignHandoffNoteSchema = z.object({
  id: kebabIdSchema,
  summary: z.string().min(1),
  sourceQuestionIds: z.array(kebabIdSchema),
  constraint: z.string().min(1),
});

export const designQuestionnaireSchema = z.object({
  version: z.literal(1),
  source: z.object({
    taskId: z.string().uuid(),
    repositoryId: z.string().uuid(),
    blueprintMessageId: z.string().uuid().nullable().optional(),
    promptMessageId: z.string().uuid().nullable().optional(),
    sourceKind: z.enum(['blueprint', 'plan_mode_intake']).optional(),
    blueprintVersion: z.number().int().positive().optional(),
  }),
  title: z.string().min(1),
  summary: z.string().min(1),
  questionSets: z.array(designQuestionSetSchema).min(1),
  openQuestions: z.array(designOpenQuestionSchema).default([]),
  dbDesignHandoffNotes: z.array(dbDesignHandoffNoteSchema).default([]),
});

export const designQuestionnaireAnswerSchema = z.object({
  questionId: kebabIdSchema,
  selectedOptionIds: z.array(kebabIdSchema).default([]),
  booleanValue: z.boolean().optional(),
  freeText: z.string().optional(),
  rankedOptionIds: z.array(kebabIdSchema).default([]),
  deferred: z.boolean().default(false),
});

export const saveDesignQuestionnaireAnswersSchema = z.object({
  answers: z.array(designQuestionnaireAnswerSchema).min(1),
});

export const designDecisionDraftSchema = z.object({
  id: kebabIdSchema,
  outputSection: z.string().min(1),
  decision: z.string().min(1),
  rationale: z.string().min(1),
  alternativesConsidered: z.array(z.string()).default([]),
  tradeoffs: z.array(z.string()).default([]),
  sourceQuestionIds: z.array(kebabIdSchema),
  unresolvedQuestionIds: z.array(kebabIdSchema).default([]),
});

export const designDecisionReviewSchema = z.object({
  version: z.literal(1),
  sessionId: z.string().uuid(),
  sourceBlueprintMessageId: z.string().uuid().nullable(),
  title: z.string().min(1),
  summary: z.string().min(1),
  decisions: z.array(designDecisionDraftSchema).default([]),
  deferredItems: z.array(designOpenQuestionSchema).default([]),
  unresolvedQuestions: z.array(designOpenQuestionSchema).default([]),
  dbDesignHandoffNotes: z.array(dbDesignHandoffNoteSchema).default([]),
});

export const createDesignQuestionnaireRequestSchema = z.object({
  sourceBlueprintMessageId: z.string().uuid().nullable().optional(),
});

export const designQuestionnaireSessionStatusSchema = z.enum([
  'draft',
  'answering',
  'review_ready',
  'accepted',
  'needs_edit',
  'abandoned',
]);

export const designQuestionnaireSessionSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  repositoryId: z.string().uuid(),
  sourceBlueprintMessageId: z.string().uuid().nullable(),
  status: designQuestionnaireSessionStatusSchema,
  createdAt: z.any(),
  updatedAt: z.any(),
  questionSets: z.array(
    z.object({
      id: z.string().uuid(),
      sequence: z.number().int().positive(),
      questionnaire: designQuestionnaireSchema.nullable(),
      rawOutput: z.string().nullable(),
      validationStatus: z.enum(['valid', 'invalid']),
      createdAt: z.any(),
    })
  ),
  answers: z.array(
    z.object({
      id: z.string().uuid(),
      questionId: kebabIdSchema,
      answer: designQuestionnaireAnswerSchema,
      answeredAt: z.any(),
    })
  ),
  reviews: z.array(
    z.object({
      id: z.string().uuid(),
      review: designDecisionReviewSchema.nullable(),
      publishedMessageId: z.string().uuid().nullable().optional(),
      status: z.enum(['draft', 'accepted', 'needs_edit', 'left_unadopted']),
      createdAt: z.any(),
      updatedAt: z.any(),
    })
  ),
});

export const blueprintWorkspaceArtifactSchema = z.object({
  id: z.string(),
  kind: z.enum(['blueprint', 'db-design', 'decision-review']),
  title: z.string(),
  sourceMessageId: z.string().uuid(),
  createdAt: z.any(),
  adoptionState: z.enum(['adopted', 'not_adopted', 'unknown']).optional(),
  sourceBlueprintMessageId: z.string().uuid().optional(),
});

export const blueprintWorkspaceQuestionnaireSchema = z.object({
  id: z.string().uuid(),
  sourceBlueprintMessageId: z.string().uuid().nullable(),
  status: designQuestionnaireSessionStatusSchema,
  answeredCount: z.number().int().nonnegative(),
  totalQuestionCount: z.number().int().nonnegative(),
  latestReviewId: z.string().uuid().optional(),
});

export const blueprintWorkspaceReferenceSchema = z.object({
  id: z.string(),
  kind: z.enum(['implementation-plan', 'queue-candidate']),
  title: z.string(),
  sourceMessageId: z.string().uuid().optional(),
  taskId: z.string().uuid(),
});

export const blueprintSpecificationWorkspaceSchema = z.object({
  taskId: z.string().uuid(),
  repositoryId: z.string().uuid(),
  generatedAt: z.string(),
  blueprintArtifacts: z.array(blueprintWorkspaceArtifactSchema),
  dbDesignArtifacts: z.array(blueprintWorkspaceArtifactSchema),
  questionnaireSessions: z.array(blueprintWorkspaceQuestionnaireSchema),
  decisionReviews: z.array(blueprintWorkspaceArtifactSchema),
  implementationReferences: z.array(blueprintWorkspaceReferenceSchema),
});

export type DesignQuestionnaire = z.infer<typeof designQuestionnaireSchema>;
export type QuestionnaireChoiceForm = z.infer<typeof questionnaireChoiceFormSchema>;
export type DesignQuestionnaireFollowUpDecision = z.infer<
  typeof designQuestionnaireFollowUpDecisionSchema
>;
export type DesignQuestionnaireAnswer = z.infer<typeof designQuestionnaireAnswerSchema>;
export type DesignDecisionReview = z.infer<typeof designDecisionReviewSchema>;
export type DesignQuestionnaireSession = z.infer<typeof designQuestionnaireSessionSchema>;
export type BlueprintSpecificationWorkspace = z.infer<typeof blueprintSpecificationWorkspaceSchema>;
