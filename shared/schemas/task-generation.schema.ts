import { z } from "@hono/zod-openapi";
import {
	missionSchema,
	missionTaskProposalSchema,
} from "./mission-planner.schema";
import { taskSchema } from "./nightworkers.schema";

const dateLikeSchema = z.union([z.string(), z.date()]);
const jsonValueSchema: z.ZodType<unknown> = z.unknown();

export const missionGoalSourceSchema = z.enum(["user", "preset"]);
export const missionGoalScopeSchema = z.enum([
	"feature_domain",
	"project_wide",
	"unknown",
]);
export const missionGoalIntentSchema = z.enum([
	"build",
	"maintain_threshold",
	"improve_metric",
	"unknown",
]);
export const missionGoalClassificationSourceSchema = z.enum([
	"preset",
	"user_override",
	"heuristic",
	"llm",
	"unknown",
]);
export const missionTaskCandidateStatusSchema = z.enum([
	"candidate",
	"selected",
	"task_created",
	"dismissed",
]);
export const missionTaskCandidateKindSchema = z.enum([
	"feature_entrypoint",
	"feature_followup",
	"constraint_enablement",
	"constraint_verification",
	"investigation",
]);
export const missionTaskCandidateBatchStatusSchema = z.enum([
	"running",
	"completed",
	"failed",
]);
export const missionTaskTokenSizeSchema = z.enum([
	"huge",
	"big",
	"medium",
	"small",
	"tiny",
]);
export const missionTaskComplexitySchema = z.enum([
	"very_complex",
	"complex",
	"moderate",
	"simple",
	"trivial",
]);
export const candidateEvidenceSchema = z.object({
	source: z.enum([
		"mission_goal",
		"project_evaluation",
		"quality",
		"llm_usage",
		"recent_runs",
	]),
	label: z.string().min(1),
	value: z.string().min(1),
});
export type CandidateEvidence = z.infer<typeof candidateEvidenceSchema>;

export const missionGoalInterpretationSchema = z.object({
	scope: missionGoalScopeSchema,
	intent: missionGoalIntentSchema,
	source: missionGoalClassificationSourceSchema,
	confidencePercent: z.number().int().min(0).max(100),
	reason: z.string().nullable(),
});
export type MissionGoalInterpretation = z.infer<
	typeof missionGoalInterpretationSchema
>;

export const missionGoalSchema = z
	.object({
		id: z.string().uuid(),
		repositoryId: z.string().uuid(),
		title: z.string().min(1),
		goalText: z.string().min(1),
		active: z.boolean(),
		source: missionGoalSourceSchema,
		sortOrder: z.number().int(),
		interpretation: missionGoalInterpretationSchema,
		createdAt: dateLikeSchema,
		updatedAt: dateLikeSchema,
	})
	.openapi("MissionGoal");
export type MissionGoal = z.infer<typeof missionGoalSchema>;

export const createMissionGoalRequestSchema = z.object({
	title: z.string().trim().min(1),
	goalText: z.string().trim().min(1),
	active: z.boolean().default(true),
});
export type CreateMissionGoalRequest = z.infer<
	typeof createMissionGoalRequestSchema
>;

export const updateMissionGoalRequestSchema = z
	.object({
		title: z.string().trim().min(1).optional(),
		goalText: z.string().trim().min(1).optional(),
		active: z.boolean().optional(),
		sortOrder: z.number().int().optional(),
	})
	.refine(
		(value) => Object.keys(value).length > 0,
		"At least one field is required.",
	);
export type UpdateMissionGoalRequest = z.infer<
	typeof updateMissionGoalRequestSchema
>;

export const missionGoalPresetSchema = z.object({
	id: z.string().min(1),
	title: z.string().min(1),
	goalText: z.string().min(1),
});
export type MissionGoalPreset = z.infer<typeof missionGoalPresetSchema>;

export const createMissionGoalFromPresetRequestSchema = z.object({
	presetId: z.string().min(1),
	active: z.boolean().default(true),
});

export const projectSignalSnapshotSchema = z.object({
	repository: z.object({
		id: z.string().uuid(),
		name: z.string(),
		localPath: z.string(),
		branch: z.string(),
	}),
	activeGoals: z.array(
		z.object({
			id: z.string().uuid(),
			title: z.string(),
			goalText: z.string(),
			interpretation: missionGoalInterpretationSchema,
		}),
	),
	latestEvaluation: z
		.object({
			id: z.string().uuid(),
			overallScore: z.number(),
			dimensions: z.array(
				z.object({ key: z.string(), score: z.number(), label: z.string() }),
			),
			summary: z.string(),
		})
		.nullable(),
	latestQuality: z.object({
		coverage: jsonValueSchema.nullable(),
		e2e: jsonValueSchema.nullable(),
	}),
	repositorySnapshot: z
		.object({
			packageName: z.string().nullable(),
			description: z.string().nullable(),
			readmeExcerpt: z.string().nullable(),
			sourceFiles: z.array(z.string()),
			routeFiles: z.array(z.string()),
			migrationFiles: z.array(z.string()),
			sourceExcerpts: z.array(
				z.object({
					path: z.string(),
					excerpt: z.string(),
				}),
			),
			llmContextFiles: z.array(
				z.object({
					path: z.string(),
					excerpt: z.string(),
				}),
			),
			recentCommitDiffs: z.array(
				z.object({
					hash: z.string(),
					subject: z.string(),
					diffExcerpt: z.string(),
				}),
			),
			packageScripts: z.array(
				z.object({ name: z.string(), command: z.string() }),
			),
			moduleOntology: z
				.object({
					path: z.string(),
					excerpt: z.string(),
				})
				.nullable(),
		})
		.optional(),
	qualityCapabilities: z.object({
		projectType: z.literal("typescript"),
		commands: z.array(
			z.object({
				kind: z.enum(["unit", "coverage", "e2e", "verify"]),
				source: z.enum(["package_json", "configured"]),
				command: z.string(),
				runnable: z.boolean(),
				reason: z.string().optional(),
			}),
		),
		missingCapabilities: z.array(z.enum(["unit", "coverage", "e2e"])),
	}),
	recentTokenSpendTasks: z.array(
		z.object({
			taskId: z.string().uuid(),
			title: z.string(),
			totalTokens: z.number(),
			callCount: z.number(),
		}),
	),
	recentRuns: z.object({
		completed: z.number(),
		failed: z.number(),
		running: z.number(),
	}),
});
export type ProjectSignalSnapshot = z.infer<typeof projectSignalSnapshotSchema>;

export const missionTaskCandidateSchema = z
	.object({
		id: z.string().uuid(),
		batchId: z.string().uuid(),
		repositoryId: z.string().uuid(),
		goalId: z.string().uuid().nullable(),
		goalTitle: z.string().nullable().optional(),
		candidateKind: missionTaskCandidateKindSchema,
		moduleRouting: z.object({
			primaryModule: z.string().nullable(),
			secondaryModules: z.array(z.string()),
			confidencePercent: z.number().int().min(0).max(100),
			reason: z.string().nullable(),
		}),
		constraintGoalIds: z.array(z.string().uuid()),
		planModeOpenQuestions: z.array(z.string().min(1)),
		title: z.string().min(1),
		summary: z.string().min(1),
		rationale: z.string().min(1),
		evidence: z.array(candidateEvidenceSchema),
		evaluationContribution: z.number().nullable(),
		importancePercent: z.number().int().min(0).max(100),
		confidencePercent: z.number().int().min(0).max(100),
		tokenSize: missionTaskTokenSizeSchema,
		complexity: missionTaskComplexitySchema,
		taskPrompt: z.string().min(1),
		acceptanceCriteria: z.string().min(1),
		verificationPlan: z.string().min(1),
		status: missionTaskCandidateStatusSchema,
		taskId: z.string().uuid().nullable(),
		createdAt: dateLikeSchema,
		updatedAt: dateLikeSchema,
	})
	.openapi("MissionTaskCandidate");
export type MissionTaskCandidate = z.infer<typeof missionTaskCandidateSchema>;

export const missionTaskCandidateBatchSchema = z.object({
	id: z.string().uuid(),
	repositoryId: z.string().uuid(),
	status: missionTaskCandidateBatchStatusSchema,
	requestedGoalIds: z.array(z.string().uuid()),
	signalSnapshot: projectSignalSnapshotSchema,
	selectedModel: jsonValueSchema.nullable(),
	rawOutput: jsonValueSchema.nullable(),
	errorMessage: z.string().nullable(),
	startedAt: dateLikeSchema,
	completedAt: dateLikeSchema.nullable(),
	createdAt: dateLikeSchema,
	updatedAt: dateLikeSchema,
});
export type MissionTaskCandidateBatch = z.infer<
	typeof missionTaskCandidateBatchSchema
>;

export const generateMissionTaskCandidatesRequestSchema = z.object({
	goalIds: z.array(z.string().uuid()).optional(),
	includeInactiveGoals: z.boolean().default(false),
});
export type GenerateMissionTaskCandidatesRequest = z.infer<
	typeof generateMissionTaskCandidatesRequestSchema
>;

export const generateMissionTaskCandidatesResponseSchema = z.object({
	batchId: z.string().uuid(),
	status: z.enum(["completed", "failed"]),
	candidates: z.array(missionTaskCandidateSchema),
	errorMessage: z.string().nullable().optional(),
});

export const taskGenerationScaleSchema = z.enum(["small", "medium", "large"]);
export type TaskGenerationScale = z.infer<typeof taskGenerationScaleSchema>;

export const taskGenerationEstimateSchema = z.object({
	estimatedChangedLines: z.number().int().nonnegative(),
	estimatedFileCount: z.number().int().nonnegative(),
	estimatedTaskCount: z.number().int().nonnegative(),
	confidencePercent: z.number().int().min(0).max(100),
	rationale: z.string().min(1),
	assumptions: z.array(z.string().min(1)),
	scale: taskGenerationScaleSchema,
});
export type TaskGenerationEstimate = z.infer<
	typeof taskGenerationEstimateSchema
>;

export const generateTaskCandidatesRequestSchema =
	generateMissionTaskCandidatesRequestSchema;
export type GenerateTaskCandidatesRequest = z.infer<
	typeof generateTaskCandidatesRequestSchema
>;

export const generateTaskCandidatesResponseSchema = z.object({
	status: z.enum(["completed", "needs_attention"]),
	generationPath: z.enum(["direct_task_candidates", "mission_decomposition"]),
	estimate: taskGenerationEstimateSchema,
	candidates: z.array(missionTaskCandidateSchema),
	missions: z.array(missionSchema),
	proposals: z.array(missionTaskProposalSchema),
	decompositionFailures: z.array(
		z.object({
			missionId: z.string().uuid(),
			message: z.string().min(1),
		}),
	),
});
export type GenerateTaskCandidatesResponse = z.infer<
	typeof generateTaskCandidatesResponseSchema
>;

export const updateMissionTaskCandidateRequestSchema = z.object({
	status: missionTaskCandidateStatusSchema.optional(),
});
export type UpdateMissionTaskCandidateRequest = z.infer<
	typeof updateMissionTaskCandidateRequestSchema
>;

export const createTasksFromMissionCandidatesRequestSchema = z.object({
	candidateIds: z.array(z.string().uuid()).min(1),
	mode: z.enum(["draft", "ready"]).default("draft"),
});
export type CreateTasksFromMissionCandidatesRequest = z.infer<
	typeof createTasksFromMissionCandidatesRequestSchema
>;

export const createTasksFromMissionCandidatesResponseSchema = z.object({
	tasks: z.array(taskSchema),
	candidates: z.array(missionTaskCandidateSchema),
});

export const MISSION_TASK_CANDIDATE_MAX_COUNT = 10;

export const missionTaskCandidatesResultSchema = z.object({
	schemaVersion: z.literal("nightworkers.mission-task-candidates/v1"),
	candidates: z
		.array(
			z.object({
				title: z.string().min(1),
				summary: z.string().min(1),
				rationale: z.string().min(1),
				goalId: z.string().uuid().nullable().optional(),
				candidateKind: missionTaskCandidateKindSchema,
				moduleRouting: z.object({
					primaryModule: z.string().nullable(),
					secondaryModules: z.array(z.string()),
					confidencePercent: z.number().int().min(0).max(100),
					reason: z.string().nullable(),
				}),
				constraintGoalIds: z.array(z.string().uuid()),
				planModeOpenQuestions: z.array(z.string().min(1)),
				evidence: z.array(candidateEvidenceSchema).default([]),
				evaluationContribution: z.number().min(0).max(100),
				importancePercent: z.number().int().min(0).max(100),
				confidencePercent: z.number().int().min(0).max(100),
				tokenSize: missionTaskTokenSizeSchema,
				complexity: missionTaskComplexitySchema,
				taskPrompt: z.string().min(1),
				acceptanceCriteria: z.string().min(1),
				verificationPlan: z.string().min(1),
			}),
		)
		.min(1)
		.max(MISSION_TASK_CANDIDATE_MAX_COUNT),
});
export type MissionTaskCandidatesResult = z.infer<
	typeof missionTaskCandidatesResultSchema
>;
