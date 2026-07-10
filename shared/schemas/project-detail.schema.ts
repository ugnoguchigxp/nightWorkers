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
export const projectQualityRunTypeSchema = z.enum(["unit", "e2e", "all"]);
export const projectQualityRunStatusSchema = z.enum([
	"queued",
	"running",
	"completed",
	"failed",
	"cancelled",
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

export const coverageMetricResultSchema = z.object({
	metric: z.enum(["statements", "branches", "functions", "lines"]),
	actualPercent: z.number(),
	targetPercent: z.number(),
	deltaPercent: z.number(),
	passed: z.boolean(),
});

export const coverageGateResultSchema = z.object({
	enabled: z.boolean(),
	passed: z.boolean(),
	targetPercent: z.number(),
	metrics: z.array(coverageMetricResultSchema),
	failedMetrics: z.array(
		z.enum(["statements", "branches", "functions", "lines"]),
	),
	summaryPath: z.string().optional(),
	measuredAt: z.string(),
	reason: z.string().optional(),
});

export const qualityCapabilitySchema = z.object({
	runnable: z.boolean(),
	missingCapabilities: z.array(z.string()),
	command: z.string().optional(),
});

export const projectQualityCapabilitiesSchema = z.object({
	projectType: z.literal("typescript"),
	unit: qualityCapabilitySchema,
	coverage: qualityCapabilitySchema,
	e2e: qualityCapabilitySchema,
	all: qualityCapabilitySchema,
});
export type ProjectQualityCapabilities = z.infer<
	typeof projectQualityCapabilitiesSchema
>;

export const e2eSummarySchema = z.object({
	status: z.enum(["passed", "failed", "unknown"]),
	total: z.number().int().nonnegative(),
	passed: z.number().int().nonnegative(),
	failed: z.number().int().nonnegative(),
	skipped: z.number().int().nonnegative(),
	durationMs: z.number().int().nonnegative().nullable(),
	suites: z
		.array(
			z.object({
				title: z.string(),
				status: z.enum(["passed", "failed", "unknown"]),
				tests: z.number().int().nonnegative(),
				durationMs: z.number().int().nonnegative().nullable(),
				lastFailure: z.string().nullable(),
			}),
		)
		.default([]),
});
export type E2ESummary = z.infer<typeof e2eSummarySchema>;

export const projectQualityRunSchema = z
	.object({
		id: z.string().uuid(),
		repositoryId: z.string().uuid(),
		runType: projectQualityRunTypeSchema,
		status: projectQualityRunStatusSchema,
		command: z.string(),
		exitCode: z.number().int().nullable(),
		startedAt: dateLikeSchema,
		completedAt: dateLikeSchema.nullable(),
		outputArtifactId: z.string().nullable(),
		latestOutput: z.string().nullable().optional(),
		coverageSummary: jsonValueSchema.nullable(),
		coverageGate: coverageGateResultSchema.nullable(),
		e2eSummary: e2eSummarySchema.nullable(),
		errorMessage: z.string().nullable(),
		createdAt: dateLikeSchema,
		updatedAt: dateLikeSchema,
	})
	.openapi("ProjectQualityRun");
export type ProjectQualityRun = z.infer<typeof projectQualityRunSchema>;

export const projectQualityOverviewSchema = z.object({
	capabilities: projectQualityCapabilitiesSchema,
	latestUnitRun: projectQualityRunSchema.nullable(),
	latestE2eRun: projectQualityRunSchema.nullable(),
	latestCoverageRun: projectQualityRunSchema.nullable(),
	latestE2eResultRun: projectQualityRunSchema.nullable(),
	latestAllRun: projectQualityRunSchema.nullable(),
	recentRuns: z.array(projectQualityRunSchema),
	runningRuns: z.array(projectQualityRunSchema),
});
export type ProjectQualityOverview = z.infer<
	typeof projectQualityOverviewSchema
>;

export const createProjectQualityRunRequestSchema = z.object({
	runType: projectQualityRunTypeSchema,
});

export const projectStackTechnologySchema = z.object({
	name: z.string(),
	category: z.enum([
		"language",
		"frontend",
		"backend",
		"runtime",
		"database",
		"orm",
		"testing",
		"desktop",
		"tooling",
	]),
	packageName: z.string().nullable(),
	version: z.string().nullable(),
	source: z.enum(["package_json", "file", "lockfile"]),
	confidence: z.enum(["high", "medium", "low"]),
});
export type ProjectStackTechnology = z.infer<
	typeof projectStackTechnologySchema
>;

export const projectStackProfileSchema = z.object({
	summary: z.string(),
	manifestStatus: z.enum(["found", "missing", "parse_failed"]),
	manifestPath: z.string(),
	packageManager: z.string().nullable(),
	technologies: z.array(projectStackTechnologySchema),
});
export type ProjectStackProfile = z.infer<typeof projectStackProfileSchema>;

export const projectFileScaleSchema = z.enum([
	"huge",
	"large",
	"medium",
	"small",
	"tiny",
]);
export type ProjectFileScale = z.infer<typeof projectFileScaleSchema>;

export const projectMetaSchema = z.object({
	version: z.literal(1),
	scannedAt: z.string(),
	scanDurationMs: z.number(),
	git: z.object({
		head: z.string().nullable(),
		shortHead: z.string().nullable(),
		displayHead: z.string().nullable(),
		committedAt: z.string().nullable(),
		status: z.enum(["available", "unavailable"]),
	}),
	files: z.object({
		total: z.number(),
		source: z.number(),
		tests: z.number(),
		sourceLoc: z.number(),
	}),
	ontology: z.object({
		moduleCount: z.number(),
		available: z.boolean(),
	}),
	fileScale: z.object({
		value: projectFileScaleSchema,
		score: z.number(),
	}),
});
export type ProjectMeta = z.infer<typeof projectMetaSchema>;

export const projectDetailMetricsSchema = z.object({
	stackProfile: projectStackProfileSchema,
	projectMeta: projectMetaSchema.nullable(),
	runs: z.object({
		total: z.number(),
		completed: z.number(),
		failed: z.number(),
	}),
	llmUsage: z.object({
		totalTokens: z.number(),
		promptInputTokens: z.number(),
		inputTokens: z.number(),
		outputTokens: z.number(),
		cachedInputTokens: z.number(),
		reasoningOutputTokens: z.number(),
		stateCardTokens: z.number(),
		totalDurationMs: z.number(),
		outputDurationMs: z.number(),
		measuredDurationCallCount: z.number(),
		outputTokensPerSecond: z.number().nullable(),
		callCount: z.number(),
		totalCost: z.number().nullable(),
		averageTokensPerRun: z.number().nullable(),
		averageCostPerRun: z.number().nullable(),
		modelMix: z.array(
			z.object({
				provider: z.string(),
				model: z.string().nullable(),
				calls: z.number(),
				tokens: z.number(),
				inputTokens: z.number(),
				outputTokens: z.number(),
				cachedInputTokens: z.number(),
				reasoningOutputTokens: z.number(),
				totalDurationMs: z.number(),
				outputDurationMs: z.number(),
				outputTokensPerSecond: z.number().nullable(),
				cost: z.number().nullable(),
			}),
		),
		topTokenTasks: z.array(
			z.object({
				taskId: z.string().uuid(),
				title: z.string(),
				tokens: z.number(),
				inputTokens: z.number(),
				outputTokens: z.number(),
				cachedInputTokens: z.number(),
				reasoningOutputTokens: z.number(),
				totalDurationMs: z.number(),
				outputDurationMs: z.number(),
				outputTokensPerSecond: z.number().nullable(),
				cost: z.number().nullable(),
			}),
		),
	}),
	health: z.object({
		latestEvaluationScore: z.number().nullable(),
		coverageAverage: z.number().nullable(),
	}),
});
export type ProjectDetailMetrics = z.infer<typeof projectDetailMetricsSchema>;
