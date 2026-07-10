import { z } from "@hono/zod-openapi";
import {
	missionRiskSchema,
	missionSchedulingSchema,
	missionSchema,
	missionTaskProposalSchema,
	missionTaskProposalStatusSchema,
} from "./mission-planner.schema";

const dateLikeSchema = z.union([z.string(), z.date()]);

export const missionEvidenceRefTypeSchema = z.enum([
	"task",
	"queue_entry",
	"run",
	"task_event",
	"review_session",
	"review_artifact",
	"review_finding",
	"verification_document",
	"verification_evidence_run",
	"verification_evidence_case",
	"artifact",
	"diff",
	"command",
]);
export type MissionEvidenceRefType = z.infer<
	typeof missionEvidenceRefTypeSchema
>;

export const missionEvidenceRefSchema = z
	.object({
		type: missionEvidenceRefTypeSchema,
		id: z.string().min(1),
		label: z.string().min(1).optional(),
	})
	.strict()
	.openapi("MissionEvidenceRef");
export type MissionEvidenceRef = z.infer<typeof missionEvidenceRefSchema>;

export const missionTaskCandidateSnapshotSchema = z
	.object({
		schemaVersion: z.literal("nightworkers.mission-task-candidate-snapshot/v1"),
		missionId: z.string().uuid(),
		planningResultId: z.string().uuid(),
		taskCandidateId: z.string().uuid(),
		workPackageId: z.string().min(1),
		decompositionTaskId: z.string().min(1),
		title: z.string().min(1),
		summary: z.string().min(1),
		initialPrompt: z.string().min(1),
		expectedOutcome: z.string().min(1),
		implementationFocus: z.array(z.string()),
		acceptanceCriteria: z.array(z.string()),
		verificationGate: z.array(z.string()),
		dependencies: z.array(z.string()),
		targetFilesOrModules: z.array(z.string()),
		risk: missionRiskSchema,
		approvalRequired: z.boolean(),
		scheduling: missionSchedulingSchema,
	})
	.strict()
	.openapi("MissionTaskCandidateSnapshot");
export type MissionTaskCandidateSnapshot = z.infer<
	typeof missionTaskCandidateSnapshotSchema
>;

export const missionPilotTaskCandidateSchema = z
	.object({
		source: z.literal("mission_task_proposal"),
		missionId: z.string().uuid(),
		planningResultId: z.string().uuid(),
		taskCandidateId: z.string().uuid(),
		workPackageId: z.string().min(1),
		decompositionTaskId: z.string().min(1),
		status: missionTaskProposalStatusSchema,
		title: z.string().min(1),
		summary: z.string().min(1),
		initialPrompt: z.string().min(1),
		expectedOutcome: z.string().min(1),
		implementationFocus: z.array(z.string()),
		acceptanceCriteria: z.array(z.string()),
		verificationGate: z.array(z.string()),
		dependencies: z.array(z.string()),
		targetFilesOrModules: z.array(z.string()),
		risk: missionRiskSchema,
		approvalRequired: z.boolean(),
		scheduling: missionSchedulingSchema,
		taskId: z.string().uuid().nullable(),
		createdAt: dateLikeSchema,
		updatedAt: dateLikeSchema,
	})
	.strict()
	.openapi("MissionPilotTaskCandidate");
export type MissionPilotTaskCandidate = z.infer<
	typeof missionPilotTaskCandidateSchema
>;

export const missionObjectiveStatusSchema = z.enum([
	"pending",
	"progressed",
	"satisfied",
	"blocked",
	"failed",
	"deferred",
]);

export const missionObjectiveSchema = z
	.object({
		id: z.string().uuid(),
		missionId: z.string().uuid(),
		repositoryId: z.string().uuid(),
		planningResultId: z.string().uuid(),
		externalObjectiveId: z.string().min(1),
		title: z.string().min(1),
		completionCriteria: z.array(z.string()),
		verificationGate: z.array(z.string()),
		status: missionObjectiveStatusSchema,
		evidenceRefs: z.array(missionEvidenceRefSchema),
		statusReason: z.string().nullable(),
		createdAt: dateLikeSchema,
		updatedAt: dateLikeSchema,
	})
	.openapi("MissionObjective");
export type MissionObjective = z.infer<typeof missionObjectiveSchema>;

export const missionActorSchema = z.object({
	type: z.enum(["human", "system", "autopilot"]),
	id: z.string().nullable(),
	displayName: z.string().min(1),
});
export type MissionActor = z.infer<typeof missionActorSchema>;

export const pilotActionSchema = z.object({
	id: z.string().uuid(),
	missionId: z.string().uuid(),
	repositoryId: z.string().uuid(),
	targetType: z.string().nullable(),
	targetId: z.string().nullable(),
	type: z.string().min(1),
	status: z.enum(["started", "completed", "failed"]),
	idempotencyKey: z.string().min(1),
	requestHash: z.string().min(1),
	reason: z.string().min(1),
	actor: missionActorSchema,
	evidenceRefs: z.array(missionEvidenceRefSchema),
	resultRef: z.unknown().nullable(),
	requiresHumanAttention: z.boolean(),
	errorCode: z.string().nullable(),
	errorMessage: z.string().nullable(),
	startedAt: dateLikeSchema,
	completedAt: dateLikeSchema.nullable(),
	createdAt: dateLikeSchema,
	updatedAt: dateLikeSchema,
});
export type PilotAction = z.infer<typeof pilotActionSchema>;

export const missionApprovalStatusSchema = z.enum([
	"requested",
	"approved",
	"rejected",
	"stale",
	"cancelled",
	"expired",
]);
export const missionApprovalSchema = z.object({
	id: z.string().uuid(),
	missionId: z.string().uuid(),
	repositoryId: z.string().uuid(),
	targetType: z.enum([
		"task_candidate",
		"mission_task",
		"replan_suggestion",
		"mission",
		"scope_expansion",
		"accepted_risk",
	]),
	targetId: z.string().min(1),
	approvalType: z.enum([
		"queue_admission",
		"replan",
		"scope_change",
		"accepted_risk",
		"autopilot_start",
	]),
	status: missionApprovalStatusSchema,
	riskLevel: missionRiskSchema,
	approvalRequired: z.boolean(),
	requestedReason: z.string().min(1),
	requestedByActor: missionActorSchema,
	decidedByActor: missionActorSchema.nullable(),
	decisionReason: z.string().nullable(),
	snapshot: z.unknown(),
	snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
	requestedAt: dateLikeSchema,
	decidedAt: dateLikeSchema.nullable(),
	expiresAt: dateLikeSchema.nullable(),
	createdAt: dateLikeSchema,
	updatedAt: dateLikeSchema,
});
export type MissionApproval = z.infer<typeof missionApprovalSchema>;

export const missionAttentionItemSchema = z.object({
	id: z.string().uuid(),
	missionId: z.string().uuid(),
	repositoryId: z.string().uuid(),
	targetType: z.string().min(1),
	targetId: z.string().min(1),
	type: z.string().min(1),
	status: z.enum(["open", "resolved", "dismissed"]),
	severity: z.enum(["info", "warning", "blocking"]),
	title: z.string().min(1),
	summary: z.string().min(1),
	actionSchema: z.unknown(),
	evidenceRefs: z.array(missionEvidenceRefSchema),
	sourceEventId: z.string().uuid().nullable(),
	sourceRef: z.unknown().nullable(),
	resolvedByActor: missionActorSchema.nullable(),
	resolvedAt: dateLikeSchema.nullable(),
	createdAt: dateLikeSchema,
	updatedAt: dateLikeSchema,
});
export type MissionAttentionItem = z.infer<typeof missionAttentionItemSchema>;

export const missionTaskStatusSchema = z.enum([
	"approved",
	"task_created",
	"queued",
	"running",
	"awaiting_evaluation",
	"satisfied",
	"blocked",
	"failed",
	"deferred",
	"cancelled",
]);
export const missionTaskSchema = z.object({
	id: z.string().uuid(),
	missionId: z.string().uuid(),
	repositoryId: z.string().uuid(),
	planningResultId: z.string().uuid(),
	taskCandidateId: z.string().uuid(),
	objectiveIds: z.array(z.string().uuid()),
	nightworkersTaskId: z.string().uuid().nullable(),
	queueEntryId: z.string().uuid().nullable(),
	activeRunId: z.string().uuid().nullable(),
	approvalId: z.string().uuid(),
	approvalSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
	title: z.string().min(1),
	purpose: z.string().min(1),
	status: missionTaskStatusSchema,
	riskLevel: missionRiskSchema,
	approvalRequired: z.boolean(),
	dependencies: z.array(z.string()),
	verificationGate: z.array(z.string()),
	scheduling: missionSchedulingSchema,
	lastSyncedAt: dateLikeSchema.nullable(),
	createdAt: dateLikeSchema,
	updatedAt: dateLikeSchema,
});
export type MissionTask = z.infer<typeof missionTaskSchema>;

export const missionAutopilotAllowedActionSchema = z.enum([
	"sync_execution",
	"enqueue_approved_task",
	"evaluate_completed_run",
	"create_replan_suggestion",
	"pause_mission",
]);
export type MissionAutopilotAllowedAction = z.infer<
	typeof missionAutopilotAllowedActionSchema
>;
export const missionAutopilotGrantSchema = z.object({
	id: z.string().uuid(),
	missionId: z.string().uuid(),
	repositoryId: z.string().uuid(),
	autonomyLevel: z.literal(1),
	allowedActions: z.array(missionAutopilotAllowedActionSchema),
	status: z.enum(["active", "paused", "revoked", "expired"]),
	grantedByActor: missionActorSchema,
	expiresAt: dateLikeSchema.nullable(),
	pausedAt: dateLikeSchema.nullable(),
	revokedAt: dateLikeSchema.nullable(),
	createdAt: dateLikeSchema,
	updatedAt: dateLikeSchema,
});
export type MissionAutopilotGrant = z.infer<typeof missionAutopilotGrantSchema>;

export const missionEvaluationSchema = z.object({
	id: z.string().uuid(),
	missionId: z.string().uuid(),
	repositoryId: z.string().uuid(),
	scopeType: z.enum(["mission", "mission_task"]),
	scopeId: z.string().uuid(),
	missionTaskId: z.string().uuid().nullable(),
	runId: z.string().uuid().nullable(),
	result: z.enum([
		"progressed",
		"no_progress",
		"regressed",
		"blocked",
		"completed",
		"failed",
	]),
	summary: z.string().min(1),
	objectiveUpdates: z.array(
		z.object({
			objectiveId: z.string().uuid(),
			status: missionObjectiveStatusSchema,
			reason: z.string().min(1),
		}),
	),
	evidenceRefs: z.array(missionEvidenceRefSchema),
	inputDigest: z.string().regex(/^[a-f0-9]{64}$/),
	nextRecommendedAction: z.string().min(1),
	createdByActor: missionActorSchema,
	createdAt: dateLikeSchema,
	updatedAt: dateLikeSchema,
});
export type MissionEvaluation = z.infer<typeof missionEvaluationSchema>;

export const missionTaskGraphSchema = z.object({
	schemaVersion: z.literal("nightworkers.mission-task-graph/v1"),
	planningResultId: z.string().uuid(),
	objectives: z.array(
		z.object({ id: z.string().min(1), title: z.string().min(1) }),
	),
	workPackages: z.array(
		z.object({
			id: z.string().min(1),
			title: z.string().min(1),
			relatedObjectiveIds: z.array(z.string().min(1)),
		}),
	),
	taskCandidates: z.array(
		z.object({
			id: z.string().min(1),
			workPackageId: z.string().min(1),
			title: z.string().min(1),
			dependencies: z.array(z.string().min(1)),
			status: z.enum(["proposed", "task_created", "dismissed"]),
		}),
	),
});
export type MissionTaskGraph = z.infer<typeof missionTaskGraphSchema>;

const missionReplanNewCandidateSchema = z.object({
	id: z.string().min(1),
	workPackageId: z.string().min(1),
	title: z.string().min(1),
	summary: z.string().min(1),
	purpose: z.string().min(1),
	dependencies: z.array(z.string().min(1)),
	targetFilesOrModules: z.array(z.string()),
	initialPrompt: z.string().min(1),
	expectedOutcome: z.string().min(1),
	implementationFocus: z.array(z.string()),
	acceptanceCriteria: z.array(z.string()),
	verificationGate: z.array(z.string()),
	risk: z.enum(["low", "medium", "high"]),
	approvalRequired: z.boolean(),
	scheduling: missionSchedulingSchema,
});

export const missionTaskGraphDiffOperationSchema = z.discriminatedUnion("op", [
	z.object({
		op: z.literal("add_candidate"),
		candidate: missionReplanNewCandidateSchema,
	}),
	z.object({
		op: z.literal("update_candidate"),
		candidateId: z.string().min(1),
		patch: z.object({
			title: z.string().min(1).optional(),
			dependencies: z.array(z.string().min(1)).optional(),
			verificationGate: z.array(z.string()).optional(),
		}),
	}),
	z.object({
		op: z.literal("defer_candidate"),
		candidateId: z.string().min(1),
		reason: z.string().min(1),
	}),
	z.object({
		op: z.literal("add_dependency"),
		candidateId: z.string().min(1),
		dependsOnCandidateId: z.string().min(1),
	}),
	z.object({
		op: z.literal("remove_dependency"),
		candidateId: z.string().min(1),
		dependsOnCandidateId: z.string().min(1),
	}),
	z.object({
		op: z.literal("add_objective"),
		objective: z.object({
			id: z.string().min(1),
			title: z.string().min(1),
			completionCriteria: z.array(z.string().min(1)),
			verificationGate: z.array(z.string()),
		}),
	}),
	z.object({
		op: z.literal("defer_objective"),
		objectiveId: z.string().min(1),
		reason: z.string().min(1),
	}),
]);
export type MissionTaskGraphDiffOperation = z.infer<
	typeof missionTaskGraphDiffOperationSchema
>;

export const missionPlanRevisionSchema = z.object({
	id: z.string().uuid(),
	missionId: z.string().uuid(),
	repositoryId: z.string().uuid(),
	baseRevisionId: z.string().uuid().nullable(),
	planningResultId: z.string().uuid(),
	revisionNumber: z.number().int().positive(),
	summary: z.string().min(1),
	taskGraph: missionTaskGraphSchema,
	appliedDiff: z.array(missionTaskGraphDiffOperationSchema).nullable(),
	createdByActor: missionActorSchema,
	createdAt: dateLikeSchema,
	updatedAt: dateLikeSchema,
});
export type MissionPlanRevision = z.infer<typeof missionPlanRevisionSchema>;

export const missionReplanSuggestionSchema = z.object({
	id: z.string().uuid(),
	missionId: z.string().uuid(),
	repositoryId: z.string().uuid(),
	baseRevisionId: z.string().uuid(),
	sourceEvaluationId: z.string().uuid(),
	status: z.enum([
		"draft",
		"awaiting_approval",
		"approved",
		"rejected",
		"applied",
		"cancelled",
		"stale",
		"blocked",
	]),
	reason: z.string().min(1),
	taskGraphDiff: z.array(missionTaskGraphDiffOperationSchema).min(1),
	diffHash: z.string().min(1),
	approvalId: z.string().uuid().nullable(),
	createdAt: dateLikeSchema,
	updatedAt: dateLikeSchema,
});
export type MissionReplanSuggestion = z.infer<
	typeof missionReplanSuggestionSchema
>;

export const missionEventSchema = z
	.object({
		id: z.string().uuid(),
		missionId: z.string().uuid(),
		repositoryId: z.string().uuid(),
		missionTaskId: z.string().uuid().nullable(),
		eventType: z.string().min(1),
		summary: z.string().min(1),
		actor: missionActorSchema,
		payload: z.unknown().nullable(),
		evidenceRefs: z.array(missionEvidenceRefSchema),
		sourceKind: z.string().min(1),
		sourceId: z.string().min(1),
		sourceVersion: z.string().min(1),
		occurredAt: dateLikeSchema,
		createdAt: dateLikeSchema,
	})
	.openapi("MissionEvent");
export type MissionEvent = z.infer<typeof missionEventSchema>;

export const missionPilotDerivedAttentionSchema = z.object({
	id: z.string().min(1),
	type: z.literal("approval_required"),
	severity: z.enum(["info", "warning", "blocking"]),
	title: z.string().min(1),
	summary: z.string().min(1),
	targetId: z.string().uuid(),
	persisted: z.literal(false),
});

export const missionPilotExecutionSummarySchema = z.object({
	approved: z.number().int().nonnegative(),
	queued: z.number().int().nonnegative(),
	running: z.number().int().nonnegative(),
	awaitingEvaluation: z.number().int().nonnegative(),
	satisfied: z.number().int().nonnegative(),
	blocked: z.number().int().nonnegative(),
	failed: z.number().int().nonnegative(),
});

export const missionPilotDetailSchema = z
	.object({
		mission: missionSchema,
		source: z.object({
			type: z.enum(["user", "mission_goal", "project_evaluation"]),
			refId: z.string().nullable(),
			evaluationId: z.string().uuid().nullable(),
			label: z.string().nullable(),
		}),
		objectives: z.array(missionObjectiveSchema),
		taskCandidates: z.array(missionPilotTaskCandidateSchema),
		legacyTaskProposals: z.array(missionTaskProposalSchema),
		approvals: z.array(missionApprovalSchema),
		missionTasks: z.array(missionTaskSchema),
		activeAutopilotGrant: missionAutopilotGrantSchema.nullable(),
		latestAutopilotGrant: missionAutopilotGrantSchema.nullable(),
		latestEvaluation: missionEvaluationSchema.nullable(),
		latestPlanRevision: missionPlanRevisionSchema.nullable(),
		replanSuggestions: z.array(missionReplanSuggestionSchema),
		attentionItems: z.array(
			z.union([missionPilotDerivedAttentionSchema, missionAttentionItemSchema]),
		),
		events: z.array(missionEventSchema),
		executionSummary: missionPilotExecutionSummarySchema,
		nextRecommendedAction: z.object({
			type: z.string().min(1),
			reason: z.string().min(1),
			requiresHuman: z.boolean(),
		}),
	})
	.openapi("MissionPilotDetail");
export type MissionPilotDetail = z.infer<typeof missionPilotDetailSchema>;

export const createMissionFromImprovementRequestSchema = z.object({
	evaluationId: z.string().uuid(),
	improvementIdeaId: z.string().uuid(),
	title: z.string().min(1).optional(),
	goalText: z.string().min(1).optional(),
	nonGoals: z.array(z.string().min(1)).optional(),
	idempotencyKey: z.string().min(1).max(200),
});
export type CreateMissionFromImprovementRequest = z.infer<
	typeof createMissionFromImprovementRequestSchema
>;

export const createMissionFromImprovementResponseSchema = z.object({
	mission: missionSchema,
	created: z.boolean(),
	warnings: z.array(z.string()),
});
export type CreateMissionFromImprovementResponse = z.infer<
	typeof createMissionFromImprovementResponseSchema
>;

export const requestMissionApprovalSchema = z
	.object({
		targetType: z.enum(["task_candidate", "replan_suggestion", "mission"]),
		targetId: z.string().min(1),
		approvalType: z.enum(["queue_admission", "replan", "autopilot_start"]),
		autopilotConfig: z
			.object({
				autonomyLevel: z.literal(1),
				allowedActions: z.array(missionAutopilotAllowedActionSchema).min(1),
				expiresAt: z.string().datetime().optional(),
			})
			.optional(),
		reason: z.string().min(1),
		idempotencyKey: z.string().min(1).max(200),
	})
	.superRefine((value, ctx) => {
		const valid =
			(value.targetType === "task_candidate" &&
				value.approvalType === "queue_admission") ||
			(value.targetType === "replan_suggestion" &&
				value.approvalType === "replan") ||
			(value.targetType === "mission" &&
				value.approvalType === "autopilot_start");
		if (!valid)
			ctx.addIssue({
				code: "custom",
				message: "Unsupported approval target and type combination",
			});
		if (
			value.targetType === "mission" &&
			value.approvalType === "autopilot_start" &&
			!value.autopilotConfig
		) {
			ctx.addIssue({
				code: "custom",
				path: ["autopilotConfig"],
				message: "Autopilot approval requires its Level 1 configuration",
			});
		}
	});
export type RequestMissionApproval = z.infer<
	typeof requestMissionApprovalSchema
>;

export const decideMissionApprovalSchema = z.object({
	reason: z.string().min(1),
	idempotencyKey: z.string().min(1).max(200),
});
export type DecideMissionApproval = z.infer<typeof decideMissionApprovalSchema>;

export const materializeMissionTaskRequestSchema = z.object({
	approvalId: z.string().uuid(),
	mode: z.enum(["draft", "ready"]),
	idempotencyKey: z.string().min(1).max(200),
});
export const materializeMissionTaskResponseSchema = z.object({
	missionTask: missionTaskSchema,
	task: z.unknown(),
});
export const enqueueMissionTaskRequestSchema = z.object({
	idempotencyKey: z.string().min(1).max(200),
	autopilotGrantId: z.string().uuid().optional(),
});
export const enqueueMissionTaskResponseSchema = z.object({
	missionTask: missionTaskSchema,
	queueEntry: z.unknown(),
});

export const startMissionAutopilotRequestSchema = z.object({
	autonomyLevel: z.literal(1),
	allowedActions: z.array(missionAutopilotAllowedActionSchema).min(1),
	expiresAt: z.string().datetime().optional(),
	approvalId: z.string().uuid(),
	idempotencyKey: z.string().min(1).max(200),
});
export const missionAutopilotCommandRequestSchema = z.object({
	idempotencyKey: z.string().min(1).max(200),
});
export const missionAutopilotTickResponseSchema = z.object({
	action: z.enum([
		"enqueue_approved_task",
		"sync_execution",
		"evaluate_completed_run",
		"create_replan_suggestion",
		"no_op",
		"stopped",
	]),
	reason: z.string().min(1),
	resultRef: z.unknown().nullable(),
});

export const syncMissionExecutionRequestSchema = z.object({
	idempotencyKey: z.string().min(1).max(200),
	missionTaskId: z.string().uuid().optional(),
});
export const syncMissionExecutionResponseSchema = z.object({
	missionTasks: z.array(missionTaskSchema),
	eventsAdded: z.number().int().nonnegative(),
});
export const evaluateMissionRequestSchema = syncMissionExecutionRequestSchema;
export const evaluateMissionResponseSchema = z.object({
	evaluations: z.array(missionEvaluationSchema),
	mission: missionSchema,
});

export const createMissionReplanSuggestionRequestSchema = z.object({
	idempotencyKey: z.string().min(1).max(200),
	evaluationId: z.string().uuid().optional(),
});
export const createMissionReplanSuggestionResponseSchema = z.object({
	suggestion: missionReplanSuggestionSchema,
	revision: missionPlanRevisionSchema,
});
export const applyMissionReplanRequestSchema = z.object({
	approvalId: z.string().uuid(),
	idempotencyKey: z.string().min(1).max(200),
});
export const applyMissionReplanResponseSchema = z.object({
	suggestion: missionReplanSuggestionSchema,
	revision: missionPlanRevisionSchema,
	planningResult: z.unknown(),
});
