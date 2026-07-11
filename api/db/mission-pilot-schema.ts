import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { DesignQuestionnaireAnswer } from "../../shared/schemas/design-questionnaire.schema";
import type {
	MissionPilotAnswerEvidence,
	MissionPilotAuthorizationV2,
} from "../../shared/schemas/mission-pilot.schema";
import type { MissionPilotPlanReview } from "../../shared/schemas/mission-pilot-plan-review.schema";
import { designQuestionnaireSessions } from "./design-questionnaire-schema";
import { repositories, taskMessages, taskRuns, tasks } from "./schema";

export const missionPilotSessions = sqliteTable(
	"mission_pilot_sessions",
	{
		id: text("id").primaryKey(),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		sourceKind: text("source_kind").notNull(),
		sourceId: text("source_id").notNull(),
		authorizationVersion: integer("authorization_version"),
		authorizationJson: text("authorization_json", {
			mode: "json",
		}).$type<MissionPilotAuthorizationV2 | null>(),
		desiredState: text("desired_state").notNull().default("stopped"),
		phase: text("phase").notNull().default("created"),
		resumePhase: text("resume_phase"),
		initialPromptSnapshot: text("initial_prompt_snapshot").notNull(),
		initialPromptState: text("initial_prompt_state")
			.notNull()
			.default("pending"),
		initialPromptMessageId: text("initial_prompt_message_id").references(
			() => taskMessages.id,
			{ onDelete: "set null" },
		),
		activeRunId: text("active_run_id").references(() => taskRuns.id, {
			onDelete: "set null",
		}),
		version: integer("version").notNull().default(0),
		contextRevision: integer("context_revision").notNull().default(1),
		contextDigest: text("context_digest").notNull(),
		nextWakeAt: integer("next_wake_at", { mode: "timestamp" }),
		leaseOwner: text("lease_owner"),
		leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp" }),
		lastErrorCode: text("last_error_code"),
		lastErrorMessage: text("last_error_message"),
		startedAt: integer("started_at", { mode: "timestamp" }),
		stoppedAt: integer("stopped_at", { mode: "timestamp" }),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		taskUidx: uniqueIndex("mission_pilot_sessions_task_uidx").on(table.taskId),
		sourceUidx: uniqueIndex("mission_pilot_sessions_source_uidx").on(
			table.sourceKind,
			table.sourceId,
		),
		repositoryStateIdx: index("mission_pilot_sessions_repository_state_idx").on(
			table.repositoryId,
			table.desiredState,
			table.updatedAt,
		),
		leaseIdx: index("mission_pilot_sessions_lease_idx").on(
			table.leaseExpiresAt,
		),
	}),
);

export const missionPilotContextSnapshots = sqliteTable(
	"mission_pilot_context_snapshots",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => missionPilotSessions.id, { onDelete: "cascade" }),
		revision: integer("revision").notNull(),
		reason: text("reason").notNull(),
		contextJson: text("context_json", { mode: "json" })
			.$type<Record<string, unknown>>()
			.notNull(),
		digest: text("digest").notNull(),
		tokenEstimate: integer("token_estimate").notNull().default(0),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		revisionUidx: uniqueIndex(
			"mission_pilot_context_snapshots_revision_uidx",
		).on(table.sessionId, table.revision),
	}),
);

export const missionPilotQuestionnaireDrafts = sqliteTable(
	"mission_pilot_questionnaire_drafts",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => missionPilotSessions.id, { onDelete: "cascade" }),
		questionnaireSessionId: text("questionnaire_session_id")
			.notNull()
			.references(() => designQuestionnaireSessions.id, {
				onDelete: "cascade",
			}),
		answersJson: text("answers_json", { mode: "json" })
			.$type<DesignQuestionnaireAnswer[]>()
			.notNull(),
		answerEvidenceJson: text("answer_evidence_json", { mode: "json" })
			.$type<Record<string, MissionPilotAnswerEvidence>>()
			.notNull(),
		state: text("state").notNull().default("waiting_user"),
		deadlineAt: integer("deadline_at", { mode: "timestamp" }).notNull(),
		version: integer("version").notNull().default(0),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		questionnaireUidx: uniqueIndex(
			"mission_pilot_questionnaire_drafts_questionnaire_uidx",
		).on(table.questionnaireSessionId),
		deadlineIdx: index("mission_pilot_questionnaire_drafts_deadline_idx").on(
			table.state,
			table.deadlineAt,
		),
	}),
);

export const missionPilotSteps = sqliteTable(
	"mission_pilot_steps",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => missionPilotSessions.id, { onDelete: "cascade" }),
		stepKey: text("step_key").notNull(),
		ordinal: integer("ordinal").notNull(),
		status: text("status").notNull().default("pending"),
		attempt: integer("attempt").notNull().default(0),
		contextRevision: integer("context_revision").notNull(),
		contextDigest: text("context_digest").notNull(),
		artifactMessageId: text("artifact_message_id").references(
			() => taskMessages.id,
			{ onDelete: "set null" },
		),
		evidenceJson: text("evidence_json", { mode: "json" })
			.$type<Record<string, unknown>>()
			.notNull(),
		lastError: text("last_error"),
		startedAt: integer("started_at", { mode: "timestamp" }),
		finishedAt: integer("finished_at", { mode: "timestamp" }),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		stepUidx: uniqueIndex("mission_pilot_steps_step_uidx").on(
			table.sessionId,
			table.stepKey,
		),
		statusIdx: index("mission_pilot_steps_status_idx").on(
			table.status,
			table.updatedAt,
		),
	}),
);

export const missionPilotPlanReviews = sqliteTable(
	"mission_pilot_plan_reviews",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => missionPilotSessions.id, { onDelete: "cascade" }),
		contextRevision: integer("context_revision").notNull(),
		contextDigest: text("context_digest").notNull(),
		featurePlanMessageId: text("feature_plan_message_id")
			.notNull()
			.references(() => taskMessages.id, { onDelete: "cascade" }),
		attempt: integer("attempt").notNull(),
		verdict: text("verdict").notNull(),
		reviewJson: text("review_json", { mode: "json" })
			.$type<MissionPilotPlanReview>()
			.notNull(),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		attemptUidx: uniqueIndex("mission_pilot_plan_reviews_attempt_uidx").on(
			table.sessionId,
			table.attempt,
		),
		contextIdx: index("mission_pilot_plan_reviews_context_idx").on(
			table.sessionId,
			table.contextRevision,
		),
	}),
);
