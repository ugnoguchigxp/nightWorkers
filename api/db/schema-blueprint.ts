import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { taskMessages } from "./schema-activity";
import { commonColumns, tasks } from "./schema-base";

export const blueprintDesignSettings = sqliteTable(
	"blueprint_design_settings",
	{
		...commonColumns,
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		settingsJson: text("settings_json", { mode: "json" }).notNull(),
	},
	(table) => ({
		taskIdUniqueIdx: uniqueIndex("blueprint_design_settings_task_id_uidx").on(
			table.taskId,
		),
	}),
);

export const blueprintArtifactAdoptions = sqliteTable(
	"blueprint_artifact_adoptions",
	{
		...commonColumns,
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		messageId: text("message_id")
			.notNull()
			.references(() => taskMessages.id, { onDelete: "cascade" }),
		adopted: integer("adopted", { mode: "boolean" }).default(false).notNull(),
	},
	(table) => ({
		taskIdIdx: index("blueprint_artifact_adoptions_task_id_idx").on(
			table.taskId,
		),
		messageUniqueIdx: uniqueIndex(
			"blueprint_artifact_adoptions_message_uidx",
		).on(table.taskId, table.messageId),
	}),
);

export const blueprintDesignTokenAdoptions = sqliteTable(
	"blueprint_design_token_adoptions",
	{
		...commonColumns,
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		messageId: text("message_id")
			.notNull()
			.references(() => taskMessages.id, { onDelete: "cascade" }),
		adopted: integer("adopted", { mode: "boolean" }).default(false).notNull(),
	},
	(table) => ({
		taskIdIdx: index("blueprint_design_token_adoptions_task_id_idx").on(
			table.taskId,
		),
		messageUniqueIdx: uniqueIndex(
			"blueprint_design_token_adoptions_message_uidx",
		).on(table.taskId, table.messageId),
	}),
);
