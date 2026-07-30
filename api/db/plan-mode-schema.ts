import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type {
	PlanModeRoutingActor,
	PlanModeRoutingEntry,
} from "../../shared/schemas/plan-mode-routing.schema";
import { tasks } from "./schema";

export const planModeRoutingRevisions = sqliteTable(
	"plan_mode_routing_revisions",
	{
		id: text("id").primaryKey(),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
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
			"plan_mode_routing_revisions_task_revision_uidx",
		).on(table.taskId, table.revision),
		idempotencyUidx: uniqueIndex(
			"plan_mode_routing_revisions_task_idempotency_uidx",
		).on(table.taskId, table.idempotencyKey),
		createdIdx: index("plan_mode_routing_revisions_task_created_idx").on(
			table.taskId,
			table.createdAt,
		),
	}),
);
