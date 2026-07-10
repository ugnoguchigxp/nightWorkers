import {
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { commonColumns, repositories } from "./schema";

export const projectCodeSizeSnapshots = sqliteTable(
	"project_code_size_snapshots",
	{
		...commonColumns,
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		schemaVersion: integer("schema_version").default(1).notNull(),
		algorithmVersion: text("algorithm_version").notNull(),
		measuredAt: integer("measured_at", { mode: "timestamp" }).notNull(),
		scanDurationMs: integer("scan_duration_ms").notNull(),
		gitHead: text("git_head"),
		gitDirty: integer("git_dirty", { mode: "boolean" }),
		totalFiles: integer("total_files").notNull(),
		sourceFiles: integer("source_files").notNull(),
		testFiles: integer("test_files").notNull(),
		totalEffectiveLines: integer("total_effective_lines").notNull(),
		sourceEffectiveLines: integer("source_effective_lines").notNull(),
		testEffectiveLines: integer("test_effective_lines").notNull(),
		resultJson: text("result_json", { mode: "json" })
			.$type<Record<string, unknown>>()
			.notNull(),
	},
	(table) => ({
		repositoryUniqueIdx: uniqueIndex(
			"project_code_size_snapshots_repository_uidx",
		).on(table.repositoryId),
	}),
);
