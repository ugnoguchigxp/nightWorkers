import crypto from "node:crypto";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { commonColumns, repositories, tasks } from "./schema-base";
import { taskRuns } from "./schema-task-execution";

export const artifacts = sqliteTable(
	"artifacts",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		runId: text("run_id")
			.notNull()
			.references(() => taskRuns.id, { onDelete: "cascade" }),
		kind: text("kind").notNull(), // e.g. diff | log | file | patch
		path: text("path").notNull(),
		metadataJson: text("metadata_json", { mode: "json" }),
		createdAt: integer("created_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
	},
	(table) => ({
		runIdIdx: index("artifacts_run_id_idx").on(table.runId),
	}),
);

export const activityArtifacts = sqliteTable(
	"activity_artifacts",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		runId: text("run_id").references(() => taskRuns.id, {
			onDelete: "set null",
		}),
		kind: text("kind").notNull(),
		path: text("path"),
		contentText: text("content_text"),
		metadataJson: text("metadata_json", { mode: "json" }),
		createdAt: integer("created_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
	},
	(table) => ({
		taskIdIdx: index("activity_artifacts_task_id_idx").on(table.taskId),
		runIdIdx: index("activity_artifacts_run_id_idx").on(table.runId),
		kindCreatedAtIdx: index("activity_artifacts_kind_created_at_idx").on(
			table.kind,
			table.createdAt,
		),
	}),
);

export const activityEvents = sqliteTable(
	"activity_events",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		runId: text("run_id").references(() => taskRuns.id, {
			onDelete: "set null",
		}),
		turnId: text("turn_id"),
		parentEventId: text("parent_event_id"),
		seq: integer("seq").notNull(),
		runSeq: integer("run_seq"),
		kind: text("kind").notNull(),
		source: text("source").notNull(),
		status: text("status"),
		text: text("text"),
		payloadJson: text("payload_json", { mode: "json" }),
		artifactId: text("artifact_id").references(() => activityArtifacts.id, {
			onDelete: "set null",
		}),
		clientTempId: text("client_temp_id"),
		externalId: text("external_id"),
		dedupeKey: text("dedupe_key"),
		ingestError: text("ingest_error"),
		visibility: text("visibility").default("visible").notNull(),
		createdAt: integer("created_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
	},
	(table) => ({
		taskSeqUniqueIdx: uniqueIndex("activity_events_task_seq_uidx").on(
			table.taskId,
			table.seq,
		),
		taskCreatedAtIdx: index("activity_events_task_created_at_idx").on(
			table.taskId,
			table.createdAt,
		),
		runSeqIdx: index("activity_events_run_seq_idx").on(
			table.runId,
			table.runSeq,
		),
		turnSeqIdx: index("activity_events_turn_seq_idx").on(
			table.turnId,
			table.seq,
		),
		kindCreatedAtIdx: index("activity_events_kind_created_at_idx").on(
			table.kind,
			table.createdAt,
		),
		artifactIdIdx: index("activity_events_artifact_id_idx").on(
			table.artifactId,
		),
		dedupeKeyUniqueIdx: uniqueIndex("activity_events_dedupe_key_uidx").on(
			table.dedupeKey,
		),
	}),
);

export const backgroundProcesses = sqliteTable(
	"background_processes",
	{
		...commonColumns,
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		taskId: text("task_id").references(() => tasks.id, {
			onDelete: "set null",
		}),
		runId: text("run_id").references(() => taskRuns.id, {
			onDelete: "set null",
		}),
		command: text("command").notNull(),
		cwd: text("cwd").notNull(),
		status: text("status").default("running").notNull(),
		pid: integer("pid"),
		exitCode: integer("exit_code"),
		signal: text("signal"),
		startedAt: integer("started_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
		endedAt: integer("ended_at", { mode: "timestamp" }),
		stopReason: text("stop_reason"),
		latestOutput: text("latest_output").default("").notNull(),
		outputArtifactId: text("output_artifact_id").references(
			() => activityArtifacts.id,
			{
				onDelete: "set null",
			},
		),
		metadataJson: text("metadata_json", { mode: "json" }),
	},
	(table) => ({
		repositoryStatusIdx: index("background_processes_repository_status_idx").on(
			table.repositoryId,
			table.status,
		),
		taskStatusIdx: index("background_processes_task_status_idx").on(
			table.taskId,
			table.status,
		),
		runStatusIdx: index("background_processes_run_status_idx").on(
			table.runId,
			table.status,
		),
	}),
);

export const taskMessages = sqliteTable(
	"task_messages",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		runId: text("run_id").references(() => taskRuns.id, {
			onDelete: "set null",
		}),
		role: text("role").notNull(), // user | assistant | system | tool
		content: text("content").notNull(),
		messageType: text("message_type"), // text | chart | browser | playwright | flow | markdown_document
		metadataJson: text("metadata_json", { mode: "json" }),
		createdAt: integer("created_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
	},
	(table) => ({
		taskIdIdx: index("task_messages_task_id_idx").on(table.taskId),
		runIdIdx: index("task_messages_run_id_idx").on(table.runId),
	}),
);

export const conversationContextSnapshots = sqliteTable(
	"conversation_context_snapshots",
	{
		...commonColumns,
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		runId: text("run_id").references(() => taskRuns.id, {
			onDelete: "set null",
		}),
		version: integer("version").notNull(),
		sourceMessageId: text("source_message_id"),
		sourceRunId: text("source_run_id"),
		sourceEventCursor: text("source_event_cursor"),
		jobType: text("job_type"),
		latestUserMessageId: text("latest_user_message_id"),
		previousRunId: text("previous_run_id"),
		terminalState: text("terminal_state"),
		tokenEstimate: integer("token_estimate").default(0).notNull(),
		snapshotJson: text("snapshot_json", { mode: "json" }).notNull(),
		stateCardText: text("state_card_text").notNull(),
	},
	(table) => ({
		taskIdIdx: index("conversation_context_snapshots_task_id_idx").on(
			table.taskId,
		),
		runIdIdx: index("conversation_context_snapshots_run_id_idx").on(
			table.runId,
		),
		taskUpdatedAtIdx: index(
			"conversation_context_snapshots_task_updated_idx",
		).on(table.taskId, table.updatedAt),
	}),
);
