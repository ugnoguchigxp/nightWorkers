import { z } from '@hono/zod-openapi';
import { taskSchema } from './nightworkers.schema';

const dateLikeSchema = z.union([z.string(), z.date()]);

export const projectEvaluationDimensionKeySchema = z.enum([
  'conceptValue',
  'implementationCompleteness',
  'architectureQuality',
  'uiUx',
  'testability',
  'operability',
  'security',
  'maintainability',
  'extensibility',
  'marketCompetitiveness',
  'documentation',
  'agentUsability',
  'reliability',
]);
export type ProjectEvaluationDimensionKey = z.infer<typeof projectEvaluationDimensionKeySchema>;

export const fixedProjectEvaluationDimensions = [
  'conceptValue',
  'architectureQuality',
  'extensibility',
  'uiUx',
  'operability',
  'security',
  'maintainability',
  'marketCompetitiveness',
] as const satisfies ProjectEvaluationDimensionKey[];

export const defaultProjectEvaluationDimensions = fixedProjectEvaluationDimensions;

export const projectEvaluationDimensionLabels: Record<ProjectEvaluationDimensionKey, string> = {
  conceptValue: 'コンセプト価値',
  implementationCompleteness: '実装完成度',
  architectureQuality: 'アーキテクチャ',
  uiUx: 'UI / UX',
  testability: 'テスト容易性',
  operability: '運用性',
  security: 'セキュリティ',
  maintainability: '保守性',
  extensibility: '拡張性',
  marketCompetitiveness: '市場競争力',
  documentation: 'ドキュメント',
  agentUsability: 'Agent Usability',
  reliability: '信頼性',
};

export const projectEvaluationEvidenceLevelSchema = z.enum([
  'surface',
  'repo-structure',
  'code-sampled',
  'runtime-verified',
  'audit-grade',
]);
export type ProjectEvaluationEvidenceLevel = z.infer<typeof projectEvaluationEvidenceLevelSchema>;

export const projectEvaluationRunStatusSchema = z.enum(['running', 'completed', 'failed']);
export type ProjectEvaluationRunStatus = z.infer<typeof projectEvaluationRunStatusSchema>;

export const projectEvaluationDimensionScoreSchema = z
  .object({
    id: z.string().uuid().optional(),
    evaluationId: z.string().uuid().optional(),
    key: projectEvaluationDimensionKeySchema,
    label: z.string().min(1),
    score: z.number().min(0).max(100),
    confidence: z.number().min(0).max(1),
    rationale: z.string().min(1),
    evidence: z.array(z.string()).default([]),
    concerns: z.array(z.string()).default([]),
    delta: z.number().optional(),
  })
  .openapi('ProjectEvaluationDimensionScore');
export type ProjectEvaluationDimensionScore = z.infer<typeof projectEvaluationDimensionScoreSchema>;

export const projectEvaluationReportDimensionSchema = projectEvaluationDimensionScoreSchema.omit({
  id: true,
  evaluationId: true,
  delta: true,
});

const fixedProjectEvaluationDimensionSet = new Set<ProjectEvaluationDimensionKey>(
  fixedProjectEvaluationDimensions
);

function validateFixedProjectEvaluationDimensions(
  dimensions: Array<{ key: ProjectEvaluationDimensionKey }>,
  ctx: z.RefinementCtx
) {
  const seen = new Set<ProjectEvaluationDimensionKey>();
  for (let index = 0; index < dimensions.length; index += 1) {
    const dimension = dimensions[index];
    const expectedKey = fixedProjectEvaluationDimensions[index];
    if (dimension.key !== expectedKey) {
      ctx.addIssue({
        code: 'custom',
        path: ['dimensions', index, 'key'],
        message: expectedKey
          ? `Project Evaluation dimensions must use the fixed axis order: expected ${expectedKey}.`
          : 'Project Evaluation dimensions include an extra axis.',
      });
    }
    if (!fixedProjectEvaluationDimensionSet.has(dimension.key)) {
      ctx.addIssue({
        code: 'custom',
        path: ['dimensions', index, 'key'],
        message: `Project Evaluation dimensions must not include non-fixed axis: ${dimension.key}.`,
      });
    }
    if (seen.has(dimension.key)) {
      ctx.addIssue({
        code: 'custom',
        path: ['dimensions', index, 'key'],
        message: `Project Evaluation dimensions must not duplicate axis: ${dimension.key}.`,
      });
    }
    seen.add(dimension.key);
  }
}

export const projectEvaluationBundleSchema = z
  .object({
    schemaVersion: z.literal('nightworkers.project-evaluation-bundle/v1'),
    repository: z.object({
      id: z.string().uuid(),
      name: z.string(),
      localPath: z.string(),
      branch: z.string(),
    }),
    evidenceLevel: projectEvaluationEvidenceLevelSchema,
    inputs: z.object({
      readme: z.string().optional(),
      llmContext: z.string().optional(),
      agents: z.string().optional(),
      packageJson: z.unknown().optional(),
      repoTree: z.array(z.string()),
      scripts: z.record(z.string(), z.string()),
      recentTasks: z.array(z.string()),
      recentRuns: z.array(z.string()),
      previousEvaluation: z.unknown().optional(),
    }),
    missingInputs: z.array(z.string()),
    notVerified: z.array(z.string()),
    createdAt: z.string().datetime(),
  })
  .openapi('ProjectEvaluationBundle');
export type ProjectEvaluationBundle = z.infer<typeof projectEvaluationBundleSchema>;

export const projectEvaluationReportSchema = z
  .object({
    schemaVersion: z.literal('nightworkers.project-evaluation-report/v1'),
    overallScore: z.number().min(0).max(100),
    confidence: z.number().min(0).max(1),
    summary: z.string().min(1),
    dimensions: z
      .array(projectEvaluationReportDimensionSchema)
      .length(fixedProjectEvaluationDimensions.length),
    strengths: z.array(z.string()).default([]),
    weaknesses: z.array(z.string()).default([]),
    nextEvidenceToCollect: z.array(z.string()).default([]),
  })
  .superRefine((report, ctx) => validateFixedProjectEvaluationDimensions(report.dimensions, ctx))
  .openapi('ProjectEvaluationReport');
export type ProjectEvaluationReport = z.infer<typeof projectEvaluationReportSchema>;

export const focusedImprovementScoreImpactSchema = z.object({
  dimensionKey: projectEvaluationDimensionKeySchema,
  currentScore: z.number().int().min(0).max(100),
  expectedScoreGain: z.number().int().min(0).max(100),
  expectedScoreAfter: z.number().int().min(0).max(100),
  rationale: z.string().min(1),
});
export type ProjectImprovementScoreImpact = z.infer<typeof focusedImprovementScoreImpactSchema>;

export const projectImprovementIdeaSchema = z
  .object({
    id: z.string().uuid().optional(),
    evaluationId: z.string().uuid().optional(),
    title: z.string().min(1),
    summary: z.string().min(1),
    agentPrompt: z.string().min(1),
    expectedOutcome: z.string().min(1),
    implementationFocus: z.array(z.string().min(1)).min(1).max(6),
    targetDimensions: z.array(projectEvaluationDimensionKeySchema).min(1),
    scoreImpacts: z.array(focusedImprovementScoreImpactSchema).default([]),
    createdAt: dateLikeSchema.optional(),
  })
  .openapi('ProjectImprovementIdea');
export type ProjectImprovementIdea = z.infer<typeof projectImprovementIdeaSchema>;

export const projectImprovementIdeasResultSchema = z.object({
  schemaVersion: z.literal('nightworkers.project-improvement-ideas/v1'),
  ideas: z
    .array(
      projectImprovementIdeaSchema
        .omit({ id: true, evaluationId: true, createdAt: true })
        .extend({ scoreImpacts: z.array(focusedImprovementScoreImpactSchema).min(1) })
    )
    .min(1),
});

export const projectEvaluationActivityEventSchema = z
  .object({
    id: z.string().uuid(),
    evaluationId: z.string().uuid(),
    seq: z.number().int().nonnegative(),
    phase: z.string().min(1),
    level: z.enum(['debug', 'info', 'warning', 'error', 'checkpoint']),
    source: z.string().min(1),
    message: z.string().min(1),
    status: z.string().optional().nullable(),
    payload: z.unknown().optional(),
    createdAt: dateLikeSchema,
  })
  .openapi('ProjectEvaluationActivityEvent');
export type ProjectEvaluationActivityEvent = z.infer<typeof projectEvaluationActivityEventSchema>;

export const projectEvaluationRunSchema = z
  .object({
    id: z.string().uuid(),
    repositoryId: z.string().uuid(),
    status: projectEvaluationRunStatusSchema.default('completed'),
    bundle: projectEvaluationBundleSchema,
    rawOutput: z.unknown().nullable().optional(),
    summary: z.string(),
    overallScore: z.number().min(0).max(100),
    overallConfidence: z.number().min(0).max(1),
    evidenceLevel: projectEvaluationEvidenceLevelSchema,
    selectedModel: z.unknown().nullable().optional(),
    previousEvaluationId: z.string().uuid().nullable().optional(),
    dimensions: z.array(projectEvaluationDimensionScoreSchema),
    strengths: z.array(z.string()).default([]),
    weaknesses: z.array(z.string()).default([]),
    nextEvidenceToCollect: z.array(z.string()).default([]),
    createdAt: dateLikeSchema,
    updatedAt: dateLikeSchema,
  })
  .openapi('ProjectEvaluationRun');
export type ProjectEvaluationRun = z.infer<typeof projectEvaluationRunSchema>;

export const projectEvaluationTaskLinkSchema = z
  .object({
    id: z.string().uuid(),
    evaluationId: z.string().uuid(),
    ideaId: z.string().uuid(),
    taskId: z.string().uuid(),
    createdAt: dateLikeSchema,
    task: taskSchema.optional(),
  })
  .openapi('ProjectEvaluationTaskLink');
export type ProjectEvaluationTaskLink = z.infer<typeof projectEvaluationTaskLinkSchema>;

export const createProjectEvaluationRequestSchema = z.object({
  baselinePrompt: z.string().trim().min(1).optional(),
});
export type CreateProjectEvaluationRequest = z.infer<typeof createProjectEvaluationRequestSchema>;

export const generateProjectImprovementsRequestSchema = z.object({
  dimensionKeys: z.array(projectEvaluationDimensionKeySchema).min(1),
});
export type GenerateProjectImprovementsRequest = z.infer<
  typeof generateProjectImprovementsRequestSchema
>;

export const createTasksFromProjectImprovementsRequestSchema = z.object({
  ideaIds: z.array(z.string().uuid()).min(1),
  mode: z.enum(['draft', 'ready']).default('ready'),
});
export type CreateTasksFromProjectImprovementsRequest = z.infer<
  typeof createTasksFromProjectImprovementsRequestSchema
>;

export const projectEvaluationDetailSchema = z.object({
  evaluation: projectEvaluationRunSchema,
  improvements: z.array(projectImprovementIdeaSchema.required({ id: true, evaluationId: true })),
  activityEvents: z.array(projectEvaluationActivityEventSchema),
  taskLinks: z.array(projectEvaluationTaskLinkSchema),
});
export type ProjectEvaluationDetail = z.infer<typeof projectEvaluationDetailSchema>;

export const startProjectEvaluationResponseSchema = z.object({
  evaluationId: z.string().uuid(),
  detail: projectEvaluationDetailSchema,
});
export type StartProjectEvaluationResponse = z.infer<typeof startProjectEvaluationResponseSchema>;

export const projectEvaluationActivityReplaySchema = z.object({
  status: projectEvaluationRunStatusSchema,
  events: z.array(projectEvaluationActivityEventSchema),
});
export type ProjectEvaluationActivityReplay = z.infer<typeof projectEvaluationActivityReplaySchema>;
