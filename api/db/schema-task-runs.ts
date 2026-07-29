import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { agentModeSessions } from "./schema-agent-mode-session";
import {
	commonColumns,
	repositories,
	type TaskRunStatus,
	taskRevisionSnapshots,
	tasks,
} from "./schema-base";

export const taskRuns = sqliteTable(
	"task_runs",
	{
		...commonColumns,
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id").references(() => repositories.id, {
			onDelete: "cascade",
		}),
		taskRevisionSnapshotId: text("task_revision_snapshot_id").references(
			() => taskRevisionSnapshots.id,
			{ onDelete: "restrict" },
		),
		taskRevision: integer("task_revision"),
		taskDigest: text("task_digest"),
		admissionSubjectId: text("admission_subject_id"),
		agentModeSessionId: text("agent_mode_session_id").references(
			() => agentModeSessions.id,
			{ onDelete: "set null" },
		),
		status: text("status").$type<TaskRunStatus>().default("running").notNull(),
		todoPlanRevision: integer("todo_plan_revision").default(0).notNull(),
		workerKind: text("worker_kind").default("native-local-worker").notNull(),
		baseRef: text("base_ref"),
		worktreePath: text("worktree_path"),
		workspaceAuthorityKind: text("workspace_authority_kind"),
		workspaceId: text("workspace_id"),
		workspaceAllocationVersion: integer("workspace_allocation_version"),
		repositoryIdentityRevision: integer("repository_identity_revision"),
		admissionAttestationId: text("admission_attestation_id"),
		admissionAttestationDigest: text("admission_attestation_digest"),
		admittedHeadSha: text("admitted_head_sha"),
		timeoutSeconds: integer("timeout_seconds").default(3600).notNull(),
		contextSnapshot: text("context_snapshot", { mode: "json" }),
		summary: text("summary"),
		finalReport: text("final_report"),
		finalJudgment: text("final_judgment", { mode: "json" }),
		startedAt: integer("started_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
		endedAt: integer("ended_at", { mode: "timestamp" }),
		finishedAt: integer("finished_at", { mode: "timestamp" }),
		logContent: text("log_content"),
		diffPatch: text("diff_patch"),
		testResults: text("test_results", { mode: "json" }),
		detailsPurgedAt: integer("details_purged_at", { mode: "timestamp" }),
		purgedDetailCount: integer("purged_detail_count").default(0).notNull(),
		purgedDetailBytes: integer("purged_detail_bytes").default(0).notNull(),
		purgedManifestDigest: text("purged_manifest_digest"),
	},
	(table) => ({
		taskIdIdx: index("task_runs_task_id_idx").on(table.taskId),
		agentModeSessionStartedIdx: index(
			"task_runs_agent_mode_session_started_idx",
		).on(table.agentModeSessionId, table.startedAt),
	}),
);
