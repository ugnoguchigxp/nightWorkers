import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { evidenceSubjectSnapshots } from "./evidence-ledger-schema";
import { commonColumns, taskMessages, taskRuns, tasks } from "./schema";

export const verificationDocuments = sqliteTable(
	"verification_documents",
	{
		...commonColumns,
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		runId: text("run_id").references(() => taskRuns.id, {
			onDelete: "set null",
		}),
		specMessageId: text("spec_message_id").references(() => taskMessages.id, {
			onDelete: "set null",
		}),
		specArtifactId: text("spec_artifact_id"),
		verificationArtifactId: text("verification_artifact_id"),
		sourceSpecPath: text("source_spec_path").notNull(),
		schemaVersion: integer("schema_version").default(1).notNull(),
		status: text("status").default("active").notNull(),
		documentJson: text("document_json", { mode: "json" })
			.$type<Record<string, unknown>>()
			.notNull(),
		generatedAt: integer("generated_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		taskIdx: index("verification_documents_task_idx").on(table.taskId),
		specMessageIdx: index("verification_documents_spec_message_idx").on(
			table.specMessageId,
		),
		verificationArtifactIdx: index(
			"verification_documents_verification_artifact_idx",
		).on(table.verificationArtifactId),
	}),
);

export const verificationChecklistItems = sqliteTable(
	"verification_checklist_items",
	{
		...commonColumns,
		verificationDocumentId: text("verification_document_id")
			.notNull()
			.references(() => verificationDocuments.id, { onDelete: "cascade" }),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		conditionId: text("condition_id").notNull(),
		text: text("text").notNull(),
		required: integer("required", { mode: "boolean" }).notNull(),
		verificationKind: text("verification_kind"),
		expectedEvidenceJson: text("expected_evidence_json", { mode: "json" })
			.$type<string[]>()
			.notNull()
			.default([]),
		status: text("status").default("pending").notNull(),
		evidenceIdsJson: text("evidence_ids_json", { mode: "json" })
			.$type<string[]>()
			.notNull(),
		reason: text("reason"),
		lastCheckedAt: integer("last_checked_at", { mode: "timestamp" }),
	},
	(table) => ({
		documentConditionIdx: uniqueIndex(
			"verification_checklist_document_condition_uidx",
		).on(table.verificationDocumentId, table.conditionId),
		taskStatusIdx: index("verification_checklist_task_status_idx").on(
			table.taskId,
			table.status,
		),
	}),
);

export const verificationEvidenceRuns = sqliteTable(
	"verification_evidence_runs",
	{
		...commonColumns,
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		runId: text("run_id").references(() => taskRuns.id, {
			onDelete: "set null",
		}),
		verificationDocumentId: text("verification_document_id").references(
			() => verificationDocuments.id,
			{ onDelete: "set null" },
		),
		subjectId: text("subject_id").references(
			() => evidenceSubjectSnapshots.id,
			{ onDelete: "set null" },
		),
		checkKind: text("check_kind").notNull(),
		command: text("command").notNull(),
		cwd: text("cwd").notNull(),
		exitCode: integer("exit_code").notNull(),
		runner: text("runner").default("unknown").notNull(),
		rawStdoutArtifactId: text("raw_stdout_artifact_id").notNull(),
		rawStderrArtifactId: text("raw_stderr_artifact_id").notNull(),
		parsedArtifactId: text("parsed_artifact_id"),
		summaryJson: text("summary_json", { mode: "json" })
			.$type<Record<string, unknown>>()
			.notNull(),
		commandLevelConditionIdsJson: text("command_level_condition_ids_json", {
			mode: "json",
		})
			.$type<string[]>()
			.notNull(),
		sourceSnapshotJson: text("source_snapshot_json", { mode: "json" }).$type<
			Record<string, unknown>
		>(),
		testExecutionObserved: integer("test_execution_observed", {
			mode: "boolean",
		})
			.notNull()
			.default(false),
		sourceMutatedDuringCheck: integer("source_mutated_during_check", {
			mode: "boolean",
		})
			.notNull()
			.default(false),
		startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
		finishedAt: integer("finished_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		taskRunIdx: index("verification_evidence_runs_task_run_idx").on(
			table.taskId,
			table.runId,
		),
		documentIdx: index("verification_evidence_runs_document_idx").on(
			table.verificationDocumentId,
		),
		subjectIdx: index("verification_evidence_runs_subject_idx").on(
			table.subjectId,
		),
	}),
);

export const codingAgentTestInventoryRuns = sqliteTable(
	"coding_agent_test_inventory_runs",
	{
		...commonColumns,
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		runId: text("run_id").references(() => taskRuns.id, {
			onDelete: "set null",
		}),
		cwd: text("cwd").notNull(),
		sourceSnapshotJson: text("source_snapshot_json", { mode: "json" })
			.$type<Record<string, unknown>>()
			.notNull(),
		warningsJson: text("warnings_json", { mode: "json" })
			.$type<string[]>()
			.notNull(),
	},
	(table) => ({
		taskIdx: index("coding_agent_test_inventory_runs_task_idx").on(
			table.taskId,
			table.createdAt,
		),
	}),
);

export const codingAgentTestInventoryCases = sqliteTable(
	"coding_agent_test_inventory_cases",
	{
		...commonColumns,
		inventoryId: text("inventory_id")
			.notNull()
			.references(() => codingAgentTestInventoryRuns.id, {
				onDelete: "cascade",
			}),
		caseKey: text("case_key").notNull(),
		name: text("name").notNull(),
		filePath: text("file_path").notNull(),
		runner: text("runner").notNull(),
		discoveryLevel: text("discovery_level").notNull(),
		declaredConditionIdsJson: text("declared_condition_ids_json", {
			mode: "json",
		})
			.$type<string[]>()
			.notNull(),
	},
	(table) => ({
		inventoryCaseIdx: uniqueIndex("coding_agent_test_inventory_case_uidx").on(
			table.inventoryId,
			table.caseKey,
		),
	}),
);

export const codingAgentTestConditionMappings = sqliteTable(
	"coding_agent_test_condition_mappings",
	{
		...commonColumns,
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		verificationDocumentId: text("verification_document_id")
			.notNull()
			.references(() => verificationDocuments.id, { onDelete: "cascade" }),
		inventoryId: text("inventory_id")
			.notNull()
			.references(() => codingAgentTestInventoryRuns.id, {
				onDelete: "cascade",
			}),
		caseKey: text("case_key").notNull(),
		conditionId: text("condition_id").notNull(),
		source: text("source").notNull(),
		rationale: text("rationale"),
		sourceDigest: text("source_digest").notNull(),
	},
	(table) => ({
		mappingIdx: uniqueIndex("coding_agent_test_condition_mapping_uidx").on(
			table.verificationDocumentId,
			table.inventoryId,
			table.caseKey,
			table.conditionId,
		),
	}),
);

export const verificationEvidenceCases = sqliteTable(
	"verification_evidence_cases",
	{
		...commonColumns,
		evidenceRunId: text("evidence_run_id")
			.notNull()
			.references(() => verificationEvidenceRuns.id, { onDelete: "cascade" }),
		verificationDocumentId: text("verification_document_id").references(
			() => verificationDocuments.id,
			{ onDelete: "set null" },
		),
		conditionIdsJson: text("condition_ids_json", { mode: "json" })
			.$type<string[]>()
			.notNull(),
		name: text("name").notNull(),
		filePath: text("file_path"),
		status: text("status").notNull(),
		durationMs: integer("duration_ms"),
		failureMessage: text("failure_message"),
	},
	(table) => ({
		runIdx: index("verification_evidence_cases_run_idx").on(
			table.evidenceRunId,
		),
		documentIdx: index("verification_evidence_cases_document_idx").on(
			table.verificationDocumentId,
		),
	}),
);
