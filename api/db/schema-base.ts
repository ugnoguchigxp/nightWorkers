import crypto from "node:crypto";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { ProjectGitIntegrationPolicy } from "../../shared/schemas/git-integration.schema";

export const commonColumns = {
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

export const applicationSettings = sqliteTable("application_settings", {
	scope: text("scope").primaryKey(),
	valueJson: text("value_json", { mode: "json" })
		.$type<Record<string, unknown>>()
		.notNull(),
	revision: integer("revision").default(1).notNull(),
	createdAt: integer("created_at", { mode: "timestamp" })
		.$defaultFn(() => new Date())
		.notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" })
		.$defaultFn(() => new Date())
		.$onUpdateFn(() => new Date())
		.notNull(),
});

export const applicationSettingSecrets = sqliteTable(
	"application_setting_secrets",
	{
		scope: text("scope").primaryKey(),
		valueJson: text("value_json", { mode: "json" })
			.$type<Record<string, unknown>>()
			.notNull(),
		revision: integer("revision").default(1).notNull(),
		createdAt: integer("created_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.$onUpdateFn(() => new Date())
			.notNull(),
	},
);

export const applicationSettingMigrations = sqliteTable(
	"application_setting_migrations",
	{
		source: text("source").primaryKey(),
		sourceFingerprint: text("source_fingerprint").notNull(),
		importedAt: integer("imported_at", { mode: "timestamp" }).notNull(),
		completedAt: integer("completed_at", { mode: "timestamp" }).notNull(),
		resultJson: text("result_json", { mode: "json" })
			.$type<Record<string, unknown>>()
			.notNull(),
	},
);

export type TaskStatus =
	| "draft"
	| "ready"
	| "context_compiling"
	| "queued"
	| "running"
	| "finalizing"
	| "verifying"
	| "needs_review"
	| "integration_pending"
	| "completed"
	| "archived"
	| "blocked"
	| "failed"
	| "timed_out"
	| "cancelled"
	| "needs_human";

export type TaskRunStatus =
	| "ready"
	| "queued"
	| "running"
	| "context_compiling"
	| "finalizing"
	| "verifying"
	| "completed"
	| "failed"
	| "cancelled"
	| "needs_review"
	| "blocked"
	| "timed_out"
	| "needs_human";

export type ImplementationQueueEntryStatus =
	| "queued"
	| "claimed"
	| "processing"
	| "needs_human"
	| "awaiting_commit_decision"
	| "execution_completed"
	| "execution_archived"
	| "failed"
	| "cancelled";

export const repositories = sqliteTable("repositories", {
	...commonColumns,
	name: text("name").notNull(),
	localPath: text("local_path").notNull(),
	branch: text("branch").default("main").notNull(),
	repositoryKind: text("repository_kind").default("non_git").notNull(),
	repositoryIdentityStatus: text("repository_identity_status")
		.default("materialization_pending")
		.notNull(),
	registeredRootCanonical: text("registered_root_canonical"),
	gitCommonDirCanonical: text("git_common_dir_canonical"),
	baseWorktreePathCanonical: text("base_worktree_path_canonical"),
	baseWorktreeId: text("base_worktree_id"),
	baseWorktreeBranch: text("base_worktree_branch"),
	baseWorktreeHeadSha: text("base_worktree_head_sha"),
	baseWorktreeDirty: integer("base_worktree_dirty", { mode: "boolean" }),
	repositoryIdentityDigest: text("repository_identity_digest"),
	repositoryIdentityRevision: integer("repository_identity_revision")
		.default(0)
		.notNull(),
	repositoryIdentityVerifiedAt: integer("repository_identity_verified_at", {
		mode: "timestamp",
	}),
	gitIntegrationPolicyJson: text("git_integration_policy_json", {
		mode: "json",
	}).$type<ProjectGitIntegrationPolicy | null>(),
	gitIntegrationVersion: integer("git_integration_version")
		.default(0)
		.notNull(),
	allowed: integer("allowed", { mode: "boolean" }).default(true).notNull(),
	queueEnabled: integer("queue_enabled", { mode: "boolean" })
		.default(false)
		.notNull(),
	maxConcurrentSessions: integer("max_concurrent_sessions")
		.default(1)
		.notNull(),
	safetyPolicy: text("safety_policy", { mode: "json" }).$type<{
		allowedPaths?: string[];
		externalAllowedPaths?: string[];
		deniedPaths?: string[];
		blockedCommands?: string[];
		maxCommandSeconds?: number;
		requireReadBeforeEdit?: boolean;
		maxTimeSeconds?: number;
		trackedSecretFilesAcknowledged?: boolean;
	}>(),
	projectMeta: text("project_meta", { mode: "json" }).$type<Record<
		string,
		unknown
	> | null>(),
	featureSettings: text("feature_settings", { mode: "json" }).$type<Record<
		string,
		unknown
	> | null>(),
});

export const tasks = sqliteTable(
	"tasks",
	{
		...commonColumns,
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		description: text("description"),
		objective: text("objective"),
		acceptanceCriteria: text("acceptance_criteria"),
		revision: integer("revision").default(1).notNull(),
		currentRevisionSnapshotId: text("current_revision_snapshot_id"),
		worktreePath: text("worktree_path"),
		status: text("status").$type<TaskStatus>().default("draft").notNull(), // draft | ready | context_compiling | queued | running | verifying | needs_review | completed | blocked | failed | timed_out | cancelled | needs_human
		completedAt: integer("completed_at", { mode: "timestamp" }),
		archivedAt: integer("archived_at", { mode: "timestamp" }),
		compiledPrompt: text("compiled_prompt"),
		timeoutSeconds: integer("timeout_seconds").default(3600).notNull(),
		priority: integer("priority").default(0).notNull(),
		createdBy: text("created_by"),
	},
	(table) => ({
		repositoryIdIdx: index("tasks_repository_id_idx").on(table.repositoryId),
	}),
);

export const taskRevisionSnapshots = sqliteTable(
	"task_revision_snapshots",
	{
		...commonColumns,
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		revision: integer("revision").notNull(),
		digest: text("digest").notNull(),
		title: text("title").notNull(),
		description: text("description"),
		objective: text("objective"),
		acceptanceCriteria: text("acceptance_criteria"),
		specificationRefsJson: text("specification_refs_json", {
			mode: "json",
		})
			.$type<string[]>()
			.default([])
			.notNull(),
		sourceKind: text("source_kind").default("canonical").notNull(),
		createdBy: text("created_by"),
	},
	(table) => ({
		taskRevisionUidx: uniqueIndex(
			"task_revision_snapshots_task_revision_uidx",
		).on(table.taskId, table.revision),
		taskDigestIdx: index("task_revision_snapshots_task_digest_idx").on(
			table.taskId,
			table.digest,
		),
	}),
);
