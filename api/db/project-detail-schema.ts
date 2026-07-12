import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { commonColumns, repositories } from "./schema";

export const projectQualityRuns = sqliteTable(
	"project_quality_runs",
	{
		...commonColumns,
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		runType: text("run_type").notNull(),
		status: text("status").default("running").notNull(),
		command: text("command").notNull(),
		exitCode: integer("exit_code"),
		startedAt: integer("started_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
		completedAt: integer("completed_at", { mode: "timestamp" }),
		outputArtifactId: text("output_artifact_id"),
		latestOutput: text("latest_output"),
		coverageSummaryJson: text("coverage_summary_json", { mode: "json" }),
		e2eSummaryJson: text("e2e_summary_json", { mode: "json" }),
		errorMessage: text("error_message"),
	},
	(table) => ({
		repositoryStatusIdx: index("project_quality_runs_repository_status_idx").on(
			table.repositoryId,
			table.status,
			table.createdAt,
		),
		repositoryTypeCreatedIdx: index(
			"project_quality_runs_repository_type_created_idx",
		).on(table.repositoryId, table.runType, table.createdAt),
	}),
);
