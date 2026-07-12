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

export const users = sqliteTable("users", {
	...commonColumns,
	email: text("email").notNull().unique(),
	passwordHash: text("password_hash"),
	name: text("name").notNull(),
	isActive: integer("is_active", { mode: "boolean" }).default(true).notNull(),
});

export const refreshTokens = sqliteTable(
	"refresh_tokens",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		token: text("token").notNull().unique(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
		createdAt: integer("created_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
	},
	(table) => ({
		userIdIdx: index("rt_user_id_idx").on(table.userId),
	}),
);

export const userExternalAccounts = sqliteTable(
	"user_external_accounts",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		provider: text("provider").notNull(), // 'google', 'github'
		externalId: text("external_id").notNull(),
		email: text("email"),
		createdAt: integer("created_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
	},
	(table) => ({
		providerExternalIdUniqueIdx: uniqueIndex("uex_provider_ext_uidx").on(
			table.provider,
			table.externalId,
		),
		userIdIdx: index("uex_user_id_idx").on(table.userId),
	}),
);

export const repositories = sqliteTable("repositories", {
	...commonColumns,
	name: text("name").notNull(),
	localPath: text("local_path").notNull(),
	branch: text("branch").default("main").notNull(),
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
