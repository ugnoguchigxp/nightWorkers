import { z } from '@hono/zod-openapi';
import { taskSchema } from './nightworkers.schema';

const dateLikeSchema = z.union([z.string(), z.date()]);

export const missionStatusSchema = z.enum([
  'draft',
  'decomposing',
  'evaluating',
  'needs_clarification',
  'review_pending',
  'active',
  'blocked',
  'completed',
  'cancelled',
]);
export type MissionStatus = z.infer<typeof missionStatusSchema>;

export const missionPlanningResultStatusSchema = z.enum([
  'draft',
  'evaluating',
  'needs_revision',
  'needs_clarification',
  'blocked',
  'review_pending',
  'dismissed',
  'archived',
]);
export type MissionPlanningResultStatus = z.infer<typeof missionPlanningResultStatusSchema>;

export const missionTaskProposalStatusSchema = z.enum(['proposed', 'task_created', 'dismissed']);
export type MissionTaskProposalStatus = z.infer<typeof missionTaskProposalStatusSchema>;

export const missionRiskSchema = z.enum(['low', 'medium', 'high']);
export type MissionRisk = z.infer<typeof missionRiskSchema>;

export const missionSchedulingSchema = z
  .object({
    executionType: z.enum(['normal', 'exclusive', 'sequence']),
    reason: z.string().min(1),
    sequenceGroupId: z.string().min(1).nullable(),
    sequenceOrder: z.number().int().nonnegative().nullable(),
    dependsOnTaskIds: z.array(z.string()).default([]),
  })
  .openapi('MissionScheduling');
export type MissionScheduling = z.infer<typeof missionSchedulingSchema>;

export const missionDecompositionPlanningResultSchema = z
  .object({
    schemaVersion: z.literal('nightworkers.mission-decomposition-result/v1'),
    mission: z.object({
      title: z.string().min(1),
      goal: z.string().min(1),
      nonGoals: z.array(z.string()).default([]),
    }),
    objectives: z
      .array(
        z.object({
          id: z.string().min(1),
          title: z.string().min(1),
          completionCriteria: z.array(z.string().min(1)).min(1),
          verificationGate: z.array(z.string().min(1)).default([]),
        })
      )
      .min(1),
    workPackages: z
      .array(
        z.object({
          id: z.string().min(1),
          title: z.string().min(1),
          purpose: z.string().min(1),
          relatedObjectiveIds: z.array(z.string().min(1)).min(1),
          suggestedPlanMode: z.boolean(),
          risk: missionRiskSchema,
          approvalRequired: z.boolean(),
          verificationGate: z.array(z.string().min(1)).min(1),
        })
      )
      .min(1),
    taskProposals: z
      .array(
        z.object({
          id: z.string().min(1),
          title: z.string().min(1),
          summary: z.string().min(1),
          purpose: z.string().min(1),
          workPackageId: z.string().min(1),
          dependencies: z.array(z.string().min(1)).default([]),
          targetFilesOrModules: z.array(z.string().min(1)).default([]),
          initialPrompt: z.string().min(1),
          expectedOutcome: z.string().min(1),
          implementationFocus: z.array(z.string().min(1)).min(1),
          acceptanceCriteria: z.array(z.string().min(1)).min(1),
          verificationGate: z.array(z.string().min(1)).min(1),
          risk: missionRiskSchema,
          approvalRequired: z.boolean(),
          scheduling: missionSchedulingSchema,
        })
      )
      .min(1),
    replanningUnits: z.array(
      z.object({
        id: z.string().min(1),
        trigger: z.string().min(1),
        scope: z.enum(['mission', 'objective', 'work_package', 'task']),
        targetId: z.string().min(1).nullable(),
        action: z.enum(['split', 'merge', 'reorder', 'ask_human', 'pause']),
      })
    ),
  })
  .openapi('MissionDecompositionPlanningResult');
export type MissionDecompositionPlanningResult = z.infer<
  typeof missionDecompositionPlanningResultSchema
>;

export const missionDeterministicCheckReportSchema = z
  .object({
    status: z.enum(['pass', 'warning', 'fail']),
    checks: z.array(
      z.object({
        key: z.string().min(1),
        status: z.enum(['pass', 'warning', 'fail']),
        message: z.string().min(1),
        targetId: z.string().nullable(),
      })
    ),
  })
  .openapi('MissionDeterministicCheckReport');
export type MissionDeterministicCheckReport = z.infer<typeof missionDeterministicCheckReportSchema>;

export const missionEvaluationDimensionKeySchema = z.enum([
  'goal_alignment',
  'decomposition_quality',
  'dependency_soundness',
  'verification_readiness',
  'risk_control',
  'replanning_readiness',
  'plan_mode_fit',
]);
export type MissionEvaluationDimensionKey = z.infer<typeof missionEvaluationDimensionKeySchema>;

export const missionDecompositionEvaluationSchema = z
  .object({
    schemaVersion: z.literal('nightworkers.mission-decomposition-evaluation/v1'),
    verdict: z.enum([
      'review_ready',
      'needs_clarification',
      'needs_redecomposition',
      'needs_human_approval',
      'blocked',
    ]),
    confidence: z.enum(['low', 'medium', 'high']),
    dimensions: z.array(
      z.object({
        key: missionEvaluationDimensionKeySchema,
        status: z.enum(['pass', 'warning', 'fail']),
        rationale: z.string().min(1),
        suggestedCorrection: z.string().nullable(),
      })
    ),
    courseCorrections: z.array(
      z.object({
        target: z.enum([
          'mission',
          'objective',
          'work_package',
          'task_proposal',
          'verification_gate',
          'replanning_unit',
        ]),
        targetId: z.string().nullable(),
        action: z.enum([
          'clarify',
          'split',
          'merge',
          'reorder',
          'add_gate',
          'mark_approval_required',
          'pause',
        ]),
        reason: z.string().min(1),
      })
    ),
  })
  .openapi('MissionDecompositionEvaluation');
export type MissionDecompositionEvaluation = z.infer<typeof missionDecompositionEvaluationSchema>;

export const missionSchema = z
  .object({
    id: z.string().uuid(),
    repositoryId: z.string().uuid(),
    title: z.string().min(1),
    goalText: z.string().min(1),
    nonGoals: z.array(z.string()).default([]),
    status: missionStatusSchema,
    sourceGoalIds: z.array(z.string().uuid()).default([]),
    latestPlanningResultId: z.string().uuid().nullable(),
    statusReason: z.string().nullable(),
    createdAt: dateLikeSchema,
    updatedAt: dateLikeSchema,
  })
  .openapi('Mission');
export type Mission = z.infer<typeof missionSchema>;

export const missionDecompositionRunSchema = z
  .object({
    id: z.string().uuid(),
    missionId: z.string().uuid(),
    repositoryId: z.string().uuid(),
    status: z.enum(['running', 'completed', 'failed']),
    inputBundle: z.unknown(),
    stageOutputs: z.object({
      missionDraft: z.unknown().nullable(),
      structure: z.unknown().nullable(),
      taskProposals: z.unknown().nullable(),
      evaluation: z.unknown().nullable(),
    }),
    selectedModels: z.array(
      z.object({
        stage: z.enum([
          'mission_candidates',
          'mission_draft',
          'structure',
          'task_proposals',
          'evaluation',
        ]),
        providerId: z.string(),
        providerEndpointId: z.string().nullable(),
        routeSource: z.string().nullable(),
        modelOrDeployment: z.string().nullable(),
        thinkingDepth: z.string().nullable(),
      })
    ),
    errorMessage: z.string().nullable(),
    startedAt: dateLikeSchema,
    completedAt: dateLikeSchema.nullable(),
    createdAt: dateLikeSchema,
    updatedAt: dateLikeSchema,
  })
  .openapi('MissionDecompositionRun');
export type MissionDecompositionRun = z.infer<typeof missionDecompositionRunSchema>;

export const missionPlanningResultSchema = z
  .object({
    id: z.string().uuid(),
    missionId: z.string().uuid(),
    repositoryId: z.string().uuid(),
    decompositionRunId: z.string().uuid(),
    status: missionPlanningResultStatusSchema,
    planningResult: missionDecompositionPlanningResultSchema,
    deterministicChecks: missionDeterministicCheckReportSchema.nullable(),
    evaluation: missionDecompositionEvaluationSchema.nullable(),
    statusReason: z.string().nullable(),
    createdAt: dateLikeSchema,
    updatedAt: dateLikeSchema,
  })
  .openapi('MissionPlanningResult');
export type MissionPlanningResult = z.infer<typeof missionPlanningResultSchema>;

export const missionProposalTaskMetadataSchema = z
  .object({
    source: z.literal('mission_task_proposal'),
    missionId: z.string().uuid(),
    planningResultId: z.string().uuid(),
    proposalId: z.string().uuid(),
    workPackageId: z.string().min(1),
    decompositionTaskId: z.string().min(1),
    dependencies: z.array(z.string()),
    risk: missionRiskSchema,
    approvalRequired: z.boolean(),
    scheduling: missionSchedulingSchema,
  })
  .openapi('MissionProposalTaskMetadata');
export type MissionProposalTaskMetadata = z.infer<typeof missionProposalTaskMetadataSchema>;

export const missionTaskProposalSchema = z
  .object({
    id: z.string().uuid(),
    missionId: z.string().uuid(),
    planningResultId: z.string().uuid(),
    repositoryId: z.string().uuid(),
    workPackageId: z.string().min(1),
    decompositionTaskId: z.string().min(1),
    status: missionTaskProposalStatusSchema,
    title: z.string().min(1),
    summary: z.string().min(1),
    initialPrompt: z.string().min(1),
    expectedOutcome: z.string().min(1),
    implementationFocus: z.array(z.string()).default([]),
    acceptanceCriteria: z.array(z.string()).default([]),
    verificationGate: z.array(z.string()).default([]),
    dependencies: z.array(z.string()).default([]),
    targetFilesOrModules: z.array(z.string()).default([]),
    risk: missionRiskSchema,
    approvalRequired: z.boolean(),
    scheduling: missionSchedulingSchema,
    taskId: z.string().uuid().nullable(),
    createdAt: dateLikeSchema,
    updatedAt: dateLikeSchema,
  })
  .openapi('MissionTaskProposal');
export type MissionTaskProposal = z.infer<typeof missionTaskProposalSchema>;

export const missionDetailSchema = z
  .object({
    mission: missionSchema,
    latestPlanningResult: missionPlanningResultSchema.nullable(),
    taskProposals: z.array(missionTaskProposalSchema),
  })
  .openapi('MissionDetail');
export type MissionDetail = z.infer<typeof missionDetailSchema>;

export const createMissionRequestSchema = z.object({
  title: z.string().trim().min(1).optional(),
  goalText: z.string().trim().min(1),
  nonGoals: z.array(z.string().trim().min(1)).default([]),
  sourceGoalIds: z.array(z.string().uuid()).default([]),
});
export type CreateMissionRequest = z.infer<typeof createMissionRequestSchema>;

export const generateMissionCandidatesRequestSchema = z.object({
  goalIds: z.array(z.string().uuid()).optional(),
  includeInactiveGoals: z.boolean().default(false),
});
export type GenerateMissionCandidatesRequest = z.infer<
  typeof generateMissionCandidatesRequestSchema
>;

export const missionCandidateGenerationResultSchema = z
  .object({
    schemaVersion: z.literal('nightworkers.mission-candidates/v1'),
    candidates: z
      .array(
        z.object({
          title: z.string().min(1),
          goalText: z.string().min(1),
          nonGoals: z.array(z.string().min(1)).default([]),
          sourceGoalIds: z.array(z.string().uuid()).min(1),
          rationale: z.string().min(1),
        })
      )
      .min(1)
      .max(8),
  })
  .openapi('MissionCandidateGenerationResult');
export type MissionCandidateGenerationResult = z.infer<
  typeof missionCandidateGenerationResultSchema
>;

export const generateMissionCandidatesResponseSchema = z.object({
  status: z.enum(['completed']),
  missions: z.array(missionSchema),
});
export type GenerateMissionCandidatesResponse = z.infer<
  typeof generateMissionCandidatesResponseSchema
>;

export const decomposeMissionRequestSchema = z.object({
  force: z.boolean().default(false),
});
export type DecomposeMissionRequest = z.infer<typeof decomposeMissionRequestSchema>;

export const requestMissionPlanningRevisionRequestSchema = z.object({
  reason: z.string().trim().min(1),
});
export type RequestMissionPlanningRevisionRequest = z.infer<
  typeof requestMissionPlanningRevisionRequestSchema
>;

export const createTasksFromMissionTaskProposalsRequestSchema = z.object({
  proposalIds: z.array(z.string().uuid()).min(1),
  mode: z.enum(['draft', 'ready']).default('ready'),
});
export type CreateTasksFromMissionTaskProposalsRequest = z.infer<
  typeof createTasksFromMissionTaskProposalsRequestSchema
>;

export const createTasksFromMissionTaskProposalsResponseSchema = z.object({
  tasks: z.array(taskSchema),
  proposals: z.array(missionTaskProposalSchema),
});
export type CreateTasksFromMissionTaskProposalsResponse = z.infer<
  typeof createTasksFromMissionTaskProposalsResponseSchema
>;
