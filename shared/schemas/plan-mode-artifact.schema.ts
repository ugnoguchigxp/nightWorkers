import { z } from "@hono/zod-openapi";
import { designQuestionnaireSessionStatusSchema } from "./design-questionnaire.schema";

const dateLikeSchema = z.union([z.string(), z.date()]);

export const featurePlanBodySectionSchema = z.enum([
	"goal",
	"scope_non_goals",
	"current_and_desired_behavior",
	"acceptance_criteria",
	"constraints",
	"implementation_steps",
	"verification",
	"risk_notes",
]);

export const dedicatedDesignViewSchema = z.enum([
	"questionnaire",
	"user_flow",
	"blueprint",
	"data_model",
	"api_io_contract",
	"activity_flow",
	"sequence_flow",
	"zod_schema_design",
]);

export const planModeCapabilitySchema = z.enum([
	"feature_plan",
	"questionnaire",
	"user_flow",
	"blueprint",
	"data_model",
	"api_io_contract",
	"activity_flow",
	"sequence_flow",
	"zod_schema_design",
]);

export const planModeRegenerationTargetSchema = z.enum([
	"feature_plan",
	"blueprint",
	"data_model",
	"user_flow",
	"api_io_contract",
	"activity_flow",
	"sequence_flow",
	"zod_schema_design",
]);

export const specificationLensSchema = z.enum([
	"target_users_or_actors",
	"functional_requirements",
	"business_rules",
	"input_output",
	"interface_contract",
	"data_requirements",
	"state_behavior",
	"workflow_behavior",
	"error_behavior",
	"permission_boundary",
	"compatibility",
	"observability",
]);

export const planModeArtifactKindSchema = z.enum([
	"feature_plan",
	"questionnaire",
	"user_flow",
	"blueprint",
	"data_model",
	"api_io_contract",
	"activity_flow",
	"sequence_flow",
	"zod_schema_design",
	"decision_review",
	"implementation_reference",
]);

export const planModeWorkspaceArtifactSchema = z.object({
	id: z.string(),
	kind: planModeArtifactKindSchema,
	title: z.string(),
	sourceMessageId: z.string().uuid(),
	createdAt: dateLikeSchema,
	adoptionState: z.enum(["adopted", "not_adopted", "unknown"]).optional(),
	sourceArtifactMessageId: z.string().uuid().optional(),
});

export const planModeWorkspaceQuestionnaireSchema = z.object({
	id: z.string().uuid(),
	sourceBlueprintMessageId: z.string().uuid().nullable(),
	status: designQuestionnaireSessionStatusSchema,
	answeredCount: z.number().int().nonnegative(),
	totalQuestionCount: z.number().int().nonnegative(),
	unansweredCount: z.number().int().nonnegative().default(0),
	blockingUnansweredCount: z.number().int().nonnegative().default(0),
	nonBlockingUnansweredCount: z.number().int().nonnegative().default(0),
	latestAdditionalQuestionSetId: z.string().uuid().optional(),
	latestReviewId: z.string().uuid().optional(),
});

export const planModeWorkspaceReferenceSchema = z.object({
	id: z.string(),
	kind: z.literal("implementation_reference"),
	title: z.string(),
	sourceMessageId: z.string().uuid().optional(),
	taskId: z.string().uuid(),
});

export const planModeViewDecisionSchema = z.object({
	view: z.string().min(1),
	decision: z.enum(["include", "omit"]),
	reason: z.string().optional(),
});

export const dedicatedViewArtifactMetadataSchema = z.object({
	artifactKind: z.literal("plan_mode_dedicated_view"),
	view: dedicatedDesignViewSchema,
	source: z.enum([
		"questionnaire",
		"blueprint",
		"data-model",
		"dedicated-view-generator",
	]),
	title: z.string().min(1),
	featurePlanMessageId: z.string().uuid().nullable().optional(),
	questionnaireSessionId: z.string().uuid().nullable().optional(),
	sourceBlueprintMessageId: z.string().uuid().nullable().optional(),
	sourceDataModelMessageId: z.string().uuid().nullable().optional(),
	sourceMessageIds: z.array(z.string().uuid()).default([]),
	diagramKind: z
		.enum(["stateDiagram-v2", "flowchart", "sequenceDiagram"])
		.optional(),
	generation: z.object({
		provider: z.string().optional(),
		model: z.string().optional(),
		promptVersion: z.string().min(1),
	}),
});

export const dataModelArtifactSchema = z.object({
	artifactKind: z.literal("plan_mode_dedicated_view"),
	view: z.literal("data_model"),
	title: z.string().min(1),
	summary: z.string().min(1).optional().default(""),
	canonicalSource: z.enum([
		"ddl",
		"json_shape",
		"typescript_type",
		"zod_schema",
		"storage_contract",
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
					}),
				),
				indexes: z.array(z.string()).default([]),
			}),
		)
		.default([]),
	relations: z
		.array(
			z.object({
				from: z.string().min(1),
				to: z.string().min(1),
				cardinality: z.enum([
					"one_to_one",
					"one_to_many",
					"many_to_one",
					"many_to_many",
				]),
				reason: z.string().min(1),
			}),
		)
		.default([]),
	constraints: z.array(z.string()).default([]),
	openQuestions: z.array(z.string()).default([]),
});

export const planDiagramArtifactSchema = z.object({
	artifactKind: z.literal("plan_mode_dedicated_view"),
	view: z.enum(["user_flow", "activity_flow", "sequence_flow"]),
	title: z.string().min(1),
	markdown: z.string().min(1),
	diagramKind: z.enum(["stateDiagram-v2", "flowchart", "sequenceDiagram"]),
});

export const planApiContractOperationSchema = z
	.object({
		operationId: z.string().min(1),
		summary: z.string().nullable().optional(),
		description: z.string().nullable().optional(),
		tags: z.array(z.string()).optional().default([]),
		requestBody: z.record(z.string(), z.unknown()).nullable().optional(),
		responses: z
			.record(z.string(), z.unknown())
			.refine((responses) => Object.keys(responses).length > 0, {
				message: "responses must not be empty",
			}),
	})
	.passthrough();

export const planApiContractArtifactSchema = z.object({
	artifactKind: z.literal("plan_mode_api_contract"),
	view: z.literal("api_io_contract"),
	title: z.string().min(1),
	summary: z.string().min(1),
	openapi: z.object({
		openapi: z.literal("3.1.0"),
		info: z.object({
			title: z.string().min(1),
			version: z.string().min(1),
		}),
		paths: z
			.record(z.string(), z.record(z.string(), planApiContractOperationSchema))
			.refine((paths) => Object.keys(paths).length > 0, {
				message: "paths must not be empty",
			}),
		components: z
			.object({
				schemas: z.record(z.string(), z.unknown()).default({}),
				responses: z.record(z.string(), z.unknown()).optional(),
				parameters: z.record(z.string(), z.unknown()).optional(),
			})
			.default({ schemas: {} }),
	}),
	stateTransitions: z
		.array(
			z.object({
				operationId: z.string().min(1),
				fromState: z.string().nullable().optional(),
				toState: z.string().nullable().optional(),
				successStatus: z.number().int().min(100).max(599),
				conflictStatuses: z
					.array(z.number().int().min(100).max(599))
					.default([]),
				stateField: z.string().nullable().optional(),
				notes: z.array(z.string()).default([]),
			}),
		)
		.default([]),
	validation: z
		.array(
			z.object({
				schemaName: z.string().min(1),
				owner: z.enum(["request", "response", "error", "shared"]),
				zodOwnerFile: z.string().nullable().optional(),
				strictness: z
					.enum(["strict", "passthrough", "strip", "unknown"])
					.optional(),
				examples: z
					.array(
						z.object({
							name: z.string().min(1),
							valid: z.boolean(),
							payload: z.unknown(),
							expectedIssues: z.array(z.string()).default([]),
						}),
					)
					.default([]),
			}),
		)
		.default([]),
	openQuestions: z.array(z.string()).default([]),
});

export const planZodSchemaFieldRuleSchema = z.object({
	name: z.string().min(1),
	args: z.array(z.union([z.string(), z.number(), z.boolean()])).default([]),
	message: z.string().nullable().optional(),
});

export const planZodSchemaFieldSchema = z.object({
	name: z.string().min(1),
	type: z.enum([
		"string",
		"number",
		"boolean",
		"enum",
		"array",
		"object",
		"reference",
		"unknown",
	]),
	required: z.boolean(),
	description: z.string().nullable().optional(),
	enumOptions: z.array(z.string()).default([]),
	defaultValue: z
		.union([z.string(), z.number(), z.boolean()])
		.nullable()
		.optional(),
	referencedSchema: z.string().nullable().optional(),
	children: z.array(z.unknown()).default([]),
	rules: z.array(planZodSchemaFieldRuleSchema).default([]),
	zodExpression: z.string().min(1),
});

export const planZodSchemaArtifactSchema = z.object({
	artifactKind: z.literal("plan_mode_zod_schema"),
	view: z.literal("zod_schema_design"),
	title: z.string().min(1),
	summary: z.string().min(1),
	schemaName: z.string().min(1),
	owner: z.enum([
		"llm_json",
		"worker_tool_input",
		"mcp_input",
		"provider_adapter",
		"local_config",
	]),
	zodSource: z.string().min(1),
	fields: z.array(planZodSchemaFieldSchema).default([]),
	unsupportedExpressions: z.array(z.string()).default([]),
	openQuestions: z.array(z.string()).default([]),
});

export const zodSchemaDesignArtifactSchema = z.object({
	artifactKind: z.literal("plan_mode_dedicated_view"),
	view: z.literal("zod_schema_design"),
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
	viewDecisions: z.array(planModeViewDecisionSchema).default([]),
});

export type FeaturePlanBodySection = z.infer<
	typeof featurePlanBodySectionSchema
>;
export type DedicatedDesignView = z.infer<typeof dedicatedDesignViewSchema>;
export type PlanModeCapability = z.infer<typeof planModeCapabilitySchema>;
export type SpecificationLens = z.infer<typeof specificationLensSchema>;
export type PlanModeArtifactKind = z.infer<typeof planModeArtifactKindSchema>;
export type PlanModeWorkspaceArtifact = z.infer<
	typeof planModeWorkspaceArtifactSchema
>;
export type PlanModeWorkspaceQuestionnaire = z.infer<
	typeof planModeWorkspaceQuestionnaireSchema
>;
export type PlanModeWorkspaceReference = z.infer<
	typeof planModeWorkspaceReferenceSchema
>;
export type PlanModeViewDecision = z.infer<typeof planModeViewDecisionSchema>;
export type PlanModeWorkspace = z.infer<typeof planModeWorkspaceSchema>;
export type PlanModeRegenerationTarget = z.infer<
	typeof planModeRegenerationTargetSchema
>;
export type DedicatedViewArtifactMetadata = z.infer<
	typeof dedicatedViewArtifactMetadataSchema
>;
export type DataModelArtifact = z.infer<typeof dataModelArtifactSchema>;
export type PlanDiagramArtifact = z.infer<typeof planDiagramArtifactSchema>;
export type PlanApiContractArtifact = z.infer<
	typeof planApiContractArtifactSchema
>;
export type PlanZodSchemaArtifact = z.infer<typeof planZodSchemaArtifactSchema>;
export type PlanZodSchemaField = z.infer<typeof planZodSchemaFieldSchema>;
export type ZodSchemaDesignArtifact = z.infer<
	typeof zodSchemaDesignArtifactSchema
>;
