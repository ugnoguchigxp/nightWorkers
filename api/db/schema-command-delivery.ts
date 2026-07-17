import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { commonColumns } from "./schema-base";

export const taskOperatorCommandReceipts = sqliteTable(
	"task_operator_command_receipts",
	{
		...commonColumns,
		actorKind: text("actor_kind").notNull(),
		actorId: text("actor_id").notNull(),
		taskId: text("task_id").notNull(),
		actionId: text("action_id").notNull(),
		idempotencyKey: text("idempotency_key").notNull(),
		argumentsDigest: text("arguments_digest").notNull(),
		status: text("status").notNull(),
		resultJson: text("result_json", { mode: "json" }),
		failureJson: text("failure_json", { mode: "json" }),
	},
	(table) => ({
		actorKeyUniqueIdx: uniqueIndex(
			"task_operator_command_receipts_actor_key_uidx",
		).on(table.actorKind, table.actorId, table.idempotencyKey),
		statusIdx: index("task_operator_command_receipts_status_idx").on(
			table.status,
		),
	}),
);
