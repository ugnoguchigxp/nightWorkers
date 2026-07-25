import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type {
	MissionPilotAnswerEvidence,
	MissionPilotAuthorization,
	MissionPilotPlanReview,
	MissionPilotPreQueueDiagnostic,
	MissionPilotQueueHandoff,
} from "../../shared/modules/missionPilot";
import type { DesignQuestionnaireAnswer } from "../../shared/schemas/design-questionnaire.schema";
import type { PlanModeRegenerationTarget } from "../../shared/schemas/plan-mode-artifact.schema";
import type {
	MissionPilotArtifactCorrectionStatus,
	PlanModeArtifactFocus,
} from "../../shared/schemas/plan-mode-artifact-correction.schema";
import type {
	PlanModeRoutingActor,
	PlanModeRoutingEntry,
} from "../../shared/schemas/plan-mode-routing.schema";
import { designQuestionnaireSessions } from "./design-questionnaire-schema";
import { repositories, taskMessages, taskRuns, tasks } from "./schema";

export const missionPilotSessions = sqliteTable(
	"mission_pilot_sessions",
	{
		id: text("id").primaryKey(),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		sourceKind: text("source_kind").notNull(),
		sourceId: text("source_id").notNull(),
		authorizationVersion: integer("authorization_version"),
		authorizationJson: text("authorization_json", {
			mode: "json",
		}).$type<MissionPilotAuthorization | null>(),
		desiredState: text("desired_state").notNull().default("stopped"),
		phase: text("phase").notNull().default("created"),
		resumePhase: text("resume_phase"),
		initialPromptSnapshot: text("initial_prompt_snapshot").notNull(),
		initialPromptState: text("initial_prompt_state")
			.notNull()
			.default("pending"),
		initialPromptMessageId: text("initial_prompt_message_id").references(
			() => taskMessages.id,
			{ onDelete: "set null" },
		),
		activeRunId: text("active_run_id").references(() => taskRuns.id, {
			onDelete: "set null",
		}),
		activePhaseRunId: text("active_phase_run_id"),
		activeVerificationSnapshotId: text("active_verification_snapshot_id"),
		activeReviewDecisionId: text("active_review_decision_id"),
		activeCloseoutId: text("active_closeout_id"),
		implementationCycle: integer("implementation_cycle").notNull().default(1),
		reviewCycle: integer("review_cycle").notNull().default(0),
		totalCorrectionCycle: integer("total_correction_cycle")
			.notNull()
			.default(0),
		version: integer("version").notNull().default(0),
		contextRevision: integer("context_revision").notNull().default(1),
		contextDigest: text("context_digest").notNull(),
		planRoutingRevision: integer("plan_routing_revision").notNull().default(0),
		nextWakeAt: integer("next_wake_at", { mode: "timestamp" }),
		leaseOwner: text("lease_owner"),
		leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp" }),
		lastErrorCode: text("last_error_code"),
		lastErrorMessage: text("last_error_message"),
		queueHandoffJson: text("queue_handoff_json", {
			mode: "json",
		}).$type<MissionPilotQueueHandoff | null>(),
		preQueueDiagnosticJson: text("pre_queue_diagnostic_json", {
			mode: "json",
		}).$type<MissionPilotPreQueueDiagnostic | null>(),
		startedAt: integer("started_at", { mode: "timestamp" }),
		stoppedAt: integer("stopped_at", { mode: "timestamp" }),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		taskUidx: uniqueIndex("mission_pilot_sessions_task_uidx").on(table.taskId),
		sourceUidx: uniqueIndex("mission_pilot_sessions_source_uidx").on(
			table.sourceKind,
			table.sourceId,
		),
		repositoryStateIdx: index("mission_pilot_sessions_repository_state_idx").on(
			table.repositoryId,
			table.desiredState,
			table.updatedAt,
		),
		leaseIdx: index("mission_pilot_sessions_lease_idx").on(
			table.leaseExpiresAt,
		),
	}),
);

export const missionPilotPlanRoutingRevisions = sqliteTable(
	"mission_pilot_plan_routing_revisions",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => missionPilotSessions.id, { onDelete: "cascade" }),
		revision: integer("revision").notNull(),
		entriesJson: text("entries_json", { mode: "json" })
			.$type<PlanModeRoutingEntry[]>()
			.notNull(),
		updatedBy: text("updated_by").$type<PlanModeRoutingActor>().notNull(),
		reason: text("reason").notNull(),
		idempotencyKey: text("idempotency_key"),
		requestHash: text("request_hash"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		revisionUidx: uniqueIndex(
			"mission_pilot_plan_routing_revisions_revision_uidx",
		).on(table.sessionId, table.revision),
		idempotencyUidx: uniqueIndex(
			"mission_pilot_plan_routing_revisions_idempotency_uidx",
		).on(table.sessionId, table.idempotencyKey),
	}),
);

export const missionPilotContextSnapshots = sqliteTable(
	"mission_pilot_context_snapshots",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => missionPilotSessions.id, { onDelete: "cascade" }),
		revision: integer("revision").notNull(),
		reason: text("reason").notNull(),
		contextJson: text("context_json", { mode: "json" })
			.$type<Record<string, unknown>>()
			.notNull(),
		digest: text("digest").notNull(),
		tokenEstimate: integer("token_estimate").notNull().default(0),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		revisionUidx: uniqueIndex(
			"mission_pilot_context_snapshots_revision_uidx",
		).on(table.sessionId, table.revision),
	}),
);

export const missionPilotQuestionnaireDrafts = sqliteTable(
	"mission_pilot_questionnaire_drafts",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => missionPilotSessions.id, { onDelete: "cascade" }),
		questionnaireSessionId: text("questionnaire_session_id")
			.notNull()
			.references(() => designQuestionnaireSessions.id, {
				onDelete: "cascade",
			}),
		answersJson: text("answers_json", { mode: "json" })
			.$type<DesignQuestionnaireAnswer[]>()
			.notNull(),
		answerEvidenceJson: text("answer_evidence_json", { mode: "json" })
			.$type<Record<string, MissionPilotAnswerEvidence>>()
			.notNull(),
		state: text("state").notNull().default("waiting_user"),
		deadlineAt: integer("deadline_at", { mode: "timestamp" }).notNull(),
		version: integer("version").notNull().default(0),
		lastActionIdempotencyKey: text("last_action_idempotency_key"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		questionnaireUidx: uniqueIndex(
			"mission_pilot_questionnaire_drafts_questionnaire_uidx",
		).on(table.questionnaireSessionId),
		deadlineIdx: index("mission_pilot_questionnaire_drafts_deadline_idx").on(
			table.state,
			table.deadlineAt,
		),
	}),
);

export const missionPilotSteps = sqliteTable(
	"mission_pilot_steps",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => missionPilotSessions.id, { onDelete: "cascade" }),
		stepKey: text("step_key").notNull(),
		ordinal: integer("ordinal").notNull(),
		status: text("status").notNull().default("pending"),
		attempt: integer("attempt").notNull().default(0),
		contextRevision: integer("context_revision").notNull(),
		contextDigest: text("context_digest").notNull(),
		artifactMessageId: text("artifact_message_id").references(
			() => taskMessages.id,
			{ onDelete: "set null" },
		),
		evidenceJson: text("evidence_json", { mode: "json" })
			.$type<Record<string, unknown>>()
			.notNull(),
		lastError: text("last_error"),
		startedAt: integer("started_at", { mode: "timestamp" }),
		finishedAt: integer("finished_at", { mode: "timestamp" }),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		stepUidx: uniqueIndex("mission_pilot_steps_step_uidx").on(
			table.sessionId,
			table.stepKey,
		),
		statusIdx: index("mission_pilot_steps_status_idx").on(
			table.status,
			table.updatedAt,
		),
	}),
);

export const missionPilotPlanReviews = sqliteTable(
	"mission_pilot_plan_reviews",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => missionPilotSessions.id, { onDelete: "cascade" }),
		contextRevision: integer("context_revision").notNull(),
		contextDigest: text("context_digest").notNull(),
		routingRevision: integer("routing_revision").notNull().default(0),
		featurePlanMessageId: text("feature_plan_message_id")
			.notNull()
			.references(() => taskMessages.id, { onDelete: "cascade" }),
		attempt: integer("attempt").notNull(),
		verdict: text("verdict").notNull(),
		reviewJson: text("review_json", { mode: "json" })
			.$type<MissionPilotPlanReview>()
			.notNull(),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		attemptUidx: uniqueIndex("mission_pilot_plan_reviews_attempt_uidx").on(
			table.sessionId,
			table.attempt,
		),
		contextIdx: index("mission_pilot_plan_reviews_context_idx").on(
			table.sessionId,
			table.contextRevision,
		),
	}),
);

export const missionPilotArtifactCorrectionRuns = sqliteTable(
	"mission_pilot_artifact_correction_runs",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => missionPilotSessions.id, { onDelete: "cascade" }),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		planReviewId: text("plan_review_id")
			.notNull()
			.references(() => missionPilotPlanReviews.id, { onDelete: "cascade" }),
		ordinal: integer("ordinal").notNull(),
		target: text("target").$type<PlanModeRegenerationTarget>().notNull(),
		focusJson: text("focus_json", { mode: "json" })
			.$type<PlanModeArtifactFocus>()
			.notNull(),
		instruction: text("instruction").notNull(),
		preserveUnfocusedContent: integer("preserve_unfocused_content", {
			mode: "boolean",
		})
			.notNull()
			.default(true),
		sourceMessageId: text("source_message_id")
			.notNull()
			.references(() => taskMessages.id, { onDelete: "cascade" }),
		sourceContextRevision: integer("source_context_revision").notNull(),
		sourceContextDigest: text("source_context_digest").notNull(),
		status: text("status")
			.$type<MissionPilotArtifactCorrectionStatus>()
			.notNull()
			.default("pending"),
		dispatchKey: text("dispatch_key").notNull(),
		resultMessageId: text("result_message_id").references(
			() => taskMessages.id,
			{ onDelete: "set null" },
		),
		resultArtifactId: text("result_artifact_id"),
		outputContextRevision: integer("output_context_revision"),
		attempt: integer("attempt").notNull().default(0),
		lastError: text("last_error"),
		startedAt: integer("started_at", { mode: "timestamp" }),
		finishedAt: integer("finished_at", { mode: "timestamp" }),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		reviewOrdinalUidx: uniqueIndex(
			"mission_pilot_artifact_correction_runs_review_ordinal_uidx",
		).on(table.sessionId, table.planReviewId, table.ordinal),
		dispatchUidx: uniqueIndex(
			"mission_pilot_artifact_correction_runs_dispatch_uidx",
		).on(table.dispatchKey),
		statusIdx: index("mission_pilot_artifact_correction_runs_status_idx").on(
			table.status,
			table.updatedAt,
		),
	}),
);

export const missionPilotPhaseRuns = sqliteTable(
	"mission_pilot_phase_runs",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => missionPilotSessions.id, { onDelete: "cascade" }),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		phase: text("phase").notNull(),
		cycle: integer("cycle").notNull(),
		attempt: integer("attempt").notNull(),
		runId: text("run_id")
			.notNull()
			.references(() => taskRuns.id, { onDelete: "cascade" }),
		parentPhaseRunId: text("parent_phase_run_id"),
		inputContextRevision: integer("input_context_revision").notNull(),
		inputContextDigest: text("input_context_digest").notNull(),
		outputContextRevision: integer("output_context_revision"),
		status: text("status").notNull().default("starting"),
		verdict: text("verdict"),
		evidenceJson: text("evidence_json", { mode: "json" })
			.$type<Record<string, unknown>>()
			.notNull(),
		startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
		finishedAt: integer("finished_at", { mode: "timestamp" }),
	},
	(table) => ({
		runUidx: uniqueIndex("mission_pilot_phase_runs_run_uidx").on(table.runId),
		attemptUidx: uniqueIndex("mission_pilot_phase_runs_attempt_uidx").on(
			table.sessionId,
			table.phase,
			table.cycle,
			table.attempt,
		),
	}),
);

export const missionPilotVerificationSnapshots = sqliteTable(
	"mission_pilot_verification_snapshots",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => missionPilotSessions.id, { onDelete: "cascade" }),
		sourcePhaseRunId: text("source_phase_run_id")
			.notNull()
			.references(() => missionPilotPhaseRuns.id, { onDelete: "cascade" }),
		verificationDocumentId: text("verification_document_id").notNull(),
		contextRevision: integer("context_revision").notNull(),
		contextDigest: text("context_digest").notNull(),
		checklistDigest: text("checklist_digest").notNull(),
		requiredTotal: integer("required_total").notNull(),
		requiredComplete: integer("required_complete").notNull(),
		failedRequired: integer("failed_required").notNull(),
		unknownRequired: integer("unknown_required").notNull(),
		evidenceRunIdsJson: text("evidence_run_ids_json", { mode: "json" })
			.$type<string[]>()
			.notNull(),
		completionCheckEventId: text("completion_check_event_id").notNull(),
		changedPathsJson: text("changed_paths_json", { mode: "json" })
			.$type<string[]>()
			.notNull(),
		verdict: text("verdict").notNull(),
		snapshotJson: text("snapshot_json", { mode: "json" })
			.$type<Record<string, unknown>>()
			.notNull(),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		sourcePhaseRunUidx: uniqueIndex(
			"mission_pilot_verification_snapshots_source_phase_run_uidx",
		).on(table.sourcePhaseRunId),
	}),
);

export const missionPilotReviewDecisions = sqliteTable(
	"mission_pilot_review_decisions",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => missionPilotSessions.id, { onDelete: "cascade" }),
		reviewSessionId: text("review_session_id").notNull(),
		reviewPhaseRunId: text("review_phase_run_id")
			.notNull()
			.references(() => missionPilotPhaseRuns.id, { onDelete: "cascade" }),
		contextRevision: integer("context_revision").notNull(),
		contextDigest: text("context_digest").notNull(),
		verificationSnapshotId: text("verification_snapshot_id")
			.notNull()
			.references(() => missionPilotVerificationSnapshots.id, {
				onDelete: "restrict",
			}),
		targetManifestDigest: text("target_manifest_digest").notNull(),
		verdict: text("verdict").notNull(),
		blockingCount: integer("blocking_count").notNull(),
		warningCount: integer("warning_count").notNull(),
		infoCount: integer("info_count").notNull(),
		findingIdsJson: text("finding_ids_json", { mode: "json" })
			.$type<string[]>()
			.notNull(),
		decisionJson: text("decision_json", { mode: "json" })
			.$type<Record<string, unknown>>()
			.notNull(),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		phaseRunUidx: uniqueIndex(
			"mission_pilot_review_decisions_phase_run_uidx",
		).on(table.reviewPhaseRunId),
	}),
);

export const missionPilotCloseouts = sqliteTable(
	"mission_pilot_closeouts",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => missionPilotSessions.id, { onDelete: "cascade" }),
		attempt: integer("attempt").notNull(),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		baselineHead: text("baseline_head").notNull(),
		reviewDecisionId: text("review_decision_id")
			.notNull()
			.references(() => missionPilotReviewDecisions.id, {
				onDelete: "restrict",
			}),
		reviewedContextDigest: text("reviewed_context_digest").notNull(),
		ownedPhaseRunIdsJson: text("owned_phase_run_ids_json", { mode: "json" })
			.$type<string[]>()
			.notNull(),
		stageableOwnedPathsJson: text("stageable_owned_paths_json", {
			mode: "json",
		})
			.$type<string[]>()
			.notNull(),
		excludedPathsJson: text("excluded_paths_json", { mode: "json" })
			.$type<string[]>()
			.notNull(),
		status: text("status").notNull(),
		commitSha: text("commit_sha"),
		commitMessage: text("commit_message"),
		pushPolicy: text("push_policy").notNull(),
		pushStatus: text("push_status").notNull(),
		pushRemote: text("push_remote"),
		pushBranch: text("push_branch"),
		statusReason: text("status_reason"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		attemptUidx: uniqueIndex("mission_pilot_closeouts_attempt_uidx").on(
			table.sessionId,
			table.attempt,
		),
	}),
);

export const missionPilotEvents = sqliteTable(
	"mission_pilot_events",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => missionPilotSessions.id, { onDelete: "cascade" }),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		eventType: text("event_type").notNull(),
		phase: text("phase").notNull(),
		cycle: integer("cycle"),
		contextRevision: integer("context_revision").notNull(),
		contextDigest: text("context_digest").notNull(),
		dedupeKey: text("dedupe_key").notNull(),
		sourceKind: text("source_kind").notNull(),
		sourceId: text("source_id"),
		payloadJson: text("payload_json", { mode: "json" })
			.$type<Record<string, unknown>>()
			.notNull(),
		processStatus: text("process_status").notNull().default("pending"),
		attemptCount: integer("attempt_count").notNull().default(0),
		availableAt: integer("available_at", { mode: "timestamp" }).notNull(),
		processedAt: integer("processed_at", { mode: "timestamp" }),
		lastError: text("last_error"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		dedupeUidx: uniqueIndex("mission_pilot_events_dedupe_uidx").on(
			table.sessionId,
			table.dedupeKey,
		),
		pendingIdx: index("mission_pilot_events_pending_idx").on(
			table.processStatus,
			table.availableAt,
		),
	}),
);

export const taskArchiveRecords = sqliteTable(
	"task_archive_records",
	{
		id: text("id").primaryKey(),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		missionPilotSessionId: text("mission_pilot_session_id").references(
			() => missionPilotSessions.id,
			{ onDelete: "set null" },
		),
		sourceRunId: text("source_run_id").references(() => taskRuns.id, {
			onDelete: "set null",
		}),
		previousStatus: text("previous_status").notNull(),
		reason: text("reason").notNull(),
		evidenceJson: text("evidence_json", { mode: "json" })
			.$type<Record<string, unknown>>()
			.notNull(),
		archivedAt: integer("archived_at", { mode: "timestamp" }).notNull(),
		restoredAt: integer("restored_at", { mode: "timestamp" }),
		restoredToStatus: text("restored_to_status"),
		restoredBy: text("restored_by"),
	},
	(table) => ({
		taskIdx: index("task_archive_records_task_idx").on(
			table.taskId,
			table.archivedAt,
		),
	}),
);
