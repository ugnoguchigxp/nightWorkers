import { z } from "@hono/zod-openapi";

const jsonValueSchema = z.unknown();
const dateLikeSchema = z.union([z.string(), z.date()]);

export const taskRunStatusSchema = z.enum([
	"ready",
	"queued",
	"running",
	"context_compiling",
	"finalizing",
	"verifying",
	"completed",
	"failed",
	"cancelled",
	"needs_review",
	"blocked",
	"timed_out",
	"needs_human",
]);

export const taskRunCommitRecordSchema = z
	.object({
		id: z.string().uuid(),
		runId: z.string().uuid(),
		repositoryId: z.string().uuid(),
		status: z.enum([
			"not_requested",
			"pending",
			"ready",
			"committed",
			"needs_human",
			"failed",
		]),
		baselineHead: z.string().nullable().optional(),
		baselineStatusJson: jsonValueSchema.nullable().optional(),
		preExistingDirtyPathsJson: z.array(z.string()).nullable().optional(),
		ownedCandidatePathsJson: z.array(z.string()).nullable().optional(),
		stageableOwnedPathsJson: z.array(z.string()).nullable().optional(),
		excludedPathsJson: z
			.array(z.object({ path: z.string(), reason: z.string() }))
			.nullable()
			.optional(),
		verificationStatus: z.enum(["not_run", "passed", "failed", "partial"]),
		verificationEvidenceJson: jsonValueSchema.nullable().optional(),
		commitSha: z.string().nullable().optional(),
		commitMessage: z.string().nullable().optional(),
		pushStatus: z
			.enum(["not_pushed", "pushing", "pushed", "failed", "blocked"])
			.nullable()
			.optional(),
		pushedAt: dateLikeSchema.nullable().optional(),
		pushRemote: z.string().nullable().optional(),
		pushBranch: z.string().nullable().optional(),
		statusReason: z.string().nullable().optional(),
		createdAt: dateLikeSchema,
		updatedAt: dateLikeSchema,
	})
	.openapi("TaskRunCommitRecord");

export const taskRunMergeRecordSchema = z.object({
	id: z.string().uuid(),
	runId: z.string().uuid(),
	taskId: z.string().uuid(),
	repositoryId: z.string().uuid(),
	workspaceId: z.string().uuid(),
	sourceBranch: z.string(),
	sourceCommitSha: z.string(),
	planTargetBranch: z.string(),
	planTargetBaseSha: z.string(),
	targetBranch: z.string(),
	targetSelectedSha: z.string(),
	observedTargetSha: z.string().nullable().optional(),
	strategy: z.enum(["merge_commit", "squash", "fast_forward_only"]),
	decision: z.enum(["undecided", "merge", "defer", "rework"]),
	status: z.enum([
		"decision_required",
		"previewing",
		"merge_ready",
		"merging",
		"merged",
		"deferred",
		"rework_requested",
		"merge_blocked",
		"merge_conflicted",
		"failed",
	]),
	recordVersion: z.number().int().nonnegative(),
	ciStatus: z.enum([
		"not_required",
		"pending",
		"passed",
		"failed",
		"unavailable",
	]),
	mergeOrigin: z
		.enum(["local", "already_ancestor", "provider"])
		.nullable()
		.optional(),
	mergeCommitSha: z.string().nullable().optional(),
	targetHeadAfter: z.string().nullable().optional(),
	targetPushStatus: z
		.enum([
			"not_started",
			"pushing",
			"pushed",
			"failed",
			"blocked",
			"not_required",
		])
		.nullable()
		.optional(),
	targetPushedAt: dateLikeSchema.nullable().optional(),
	lastErrorCode: z.string().nullable().optional(),
	lastErrorMessage: z.string().nullable().optional(),
	createdAt: dateLikeSchema,
	updatedAt: dateLikeSchema,
});

export const gitCloseoutBlockingCodeSchema = z
	.enum([
		"RUN_NOT_FOUND",
		"REPOSITORY_NOT_FOUND",
		"REVIEW_SESSION_MISSING",
		"REQUIRED_REVIEW_NOT_DONE",
		"REVIEW_RUN_NOT_STARTED",
		"REVIEW_RUN_IN_PROGRESS",
		"REVIEW_RUN_NOT_SUCCESSFUL",
		"TEST_EVIDENCE_MISSING",
		"TEST_EVIDENCE_INCOMPLETE",
		"TEST_EVIDENCE_FAILED",
		"TEST_EVIDENCE_STALE",
		"SECURITY_EVIDENCE_MISSING",
		"SECURITY_GATE_BLOCKED",
		"BLOCKING_FINDINGS_UNRESOLVED",
		"COMMIT_RECORD_MISSING",
		"COMMIT_RECORD_NOT_READY",
		"NO_STAGEABLE_PATHS",
		"HEAD_MOVED",
		"DIRTY_PATHS_MISSING",
		"STAGED_PATHS_OUTSIDE_OWNERSHIP",
		"COMMIT_ALREADY_CREATED",
		"UPSTREAM_MISSING",
		"PUSH_HEAD_MISMATCH",
		"PUSH_POLICY_BLOCKED",
		"GIT_COMMAND_FAILED",
	])
	.openapi("GitCloseoutBlockingCode");

export const gitCloseoutUiStateSchema = z
	.enum([
		"review_required",
		"commit_ready",
		"commit_running",
		"committed",
		"push_ready",
		"push_running",
		"pushed",
		"needs_human",
		"failed",
		"integration_decision_required",
		"merge_preview_running",
		"merge_ready",
		"merge_running",
		"merged",
		"integration_deferred",
		"rework_requested",
		"merge_blocked",
		"merge_conflicted",
	])
	.openapi("GitCloseoutUiState");

export const gitCloseoutStateSchema = z
	.object({
		runId: z.string().uuid(),
		repositoryId: z.string().uuid(),
		canCommit: z.boolean(),
		canPush: z.boolean(),
		state: gitCloseoutUiStateSchema,
		blockingCode: gitCloseoutBlockingCodeSchema.nullable(),
		blockingReason: z.string().nullable(),
		nextAction: z.string().nullable(),
		commitRecord: taskRunCommitRecordSchema.nullable(),
		mergeRecord: taskRunMergeRecordSchema.nullable(),
		requiredReview: z.object({
			reviewSessionId: z.string().uuid().nullable(),
			testCoverageStatus: z
				.enum([
					"not_started",
					"running",
					"done",
					"blocked",
					"needs_human",
					"failed",
				])
				.nullable(),
			reviewRunStatus: z
				.enum([
					"not_started",
					"running",
					"done",
					"blocked",
					"needs_human",
					"failed",
				])
				.nullable()
				.optional(),
			complete: z.boolean(),
		}),
		evidence: z
			.object({
				review: z.object({
					source: z.enum(["review_run", "legacy_test_coverage", "missing"]),
					status: z.enum([
						"not_started",
						"running",
						"done",
						"blocked",
						"needs_human",
						"failed",
					]),
					reviewRunId: z.string().nullable(),
					completedAt: z.string().nullable(),
				}),
				test: z.object({
					source: z.enum([
						"mission_pilot_snapshot",
						"verification_checklist",
						"legacy_test_coverage",
						"missing",
					]),
					status: z.enum([
						"passed",
						"missing",
						"incomplete",
						"failed",
						"stale",
					]),
					verificationDocumentId: z.string().nullable(),
					evidenceRunIds: z.array(z.string()),
					completionCheckEventId: z.string().nullable(),
					reason: z.string().nullable(),
				}),
				security: z.object({
					source: z.enum(["security_oracle", "policy_skip", "missing"]),
					status: z.enum(["passed", "skipped", "blocked", "failed", "missing"]),
					scanRunId: z.string().nullable(),
					eventId: z.string().nullable(),
					reason: z.string().nullable(),
				}),
				findings: z.object({
					unresolvedBlockingIds: z.array(z.string()),
				}),
			})
			.nullable(),
		git: z.object({
			head: z.string().nullable(),
			branch: z.string().nullable(),
			upstream: z.string().nullable(),
			dirtyPaths: z.array(z.string()),
			stagedPaths: z.array(z.string()),
		}),
		counts: z.object({
			stageablePaths: z.number().int().nonnegative(),
			excludedPaths: z.number().int().nonnegative(),
		}),
	})
	.openapi("GitCloseoutState");

export const commitRunCloseoutRequestSchema = z
	.object({
		message: z.string().min(1).max(240).optional(),
	})
	.openapi("CommitRunCloseoutRequest");

export const taskRunSchema = z
	.object({
		id: z.string().uuid(),
		taskId: z.string().uuid(),
		repositoryId: z.string().uuid().nullable().optional(),
		status: taskRunStatusSchema,
		workerKind: z.string(),
		baseRef: z.string().nullable().optional(),
		worktreePath: z.string().nullable().optional(),
		timeoutSeconds: z.number(),
		contextSnapshot: jsonValueSchema.nullable().optional(),
		summary: z.string().nullable().optional(),
		finalReport: z.string().nullable().optional(),
		finalJudgment: jsonValueSchema.nullable().optional(),
		startedAt: dateLikeSchema,
		endedAt: dateLikeSchema.nullable().optional(),
		finishedAt: dateLikeSchema.nullable().optional(),
		logContent: z.string().nullable().optional(),
		diffPatch: z.string().nullable().optional(),
		testResults: jsonValueSchema.nullable().optional(),
		createdAt: dateLikeSchema,
		updatedAt: dateLikeSchema,
	})
	.openapi("TaskRun");

export const ontologyRunDebugReportSchema = z
	.object({
		runId: z.string().uuid(),
		taskId: z.string().uuid(),
		repositoryId: z.string().uuid().nullable().optional(),
		status: z.string(),
		runtimeLane: z.string().nullable(),
		ontologyContext: jsonValueSchema.nullable(),
		ontologyBoundaryAudit: jsonValueSchema.nullable(),
		evidenceSources: z.object({
			contextSnapshot: z.boolean(),
			runtimeContextEvent: z.boolean(),
			boundaryAuditEvent: z.boolean(),
		}),
		summary: z.object({
			available: z.boolean(),
			primaryModule: z.string().nullable(),
			secondaryModules: z.array(z.string()),
			taskGenerationEvidence: z.boolean(),
			boundaryDecision: z.string().nullable(),
			touchedFilesCount: z.number().int().nonnegative(),
			unexplainedCrossingsCount: z.number().int().nonnegative(),
			focusedVerificationCount: z.number().int().nonnegative(),
			focusedVerificationState: z.enum([
				"passed",
				"failed",
				"selected",
				"not_selected",
				"unavailable",
			]),
		}),
		warnings: z.array(z.string()),
	})
	.openapi("OntologyRunDebugReport");

export const taskTypeSchema = z.string().min(1);

export const todoStatusSchema = z.enum([
	"pending",
	"running",
	"passed",
	"failed",
	"skipped",
	"needs_human",
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
		procedureSnapshot: jsonValueSchema.nullable().optional(),
		contextSnapshot: jsonValueSchema.nullable().optional(),
		completionGateResult: jsonValueSchema.nullable().optional(),
		dependsOn: z
			.array(z.union([z.string(), z.number()]))
			.nullable()
			.optional(),
		statusReason: z.string().nullable().optional(),
		startedAt: dateLikeSchema.nullable().optional(),
		completedAt: dateLikeSchema.nullable().optional(),
		createdAt: dateLikeSchema,
		updatedAt: dateLikeSchema,
	})
	.openapi("TaskRunTodo");

export const runtimePromptSnapshotSchema = z
	.object({
		compiledPrompt: z.string(),
		source: z.enum(["task_prompt", "fallback"]),
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
		}),
	})
	.openapi("RuntimePromptSnapshot");
