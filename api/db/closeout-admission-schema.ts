import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { evidenceSubjectSnapshots } from "./evidence-ledger-schema";
import { finalResponseEvidence } from "./final-response-evidence-schema";
import { commonColumns, taskRevisionSnapshots, tasks } from "./schema-base";
import { taskRuns } from "./schema-task-execution";

export const closeoutAdmissions = sqliteTable(
	"closeout_admissions",
	{
		...commonColumns,
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		runId: text("run_id")
			.notNull()
			.references(() => taskRuns.id, { onDelete: "cascade" }),
		subjectId: text("subject_id")
			.notNull()
			.references(() => evidenceSubjectSnapshots.id, { onDelete: "restrict" }),
		taskRevisionSnapshotId: text("task_revision_snapshot_id")
			.notNull()
			.references(() => taskRevisionSnapshots.id, { onDelete: "restrict" }),
		finalResponseEvidenceId: text("final_response_evidence_id")
			.notNull()
			.references(() => finalResponseEvidence.id, { onDelete: "restrict" }),
		reviewRunId: text("review_run_id").notNull(),
		reviewManifestDigest: text("review_manifest_digest").notNull(),
		verificationEvidenceIdsJson: text("verification_evidence_ids_json", {
			mode: "json",
		})
			.$type<string[]>()
			.notNull(),
		admissionDigest: text("admission_digest").notNull(),
		status: text("status").default("admitted").notNull(),
		admittedAt: integer("admitted_at", { mode: "timestamp" }).notNull(),
		consumedAt: integer("consumed_at", { mode: "timestamp" }),
	},
	(table) => ({
		digestUidx: uniqueIndex("closeout_admissions_digest_uidx").on(
			table.admissionDigest,
		),
		runCreatedIdx: index("closeout_admissions_run_created_idx").on(
			table.runId,
			table.createdAt,
		),
	}),
);
