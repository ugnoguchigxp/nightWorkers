import crypto from "node:crypto";
import {
	index,
	integer,
	real,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { repositories, tasks } from "./schema";

const projectEvaluationCommonColumns = {
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

export const projectEvaluationRuns = sqliteTable(
	"project_evaluation_runs",
	{
		...projectEvaluationCommonColumns,
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		status: text("status").default("completed").notNull(),
		bundleJson: text("bundle_json", { mode: "json" }).notNull(),
		rawOutputJson: text("raw_output_json", { mode: "json" }),
		summary: text("summary").notNull(),
		overallScore: real("overall_score").notNull(),
		overallConfidence: real("overall_confidence").notNull(),
		evidenceLevel: text("evidence_level").default("repo-structure").notNull(),
		selectedModelJson: text("selected_model_json", { mode: "json" }),
		previousEvaluationId: text("previous_evaluation_id"),
		strengthsJson: text("strengths_json", { mode: "json" }),
		weaknessesJson: text("weaknesses_json", { mode: "json" }),
		nextEvidenceToCollectJson: text("next_evidence_to_collect_json", {
			mode: "json",
		}),
	},
	(table) => ({
		repositoryCreatedIdx: index("project_eval_runs_repository_created_idx").on(
			table.repositoryId,
			table.createdAt,
		),
	}),
);

export const projectEvaluationDimensions = sqliteTable(
	"project_evaluation_dimensions",
	{
		...projectEvaluationCommonColumns,
		evaluationId: text("evaluation_id")
			.notNull()
			.references(() => projectEvaluationRuns.id, { onDelete: "cascade" }),
		dimensionKey: text("dimension_key").notNull(),
		label: text("label").notNull(),
		score: real("score").notNull(),
		confidence: real("confidence").notNull(),
		rationale: text("rationale").notNull(),
		evidenceJson: text("evidence_json", { mode: "json" }),
		concernsJson: text("concerns_json", { mode: "json" }),
	},
	(table) => ({
		evaluationIdx: index("project_eval_dimensions_evaluation_idx").on(
			table.evaluationId,
		),
	}),
);

export const projectEvaluationActivityEvents = sqliteTable(
	"project_evaluation_activity_events",
	{
		id: text("id").primaryKey(),
		evaluationId: text("evaluation_id")
			.notNull()
			.references(() => projectEvaluationRuns.id, { onDelete: "cascade" }),
		seq: integer("seq").notNull(),
		phase: text("phase").notNull(),
		level: text("level").notNull(),
		source: text("source").notNull(),
		message: text("message").notNull(),
		status: text("status"),
		payloadJson: text("payload_json", { mode: "json" }),
		createdAt: integer("created_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
	},
	(table) => ({
		evaluationSeqIdx: index("project_eval_activity_evaluation_seq_idx").on(
			table.evaluationId,
			table.seq,
		),
	}),
);

export const projectImprovementIdeas = sqliteTable(
	"project_improvement_ideas",
	{
		...projectEvaluationCommonColumns,
		evaluationId: text("evaluation_id")
			.notNull()
			.references(() => projectEvaluationRuns.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		summary: text("summary").notNull(),
		agentPrompt: text("agent_prompt").notNull(),
		expectedOutcome: text("expected_outcome").notNull(),
		implementationFocusJson: text("implementation_focus_json", {
			mode: "json",
		}).notNull(),
		targetDimensionsJson: text("target_dimensions_json", {
			mode: "json",
		}).notNull(),
	},
	(table) => ({
		evaluationIdx: index("project_improvement_ideas_evaluation_idx").on(
			table.evaluationId,
		),
	}),
);

export const projectImprovementIdeaScoreImpacts = sqliteTable(
	"project_improvement_idea_score_impacts",
	{
		...projectEvaluationCommonColumns,
		ideaId: text("idea_id")
			.notNull()
			.references(() => projectImprovementIdeas.id, { onDelete: "cascade" }),
		dimensionKey: text("dimension_key").notNull(),
		currentScore: integer("current_score").notNull(),
		expectedScoreGain: integer("expected_score_gain").notNull(),
		expectedScoreAfter: integer("expected_score_after").notNull(),
		rationale: text("rationale").notNull(),
	},
	(table) => ({
		ideaIdx: index("project_improvement_score_impacts_idea_idx").on(
			table.ideaId,
		),
	}),
);

export const projectEvaluationTaskLinks = sqliteTable(
	"project_evaluation_task_links",
	{
		id: text("id").primaryKey(),
		evaluationId: text("evaluation_id")
			.notNull()
			.references(() => projectEvaluationRuns.id, { onDelete: "cascade" }),
		ideaId: text("idea_id")
			.notNull()
			.references(() => projectImprovementIdeas.id, { onDelete: "cascade" }),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		createdAt: integer("created_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
	},
	(table) => ({
		evaluationIdx: index("project_eval_task_links_evaluation_idx").on(
			table.evaluationId,
		),
		ideaIdx: index("project_eval_task_links_idea_idx").on(table.ideaId),
		evaluationIdeaUniqueIdx: uniqueIndex(
			"project_eval_task_links_evaluation_idea_uidx",
		).on(table.evaluationId, table.ideaId),
	}),
);
