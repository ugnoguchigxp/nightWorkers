import crypto from "node:crypto";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { repositories, tasks } from "./schema";

const missionPlannerCommonColumns = {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	createdAt: integer("created_at", { mode: "timestamp" })
		.$defaultFn(() => new Date())
		.notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" })
		.$defaultFn(() => new Date())
		.$onUpdateFn(() => new Date())
		.notNull(),
};

export const missions = sqliteTable(
	"missions",
	{
		...missionPlannerCommonColumns,
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		goalText: text("goal_text").notNull(),
		nonGoalsJson: text("non_goals_json", { mode: "json" }).notNull(),
		status: text("status").default("draft").notNull(),
		sourceGoalIdsJson: text("source_goal_ids_json", { mode: "json" }).notNull(),
		source: text("source").default("user").notNull(),
		sourceRefId: text("source_ref_id"),
		sourceEvaluationId: text("source_evaluation_id"),
		pausedAt: integer("paused_at", { mode: "timestamp" }),
		abandonedAt: integer("abandoned_at", { mode: "timestamp" }),
		completedAt: integer("completed_at", { mode: "timestamp" }),
		latestPlanningResultId: text("latest_planning_result_id"),
		statusReason: text("status_reason"),
	},
	(table) => ({
		repositoryStatusCreatedIdx: index(
			"missions_repository_status_created_idx",
		).on(table.repositoryId, table.status, table.createdAt),
		repositorySourceUniqueIdx: uniqueIndex(
			"missions_repository_source_ref_uidx",
		).on(table.repositoryId, table.source, table.sourceRefId),
	}),
);

export const missionDecompositionRuns = sqliteTable(
	"mission_decomposition_runs",
	{
		...missionPlannerCommonColumns,
		missionId: text("mission_id")
			.notNull()
			.references(() => missions.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		status: text("status").default("running").notNull(),
		inputBundleJson: text("input_bundle_json", { mode: "json" }).notNull(),
		stageOutputsJson: text("stage_outputs_json", { mode: "json" }).notNull(),
		selectedModelsJson: text("selected_models_json", {
			mode: "json",
		}).notNull(),
		errorMessage: text("error_message"),
		startedAt: integer("started_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
		completedAt: integer("completed_at", { mode: "timestamp" }),
	},
	(table) => ({
		missionCreatedIdx: index("mission_decomp_runs_mission_created_idx").on(
			table.missionId,
			table.createdAt,
		),
		repositoryCreatedIdx: index(
			"mission_decomp_runs_repository_created_idx",
		).on(table.repositoryId, table.createdAt),
	}),
);

export const missionPlanningResults = sqliteTable(
	"mission_planning_results",
	{
		...missionPlannerCommonColumns,
		missionId: text("mission_id")
			.notNull()
			.references(() => missions.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		decompositionRunId: text("decomposition_run_id")
			.notNull()
			.references(() => missionDecompositionRuns.id, { onDelete: "cascade" }),
		status: text("status").default("draft").notNull(),
		planningResultJson: text("planning_result_json", {
			mode: "json",
		}).notNull(),
		deterministicChecksJson: text("deterministic_checks_json", {
			mode: "json",
		}),
		evaluationJson: text("evaluation_json", { mode: "json" }),
		statusReason: text("status_reason"),
	},
	(table) => ({
		missionStatusCreatedIdx: index(
			"mission_planning_results_mission_status_created_idx",
		).on(table.missionId, table.status, table.createdAt),
		repositoryStatusCreatedIdx: index(
			"mission_planning_results_repository_status_created_idx",
		).on(table.repositoryId, table.status, table.createdAt),
	}),
);

export const missionTaskProposals = sqliteTable(
	"mission_task_proposals",
	{
		...missionPlannerCommonColumns,
		missionId: text("mission_id")
			.notNull()
			.references(() => missions.id, { onDelete: "cascade" }),
		planningResultId: text("planning_result_id")
			.notNull()
			.references(() => missionPlanningResults.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		workPackageId: text("work_package_id").notNull(),
		decompositionTaskId: text("decomposition_task_id").notNull(),
		status: text("status").default("proposed").notNull(),
		title: text("title").notNull(),
		summary: text("summary").notNull(),
		initialPrompt: text("initial_prompt").notNull(),
		expectedOutcome: text("expected_outcome").notNull(),
		implementationFocusJson: text("implementation_focus_json", {
			mode: "json",
		}).notNull(),
		acceptanceCriteriaJson: text("acceptance_criteria_json", {
			mode: "json",
		}).notNull(),
		verificationGateJson: text("verification_gate_json", {
			mode: "json",
		}).notNull(),
		dependenciesJson: text("dependencies_json", { mode: "json" }).notNull(),
		targetFilesOrModulesJson: text("target_files_or_modules_json", {
			mode: "json",
		}).notNull(),
		risk: text("risk").notNull(),
		approvalRequired: integer("approval_required", { mode: "boolean" })
			.default(false)
			.notNull(),
		schedulingJson: text("scheduling_json", { mode: "json" }).notNull(),
		taskId: text("task_id").references(() => tasks.id, {
			onDelete: "set null",
		}),
	},
	(table) => ({
		missionStatusCreatedIdx: index(
			"mission_task_proposals_mission_status_created_idx",
		).on(table.missionId, table.status, table.createdAt),
		planningStatusIdx: index("mission_task_proposals_planning_status_idx").on(
			table.planningResultId,
			table.status,
		),
		taskIdx: index("mission_task_proposals_task_idx").on(table.taskId),
		planningTaskUniqueIdx: uniqueIndex(
			"mission_task_proposals_planning_task_uidx",
		).on(table.planningResultId, table.decompositionTaskId),
		taskUniqueIdx: uniqueIndex("mission_task_proposals_task_uidx").on(
			table.taskId,
		),
	}),
);
