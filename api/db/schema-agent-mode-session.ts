import { sql } from "drizzle-orm";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { commonColumns } from "./schema-base";

export const agentModeSessions = sqliteTable(
	"agent_mode_sessions",
	{
		...commonColumns,
		taskId: text("task_id").notNull(),
		repositoryId: text("repository_id").notNull(),
		epoch: integer("epoch").notNull(),
		predecessorSessionId: text("predecessor_session_id"),
		executionMode: text("execution_mode").notNull(),
		llmRole: text("llm_role").notNull(),
		runtimeLane: text("runtime_lane").notNull(),
		provider: text("provider"),
		providerEndpointId: text("provider_endpoint_id"),
		model: text("model"),
		thinkingDepth: text("thinking_depth"),
		routeFingerprint: text("route_fingerprint").notNull(),
		status: text("status").notNull(),
		closeReason: text("close_reason"),
		openedAt: integer("opened_at", { mode: "timestamp" }).notNull(),
		closedAt: integer("closed_at", { mode: "timestamp" }),
	},
	(table) => ({
		taskEpochUniqueIdx: uniqueIndex("agent_mode_sessions_task_epoch_uidx").on(
			table.taskId,
			table.epoch,
		),
		activeTaskUniqueIdx: uniqueIndex("agent_mode_sessions_active_task_uidx")
			.on(table.taskId)
			.where(sql`status = 'active'`),
		taskStatusUpdatedIdx: index(
			"agent_mode_sessions_task_status_updated_idx",
		).on(table.taskId, table.status, table.updatedAt),
		predecessorIdx: index("agent_mode_sessions_predecessor_idx").on(
			table.predecessorSessionId,
		),
	}),
);
