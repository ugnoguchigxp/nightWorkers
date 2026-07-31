import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { taskRuns, tasks } from "./schema";

export const taskArchiveRecords = sqliteTable(
	"task_archive_records",
	{
		id: text("id").primaryKey(),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		automationSessionId: text("automation_session_id"),
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
