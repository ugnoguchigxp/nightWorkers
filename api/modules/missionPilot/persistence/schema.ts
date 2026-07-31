import type { MissionPilotAuthorization } from "@nightworkers/mission-pilot/contracts";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
	repositories,
	taskMessages,
	taskRuns,
	tasks,
} from "../../../db/schema";

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
		version: integer("version").notNull().default(0),
		contextRevision: integer("context_revision").notNull().default(1),
		contextDigest: text("context_digest").notNull(),
		nextWakeAt: integer("next_wake_at", { mode: "timestamp" }),
		leaseOwner: text("lease_owner"),
		leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp" }),
		lastErrorCode: text("last_error_code"),
		lastErrorMessage: text("last_error_message"),
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
