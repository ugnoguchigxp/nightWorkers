import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { agentModeSessions, taskRuns } from "../../../db/schema";

export type CodingAgentRunExecutionStatus =
	| "active"
	| "interrupted"
	| "released";
export type CodingAgentRunExecutionOwnerKind = "api_process" | "worker_process";
export type CodingAgentRunInterruptionReason =
	| "graceful_shutdown"
	| "process_restarted"
	| "worker_lost";

export const codingAgentRunExecutions = sqliteTable(
	"coding_agent_run_executions",
	{
		runId: text("run_id")
			.primaryKey()
			.references(() => taskRuns.id, { onDelete: "cascade" }),
		agentModeSessionId: text("agent_mode_session_id")
			.notNull()
			.references(() => agentModeSessions.id, { onDelete: "cascade" }),
		status: text("status").$type<CodingAgentRunExecutionStatus>().notNull(),
		ownerKind: text("owner_kind")
			.$type<CodingAgentRunExecutionOwnerKind>()
			.notNull(),
		ownerInstanceId: text("owner_instance_id").notNull(),
		ownerPid: integer("owner_pid"),
		leaseVersion: integer("lease_version").default(1).notNull(),
		acquiredAt: integer("acquired_at", { mode: "timestamp" }).notNull(),
		heartbeatAt: integer("heartbeat_at", { mode: "timestamp" }).notNull(),
		leaseExpiresAt: integer("lease_expires_at", {
			mode: "timestamp",
		}).notNull(),
		interruptionRevision: integer("interruption_revision").default(0).notNull(),
		interruptionReason: text(
			"interruption_reason",
		).$type<CodingAgentRunInterruptionReason | null>(),
		interruptionSnapshotJson: text("interruption_snapshot_json", {
			mode: "json",
		}).$type<Record<string, unknown> | null>(),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		ownerStatusIdx: index("coding_agent_run_executions_owner_status_idx").on(
			table.ownerKind,
			table.ownerInstanceId,
			table.status,
		),
		statusLeaseIdx: index("coding_agent_run_executions_status_lease_idx").on(
			table.status,
			table.leaseExpiresAt,
		),
		sessionIdx: index("coding_agent_run_executions_session_idx").on(
			table.agentModeSessionId,
		),
	}),
);
