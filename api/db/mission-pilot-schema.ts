import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
	missionPlanningResults,
	missions,
	missionTaskProposals,
} from "./mission-planner-schema";
import {
	implementationQueueEntries,
	repositories,
	taskRuns,
	tasks,
} from "./schema";

const missionPilotCommonColumns = {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	createdAt: integer("created_at", { mode: "timestamp" })
		.$defaultFn(() => new Date())
		.notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" })
		.$defaultFn(() => new Date())
		.$onUpdateFn(() => new Date())
		.notNull(),
};

export const missionObjectives = sqliteTable(
	"mission_objectives",
	{
		...missionPilotCommonColumns,
		missionId: text("mission_id")
			.notNull()
			.references(() => missions.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		planningResultId: text("planning_result_id")
			.notNull()
			.references(() => missionPlanningResults.id, { onDelete: "cascade" }),
		externalObjectiveId: text("external_objective_id").notNull(),
		title: text("title").notNull(),
		completionCriteriaJson: text("completion_criteria_json", {
			mode: "json",
		}).notNull(),
		verificationGateJson: text("verification_gate_json", {
			mode: "json",
		}).notNull(),
		status: text("status").default("pending").notNull(),
		evidenceRefsJson: text("evidence_refs_json", { mode: "json" })
			.default("[]")
			.notNull(),
		statusReason: text("status_reason"),
	},
	(table) => ({
		planningExternalUniqueIdx: uniqueIndex(
			"mission_objectives_planning_external_uidx",
		).on(table.planningResultId, table.externalObjectiveId),
		missionStatusCreatedIdx: index(
			"mission_objectives_mission_status_created_idx",
		).on(table.missionId, table.status, table.createdAt),
		repositoryStatusIdx: index("mission_objectives_repository_status_idx").on(
			table.repositoryId,
			table.status,
		),
	}),
);

export const missionEvents = sqliteTable(
	"mission_events",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		missionId: text("mission_id")
			.notNull()
			.references(() => missions.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		missionTaskId: text("mission_task_id"),
		eventType: text("event_type").notNull(),
		summary: text("summary").notNull(),
		actorJson: text("actor_json", { mode: "json" }).notNull(),
		payloadJson: text("payload_json", { mode: "json" }),
		evidenceRefsJson: text("evidence_refs_json", { mode: "json" })
			.default("[]")
			.notNull(),
		sourceKind: text("source_kind").notNull(),
		sourceId: text("source_id").notNull(),
		sourceVersion: text("source_version").default("1").notNull(),
		occurredAt: integer("occurred_at", { mode: "timestamp" }).notNull(),
		createdAt: integer("created_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
	},
	(table) => ({
		sourceUniqueIdx: uniqueIndex("mission_events_source_uidx").on(
			table.missionId,
			table.eventType,
			table.sourceKind,
			table.sourceId,
			table.sourceVersion,
		),
		missionOccurredIdx: index("mission_events_mission_occurred_idx").on(
			table.missionId,
			table.occurredAt,
			table.createdAt,
		),
		missionTaskOccurredIdx: index(
			"mission_events_mission_task_occurred_idx",
		).on(table.missionTaskId, table.occurredAt),
	}),
);

export const pilotActions = sqliteTable(
	"pilot_actions",
	{
		...missionPilotCommonColumns,
		missionId: text("mission_id")
			.notNull()
			.references(() => missions.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		targetType: text("target_type"),
		targetId: text("target_id"),
		type: text("type").notNull(),
		status: text("status").default("started").notNull(),
		idempotencyKey: text("idempotency_key").notNull(),
		requestHash: text("request_hash").notNull(),
		reason: text("reason").notNull(),
		actorJson: text("actor_json", { mode: "json" }).notNull(),
		evidenceRefsJson: text("evidence_refs_json", { mode: "json" })
			.default("[]")
			.notNull(),
		resultRefJson: text("result_ref_json", { mode: "json" }),
		nextIfSucceeded: text("next_if_succeeded"),
		nextIfFailed: text("next_if_failed"),
		requiresHumanAttention: integer("requires_human_attention", {
			mode: "boolean",
		})
			.default(false)
			.notNull(),
		errorCode: text("error_code"),
		errorMessage: text("error_message"),
		startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
		completedAt: integer("completed_at", { mode: "timestamp" }),
	},
	(table) => ({
		missionTypeKeyUniqueIdx: uniqueIndex(
			"pilot_actions_mission_type_key_uidx",
		).on(table.missionId, table.type, table.idempotencyKey),
		missionStatusCreatedIdx: index(
			"pilot_actions_mission_status_created_idx",
		).on(table.missionId, table.status, table.createdAt),
		targetCreatedIdx: index("pilot_actions_target_created_idx").on(
			table.targetType,
			table.targetId,
			table.createdAt,
		),
	}),
);

export const missionApprovals = sqliteTable(
	"mission_approvals",
	{
		...missionPilotCommonColumns,
		missionId: text("mission_id")
			.notNull()
			.references(() => missions.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		targetType: text("target_type").notNull(),
		targetId: text("target_id").notNull(),
		approvalType: text("approval_type").notNull(),
		status: text("status").default("requested").notNull(),
		riskLevel: text("risk_level").notNull(),
		approvalRequired: integer("approval_required", {
			mode: "boolean",
		}).notNull(),
		requestedReason: text("requested_reason").notNull(),
		requestedByActorJson: text("requested_by_actor_json", {
			mode: "json",
		}).notNull(),
		decidedByActorJson: text("decided_by_actor_json", { mode: "json" }),
		decisionReason: text("decision_reason"),
		snapshotJson: text("snapshot_json", { mode: "json" }).notNull(),
		snapshotHash: text("snapshot_hash").notNull(),
		requestedAt: integer("requested_at", { mode: "timestamp" }).notNull(),
		decidedAt: integer("decided_at", { mode: "timestamp" }),
		expiresAt: integer("expires_at", { mode: "timestamp" }),
	},
	(table) => ({
		missionStatusCreatedIdx: index(
			"mission_approvals_mission_status_created_idx",
		).on(table.missionId, table.status, table.createdAt),
		targetTypeStatusIdx: index("mission_approvals_target_type_status_idx").on(
			table.targetType,
			table.targetId,
			table.approvalType,
			table.status,
		),
		hashStatusIdx: index("mission_approvals_hash_status_idx").on(
			table.snapshotHash,
			table.status,
		),
		openSnapshotUniqueIdx: uniqueIndex("mission_approvals_open_snapshot_uidx")
			.on(
				table.missionId,
				table.targetType,
				table.targetId,
				table.approvalType,
				table.snapshotHash,
			)
			.where(sql`${table.status} = 'requested'`),
	}),
);

export const missionAttentionItems = sqliteTable(
	"mission_attention_items",
	{
		...missionPilotCommonColumns,
		missionId: text("mission_id")
			.notNull()
			.references(() => missions.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		targetType: text("target_type").notNull(),
		targetId: text("target_id").notNull(),
		type: text("type").notNull(),
		status: text("status").default("open").notNull(),
		severity: text("severity").notNull(),
		title: text("title").notNull(),
		summary: text("summary").notNull(),
		actionSchemaJson: text("action_schema_json", { mode: "json" }).notNull(),
		evidenceRefsJson: text("evidence_refs_json", { mode: "json" })
			.default("[]")
			.notNull(),
		sourceEventId: text("source_event_id").references(() => missionEvents.id, {
			onDelete: "set null",
		}),
		sourceRefJson: text("source_ref_json", { mode: "json" }),
		resolvedByActorJson: text("resolved_by_actor_json", { mode: "json" }),
		resolvedAt: integer("resolved_at", { mode: "timestamp" }),
	},
	(table) => ({
		missionStatusCreatedIdx: index(
			"mission_attention_mission_status_created_idx",
		).on(table.missionId, table.status, table.createdAt),
		targetStatusIdx: index("mission_attention_target_status_idx").on(
			table.targetType,
			table.targetId,
			table.status,
		),
	}),
);

export const missionTasks = sqliteTable(
	"mission_tasks",
	{
		...missionPilotCommonColumns,
		missionId: text("mission_id")
			.notNull()
			.references(() => missions.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		planningResultId: text("planning_result_id")
			.notNull()
			.references(() => missionPlanningResults.id, { onDelete: "restrict" }),
		taskCandidateId: text("task_candidate_id")
			.notNull()
			.references(() => missionTaskProposals.id, { onDelete: "restrict" }),
		objectiveIdsJson: text("objective_ids_json", { mode: "json" }).notNull(),
		nightworkersTaskId: text("nightworkers_task_id").references(
			() => tasks.id,
			{ onDelete: "set null" },
		),
		queueEntryId: text("queue_entry_id").references(
			() => implementationQueueEntries.id,
			{ onDelete: "set null" },
		),
		activeRunId: text("active_run_id").references(() => taskRuns.id, {
			onDelete: "set null",
		}),
		approvalId: text("approval_id")
			.notNull()
			.references(() => missionApprovals.id, { onDelete: "restrict" }),
		approvalSnapshotHash: text("approval_snapshot_hash").notNull(),
		title: text("title").notNull(),
		purpose: text("purpose").notNull(),
		status: text("status").default("approved").notNull(),
		riskLevel: text("risk_level").notNull(),
		approvalRequired: integer("approval_required", {
			mode: "boolean",
		}).notNull(),
		dependenciesJson: text("dependencies_json", { mode: "json" }).notNull(),
		verificationGateJson: text("verification_gate_json", {
			mode: "json",
		}).notNull(),
		schedulingJson: text("scheduling_json", { mode: "json" }).notNull(),
		lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
	},
	(table) => ({
		candidateUniqueIdx: uniqueIndex("mission_tasks_candidate_uidx").on(
			table.taskCandidateId,
		),
		nightworkersTaskUniqueIdx: uniqueIndex(
			"mission_tasks_nightworkers_task_uidx",
		).on(table.nightworkersTaskId),
		missionStatusCreatedIdx: index(
			"mission_tasks_mission_status_created_idx",
		).on(table.missionId, table.status, table.createdAt),
		queueEntryIdx: index("mission_tasks_queue_entry_idx").on(
			table.queueEntryId,
		),
		activeRunIdx: index("mission_tasks_active_run_idx").on(table.activeRunId),
	}),
);

export const missionAutopilotGrants = sqliteTable(
	"mission_autopilot_grants",
	{
		...missionPilotCommonColumns,
		missionId: text("mission_id")
			.notNull()
			.references(() => missions.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		autonomyLevel: integer("autonomy_level").notNull(),
		allowedActionsJson: text("allowed_actions_json", {
			mode: "json",
		}).notNull(),
		status: text("status").default("active").notNull(),
		grantedByActorJson: text("granted_by_actor_json", {
			mode: "json",
		}).notNull(),
		expiresAt: integer("expires_at", { mode: "timestamp" }),
		pausedAt: integer("paused_at", { mode: "timestamp" }),
		revokedAt: integer("revoked_at", { mode: "timestamp" }),
	},
	(table) => ({
		missionStatusIdx: index("mission_autopilot_grants_mission_status_idx").on(
			table.missionId,
			table.status,
			table.createdAt,
		),
		activeMissionUniqueIdx: uniqueIndex(
			"mission_autopilot_grants_active_mission_uidx",
		)
			.on(table.missionId)
			.where(sql`${table.status} = 'active'`),
	}),
);

export const missionEvaluations = sqliteTable(
	"mission_evaluations",
	{
		...missionPilotCommonColumns,
		missionId: text("mission_id")
			.notNull()
			.references(() => missions.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		scopeType: text("scope_type").notNull(),
		scopeId: text("scope_id").notNull(),
		missionTaskId: text("mission_task_id").references(() => missionTasks.id, {
			onDelete: "set null",
		}),
		runId: text("run_id").references(() => taskRuns.id, {
			onDelete: "set null",
		}),
		result: text("result").notNull(),
		summary: text("summary").notNull(),
		objectiveUpdatesJson: text("objective_updates_json", {
			mode: "json",
		}).notNull(),
		evidenceRefsJson: text("evidence_refs_json", { mode: "json" }).notNull(),
		inputDigest: text("input_digest").notNull(),
		nextRecommendedAction: text("next_recommended_action").notNull(),
		createdByActorJson: text("created_by_actor_json", {
			mode: "json",
		}).notNull(),
	},
	(table) => ({
		scopeDigestUniqueIdx: uniqueIndex(
			"mission_evaluations_scope_digest_uidx",
		).on(table.missionId, table.scopeType, table.scopeId, table.inputDigest),
		missionCreatedIdx: index("mission_evaluations_mission_created_idx").on(
			table.missionId,
			table.createdAt,
		),
		runIdx: index("mission_evaluations_run_idx").on(table.runId),
	}),
);

export const missionPlanRevisions = sqliteTable(
	"mission_plan_revisions",
	{
		...missionPilotCommonColumns,
		missionId: text("mission_id")
			.notNull()
			.references(() => missions.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		baseRevisionId: text("base_revision_id"),
		planningResultId: text("planning_result_id")
			.notNull()
			.references(() => missionPlanningResults.id, { onDelete: "restrict" }),
		revisionNumber: integer("revision_number").notNull(),
		summary: text("summary").notNull(),
		taskGraphJson: text("task_graph_json", { mode: "json" }).notNull(),
		appliedDiffJson: text("applied_diff_json", { mode: "json" }),
		createdByActorJson: text("created_by_actor_json", {
			mode: "json",
		}).notNull(),
	},
	(table) => ({
		missionRevisionUniqueIdx: uniqueIndex(
			"mission_plan_revisions_mission_revision_uidx",
		).on(table.missionId, table.revisionNumber),
		missionPlanningUniqueIdx: uniqueIndex(
			"mission_plan_revisions_mission_planning_uidx",
		).on(table.missionId, table.planningResultId),
	}),
);

export const missionReplanSuggestions = sqliteTable(
	"mission_replan_suggestions",
	{
		...missionPilotCommonColumns,
		missionId: text("mission_id")
			.notNull()
			.references(() => missions.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		baseRevisionId: text("base_revision_id")
			.notNull()
			.references(() => missionPlanRevisions.id, { onDelete: "restrict" }),
		sourceEvaluationId: text("source_evaluation_id")
			.notNull()
			.references(() => missionEvaluations.id, { onDelete: "restrict" }),
		status: text("status").default("draft").notNull(),
		reason: text("reason").notNull(),
		taskGraphDiffJson: text("task_graph_diff_json", { mode: "json" }).notNull(),
		diffHash: text("diff_hash").notNull(),
		approvalId: text("approval_id").references(() => missionApprovals.id, {
			onDelete: "set null",
		}),
	},
	(table) => ({
		evaluationDiffUniqueIdx: uniqueIndex(
			"mission_replan_suggestions_evaluation_diff_uidx",
		).on(table.missionId, table.sourceEvaluationId, table.diffHash),
		missionStatusCreatedIdx: index(
			"mission_replan_suggestions_mission_status_created_idx",
		).on(table.missionId, table.status, table.createdAt),
	}),
);
