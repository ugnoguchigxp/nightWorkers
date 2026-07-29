import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { commonColumns, taskRevisionSnapshots, tasks } from "./schema-base";
import { taskGitWorkspaces, taskRuns } from "./schema-task-execution";

export const evidenceSubjectSnapshots = sqliteTable(
	"evidence_subject_snapshots",
	{
		...commonColumns,
		version: integer("version").default(1).notNull(),
		bindingStatus: text("binding_status").default("canonical").notNull(),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		taskRevisionSnapshotId: text("task_revision_snapshot_id")
			.notNull()
			.references(() => taskRevisionSnapshots.id, { onDelete: "restrict" }),
		taskRevision: integer("task_revision").notNull(),
		taskDigest: text("task_digest").notNull(),
		implementationRunId: text("implementation_run_id")
			.notNull()
			.references(() => taskRuns.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id").references(() => taskGitWorkspaces.id, {
			onDelete: "set null",
		}),
		workspaceAllocationVersion: integer("workspace_allocation_version"),
		repositoryIdentityRevision: integer("repository_identity_revision"),
		admissionAttestationId: text("admission_attestation_id"),
		admissionAttestationDigest: text("admission_attestation_digest"),
		admittedHeadSha: text("admitted_head_sha"),
		baseHead: text("base_head"),
		sourceStateHash: text("source_state_hash").notNull(),
		diffDigest: text("diff_digest").notNull(),
		verificationDocumentId: text("verification_document_id"),
		verificationDocumentDigest: text("verification_document_digest"),
		bindingDigest: text("binding_digest").notNull(),
	},
	(table) => ({
		bindingDigestUidx: uniqueIndex(
			"evidence_subject_snapshots_binding_digest_uidx",
		).on(table.bindingDigest),
		runCreatedIdx: index("evidence_subject_snapshots_run_created_idx").on(
			table.implementationRunId,
			table.createdAt,
		),
		currentLookupIdx: index("evidence_subject_snapshots_current_lookup_idx").on(
			table.taskId,
			table.taskRevisionSnapshotId,
			table.implementationRunId,
			table.sourceStateHash,
		),
	}),
);
