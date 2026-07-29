import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { evidenceSubjectSnapshots } from "./evidence-ledger-schema";
import { commonColumns, tasks } from "./schema-base";
import { taskRuns } from "./schema-task-execution";

export const finalResponseEvidence = sqliteTable(
	"final_response_evidence",
	{
		...commonColumns,
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		runId: text("run_id")
			.notNull()
			.references(() => taskRuns.id, { onDelete: "cascade" }),
		subjectId: text("subject_id").references(
			() => evidenceSubjectSnapshots.id,
			{
				onDelete: "set null",
			},
		),
		revision: integer("revision").notNull(),
		bindingStatus: text("binding_status").notNull(),
		contentDigest: text("content_digest").notNull(),
		content: text("content"),
	},
	(table) => ({
		runRevisionUidx: uniqueIndex(
			"final_response_evidence_run_revision_uidx",
		).on(table.runId, table.revision),
		runDigestIdx: index("final_response_evidence_run_digest_idx").on(
			table.runId,
			table.contentDigest,
		),
		subjectIdx: index("final_response_evidence_subject_idx").on(
			table.subjectId,
		),
	}),
);
