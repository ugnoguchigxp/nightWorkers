import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { commonColumns, repositories, tasks } from "./schema";

export const missionGoals = sqliteTable(
	"mission_goals",
	{
		...commonColumns,
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		goalText: text("goal_text").notNull(),
		active: integer("active", { mode: "boolean" }).default(true).notNull(),
		source: text("source").default("user").notNull(),
		sortOrder: integer("sort_order").default(0).notNull(),
		interpretationScope: text("interpretation_scope")
			.default("unknown")
			.notNull(),
		interpretationIntent: text("interpretation_intent")
			.default("unknown")
			.notNull(),
		interpretationSource: text("interpretation_source")
			.default("unknown")
			.notNull(),
		interpretationConfidencePercent: integer(
			"interpretation_confidence_percent",
		)
			.default(0)
			.notNull(),
		interpretationReason: text("interpretation_reason"),
	},
	(table) => ({
		repositoryActiveIdx: index("mission_goals_repository_active_idx").on(
			table.repositoryId,
			table.active,
			table.sortOrder,
		),
	}),
);

export const missionTaskCandidateBatches = sqliteTable(
	"mission_task_candidate_batches",
	{
		...commonColumns,
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		status: text("status").default("running").notNull(),
		requestedGoalIdsJson: text("requested_goal_ids_json", {
			mode: "json",
		}).notNull(),
		signalSnapshotJson: text("signal_snapshot_json", {
			mode: "json",
		}).notNull(),
		selectedModelJson: text("selected_model_json", { mode: "json" }),
		rawOutputJson: text("raw_output_json", { mode: "json" }),
		errorMessage: text("error_message"),
		startedAt: integer("started_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
		completedAt: integer("completed_at", { mode: "timestamp" }),
	},
	(table) => ({
		repositoryCreatedIdx: index("mission_batches_repository_created_idx").on(
			table.repositoryId,
			table.createdAt,
		),
	}),
);

export const missionTaskCandidates = sqliteTable(
	"mission_task_candidates",
	{
		...commonColumns,
		batchId: text("batch_id")
			.notNull()
			.references(() => missionTaskCandidateBatches.id, {
				onDelete: "cascade",
			}),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		goalId: text("goal_id").references(() => missionGoals.id, {
			onDelete: "set null",
		}),
		sourceKind: text("source_kind").default("mission_goals").notNull(),
		sourceRefJson: text("source_ref_json", { mode: "json" }),
		candidateKind: text("candidate_kind").default("feature_followup").notNull(),
		primaryModule: text("primary_module"),
		secondaryModulesJson: text("secondary_modules_json", { mode: "json" })
			.default("[]")
			.notNull(),
		routingConfidencePercent: integer("routing_confidence_percent")
			.default(0)
			.notNull(),
		routingReason: text("routing_reason"),
		constraintGoalIdsJson: text("constraint_goal_ids_json", { mode: "json" })
			.default("[]")
			.notNull(),
		planModeOpenQuestionsJson: text("plan_mode_open_questions_json", {
			mode: "json",
		})
			.default("[]")
			.notNull(),
		title: text("title").notNull(),
		summary: text("summary").notNull(),
		rationale: text("rationale").notNull(),
		evidenceJson: text("evidence_json", { mode: "json" }).notNull(),
		evaluationContribution: integer("evaluation_contribution"),
		importancePercent: integer("importance_percent").notNull(),
		confidencePercent: integer("confidence_percent").notNull(),
		tokenSize: text("token_size").notNull(),
		complexity: text("complexity").notNull(),
		taskPrompt: text("task_prompt").notNull(),
		acceptanceCriteria: text("acceptance_criteria").notNull(),
		verificationPlan: text("verification_plan").notNull(),
		status: text("status").default("candidate").notNull(),
		taskId: text("task_id").references(() => tasks.id, {
			onDelete: "set null",
		}),
	},
	(table) => ({
		repositoryStatusIdx: index("mission_candidates_repository_status_idx").on(
			table.repositoryId,
			table.status,
			table.createdAt,
		),
		batchIdx: index("mission_candidates_batch_idx").on(table.batchId),
		taskIdx: index("mission_candidates_task_idx").on(table.taskId),
	}),
);

export const securityTaskCandidateFindings = sqliteTable(
	"security_task_candidate_findings",
	{
		...commonColumns,
		candidateId: text("candidate_id")
			.notNull()
			.references(() => missionTaskCandidates.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		scanRunRef: text("scan_run_ref").notNull(),
		findingRef: text("finding_ref").notNull(),
		fingerprintHash: text("fingerprint_hash").notNull(),
	},
	(table) => ({
		candidateFindingUid: uniqueIndex(
			"security_candidate_findings_candidate_finding_uidx",
		).on(table.candidateId, table.findingRef),
		repositoryFingerprintIdx: index(
			"security_candidate_findings_repository_fingerprint_idx",
		).on(table.repositoryId, table.fingerprintHash),
		scanFindingIdx: index("security_candidate_findings_scan_finding_idx").on(
			table.scanRunRef,
			table.findingRef,
		),
	}),
);
