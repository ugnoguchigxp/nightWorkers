import { z } from '@hono/zod-openapi';
import { designQuestionnaireSessionStatusSchema } from './design-questionnaire.schema';

const dateLikeSchema = z.union([z.string(), z.date()]);

export const featurePlanBodySectionSchema = z.enum([
  'goal',
  'scope_non_goals',
  'current_and_desired_behavior',
  'acceptance_criteria',
  'constraints',
  'implementation_steps',
  'verification',
  'risk_notes',
]);

export const dedicatedDesignViewSchema = z.enum([
  'questionnaire',
  'user_flow',
  'blueprint',
  'data_model',
  'api_io_contract',
  'state_model',
  'activity_flow',
  'sequence_flow',
  'zod_schema_design',
]);

export const planModeCapabilitySchema = z.enum([
  'feature_plan',
  'questionnaire',
  'user_flow',
  'blueprint',
  'data_model',
  'api_io_contract',
  'state_model',
  'activity_flow',
  'sequence_flow',
  'zod_schema_design',
]);

export const specificationLensSchema = z.enum([
  'target_users_or_actors',
  'functional_requirements',
  'business_rules',
  'input_output',
  'interface_contract',
  'data_requirements',
  'state_behavior',
  'workflow_behavior',
  'error_behavior',
  'permission_boundary',
  'compatibility',
  'observability',
]);

export const planModeArtifactKindSchema = z.enum([
  'feature_plan',
  'questionnaire',
  'user_flow',
  'blueprint',
  'data_model',
  'api_io_contract',
  'state_model',
  'activity_flow',
  'sequence_flow',
  'zod_schema_design',
  'decision_review',
  'implementation_reference',
]);

export const planModeWorkspaceArtifactSchema = z.object({
  id: z.string(),
  kind: planModeArtifactKindSchema,
  title: z.string(),
  sourceMessageId: z.string().uuid(),
  createdAt: dateLikeSchema,
  adoptionState: z.enum(['adopted', 'not_adopted', 'unknown']).optional(),
  sourceArtifactMessageId: z.string().uuid().optional(),
});

export const planModeWorkspaceQuestionnaireSchema = z.object({
  id: z.string().uuid(),
  sourceBlueprintMessageId: z.string().uuid().nullable(),
  status: designQuestionnaireSessionStatusSchema,
  answeredCount: z.number().int().nonnegative(),
  totalQuestionCount: z.number().int().nonnegative(),
  latestReviewId: z.string().uuid().optional(),
});

export const planModeWorkspaceReferenceSchema = z.object({
  id: z.string(),
  kind: z.literal('implementation_reference'),
  title: z.string(),
  sourceMessageId: z.string().uuid().optional(),
  taskId: z.string().uuid(),
});

export const dedicatedViewArtifactMetadataSchema = z.object({
  artifactKind: z.literal('plan_mode_dedicated_view'),
  view: dedicatedDesignViewSchema,
  source: z.enum(['questionnaire', 'blueprint', 'data-model', 'dedicated-view-generator']),
  title: z.string().min(1),
  featurePlanMessageId: z.string().uuid().nullable().optional(),
  questionnaireSessionId: z.string().uuid().nullable().optional(),
  sourceBlueprintMessageId: z.string().uuid().nullable().optional(),
  sourceDataModelMessageId: z.string().uuid().nullable().optional(),
  sourceMessageIds: z.array(z.string().uuid()).default([]),
  generation: z.object({
    provider: z.string().optional(),
    model: z.string().optional(),
    promptVersion: z.string().min(1),
  }),
});

export const dataModelArtifactSchema = z.object({
  artifactKind: z.literal('plan_mode_dedicated_view'),
  view: z.literal('data_model'),
  title: z.string().min(1),
  summary: z.string().min(1).optional().default(''),
  canonicalSource: z.enum([
    'ddl',
    'json_shape',
    'typescript_type',
    'zod_schema',
    'storage_contract',
  ]),
  ddl: z.string().optional(),
  derivedTables: z
    .array(
      z.object({
        name: z.string().min(1),
        purpose: z.string().min(1),
        columns: z.array(
          z.object({
            name: z.string().min(1),
            type: z.string().min(1),
            nullable: z.boolean(),
            primaryKey: z.boolean().optional(),
            unique: z.boolean().optional(),
            defaultValue: z.string().nullable().optional(),
          })
        ),
        indexes: z.array(z.string()).default([]),
      })
    )
    .default([]),
  relations: z
    .array(
      z.object({
        from: z.string().min(1),
        to: z.string().min(1),
        cardinality: z.enum(['one_to_one', 'one_to_many', 'many_to_one', 'many_to_many']),
        reason: z.string().min(1),
      })
    )
    .default([]),
  constraints: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
});

export const planDiagramArtifactSchema = z.object({
  artifactKind: z.literal('plan_mode_dedicated_view'),
  view: z.enum(['state_model', 'activity_flow', 'sequence_flow']),
  title: z.string().min(1),
  markdown: z.string().min(1),
  diagramKind: z.enum(['stateDiagram-v2', 'flowchart', 'sequenceDiagram']),
});

export const zodSchemaDesignArtifactSchema = z.object({
  artifactKind: z.literal('plan_mode_dedicated_view'),
  view: z.literal('zod_schema_design'),
  title: z.string().min(1),
  markdown: z.string().min(1),
});

export const planModeWorkspaceSchema = z.object({
  taskId: z.string().uuid(),
  repositoryId: z.string().uuid(),
  generatedAt: z.string(),
  featurePlanArtifacts: z.array(planModeWorkspaceArtifactSchema),
  blueprintArtifacts: z.array(planModeWorkspaceArtifactSchema),
  dataModelArtifacts: z.array(planModeWorkspaceArtifactSchema),
  dedicatedViewArtifacts: z.array(planModeWorkspaceArtifactSchema),
  questionnaireSessions: z.array(planModeWorkspaceQuestionnaireSchema),
  decisionReviews: z.array(planModeWorkspaceArtifactSchema),
  implementationReferences: z.array(planModeWorkspaceReferenceSchema),
});

export type FeaturePlanBodySection = z.infer<typeof featurePlanBodySectionSchema>;
export type DedicatedDesignView = z.infer<typeof dedicatedDesignViewSchema>;
export type PlanModeCapability = z.infer<typeof planModeCapabilitySchema>;
export type SpecificationLens = z.infer<typeof specificationLensSchema>;
export type PlanModeArtifactKind = z.infer<typeof planModeArtifactKindSchema>;
export type PlanModeWorkspaceArtifact = z.infer<typeof planModeWorkspaceArtifactSchema>;
export type PlanModeWorkspaceQuestionnaire = z.infer<typeof planModeWorkspaceQuestionnaireSchema>;
export type PlanModeWorkspaceReference = z.infer<typeof planModeWorkspaceReferenceSchema>;
export type PlanModeWorkspace = z.infer<typeof planModeWorkspaceSchema>;
export type DedicatedViewArtifactMetadata = z.infer<typeof dedicatedViewArtifactMetadataSchema>;
export type DataModelArtifact = z.infer<typeof dataModelArtifactSchema>;
export type PlanDiagramArtifact = z.infer<typeof planDiagramArtifactSchema>;
export type ZodSchemaDesignArtifact = z.infer<typeof zodSchemaDesignArtifactSchema>;
