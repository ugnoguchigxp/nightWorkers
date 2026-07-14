import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { agentModeSessions } from "./schema-agent-mode-session";
import { commonColumns, repositories, tasks } from "./schema-base";
import { taskRuns } from "./schema-task-execution";

export const runtimeSessionStates = sqliteTable(
	"runtime_session_states",
	{
		...commonColumns,
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id").references(() => repositories.id, {
			onDelete: "cascade",
		}),
		runId: text("run_id").references(() => taskRuns.id, {
			onDelete: "set null",
		}),
		agentModeSessionId: text("agent_mode_session_id").references(
			() => agentModeSessions.id,
			{ onDelete: "set null" },
		),
		runtimeLane: text("runtime_lane").notNull(),
		provider: text("provider").notNull(),
		providerSessionId: text("provider_session_id"),
		executionMode: text("execution_mode"),
		model: text("model"),
		status: text("status").notNull(),
		lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull(),
		metadataJson: text("metadata_json", { mode: "json" }),
	},
	(table) => ({
		lookupIdx: index("runtime_session_states_lookup_idx").on(
			table.taskId,
			table.repositoryId,
			table.runtimeLane,
			table.provider,
			table.executionMode,
			table.status,
			table.lastSeenAt,
		),
		runIdx: index("runtime_session_states_run_idx").on(table.runId),
		agentModeSessionLookupIdx: index(
			"runtime_session_states_agent_mode_session_lookup_idx",
		).on(table.agentModeSessionId, table.status, table.lastSeenAt),
	}),
);
