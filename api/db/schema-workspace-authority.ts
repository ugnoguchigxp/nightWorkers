import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { commonColumns, repositories, tasks } from "./schema-base";

export const taskGitWorkspaces = sqliteTable(
	"task_git_workspaces",
	{
		...commonColumns,
		taskId: text("task_id")
			.notNull()
			.unique()
			.references(() => tasks.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		planReviewId: text("plan_review_id"),
		admissionKey: text("admission_key"),
		status: text("status").default("planned").notNull(),
		materializationKind: text("materialization_kind").notNull(),
		materializationIntentJson: text("materialization_intent_json", {
			mode: "json",
		}),
		bootstrapEvidenceJson: text("bootstrap_evidence_json", { mode: "json" }),
		integrationPolicySnapshotJson: text("integration_policy_snapshot_json", {
			mode: "json",
		}).notNull(),
		sourceBranch: text("source_branch").notNull(),
		targetBranch: text("target_branch").notNull(),
		targetBaseSha: text("target_base_sha"),
		worktreePath: text("worktree_path"),
		worktreeId: text("worktree_id"),
		repositoryIdentityRevision: integer("repository_identity_revision"),
		repositoryIdentityDigest: text("repository_identity_digest"),
		baseWorktreeId: text("base_worktree_id"),
		baseWorktreePathCanonical: text("base_worktree_path_canonical"),
		taskWorktreePathCanonical: text("task_worktree_path_canonical"),
		gitCommonDirDigest: text("git_common_dir_digest"),
		sourceRef: text("source_ref"),
		targetRef: text("target_ref"),
		attestationRevision: integer("attestation_revision").default(0).notNull(),
		lastAttestationId: text("last_attestation_id"),
		lastAttestationDigest: text("last_attestation_digest"),
		allocationVersion: integer("allocation_version").default(1).notNull(),
		expectedHeadSha: text("expected_head_sha"),
		provisionAttempt: integer("provision_attempt").default(0).notNull(),
		initializationAttempt: integer("initialization_attempt")
			.default(0)
			.notNull(),
		leaseOwner: text("lease_owner"),
		leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp" }),
		lastVerifiedHead: text("last_verified_head"),
		attentionResumeStatus: text("attention_resume_status"),
		lastErrorCode: text("last_error_code"),
		lastErrorMessage: text("last_error_message"),
		provisionedAt: integer("provisioned_at", { mode: "timestamp" }),
		initializedAt: integer("initialized_at", { mode: "timestamp" }),
		releasedAt: integer("released_at", { mode: "timestamp" }),
		retiredAt: integer("retired_at", { mode: "timestamp" }),
	},
	(table) => ({
		repositoryStatusIdx: index("task_git_workspaces_repository_status_idx").on(
			table.repositoryId,
			table.status,
		),
	}),
);

export const workspaceAttestations = sqliteTable(
	"workspace_attestations",
	{
		...commonColumns,
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => taskGitWorkspaces.id, { onDelete: "cascade" }),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		revision: integer("revision").notNull(),
		digest: text("digest").notNull(),
		canonicalPath: text("canonical_path").notNull(),
		gitCommonDirCanonical: text("git_common_dir_canonical").notNull(),
		branchRef: text("branch_ref"),
		headSha: text("head_sha").notNull(),
		expectedHeadSha: text("expected_head_sha"),
		dirty: integer("dirty", { mode: "boolean" }).notNull(),
		conflicted: integer("conflicted", { mode: "boolean" }).notNull(),
		stagedPathsJson: text("staged_paths_json", { mode: "json" })
			.$type<string[]>()
			.default([])
			.notNull(),
		modifiedPathsJson: text("modified_paths_json", { mode: "json" })
			.$type<string[]>()
			.default([])
			.notNull(),
		untrackedPathsJson: text("untracked_paths_json", { mode: "json" })
			.$type<string[]>()
			.default([])
			.notNull(),
		conflictPathsJson: text("conflict_paths_json", { mode: "json" })
			.$type<string[]>()
			.default([])
			.notNull(),
		ahead: integer("ahead").default(0).notNull(),
		behind: integer("behind").default(0).notNull(),
		comparisonRef: text("comparison_ref"),
		comparisonSha: text("comparison_sha"),
		upstreamRef: text("upstream_ref"),
		upstreamSha: text("upstream_sha"),
		upstreamAhead: integer("upstream_ahead"),
		upstreamBehind: integer("upstream_behind"),
		upstreamFreshness: text("upstream_freshness")
			.default("upstream_missing")
			.notNull(),
		upstreamFetchedAt: integer("upstream_fetched_at", { mode: "timestamp" }),
		observedAt: integer("observed_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		workspaceRevisionUidx: uniqueIndex(
			"workspace_attestations_workspace_revision_uidx",
		).on(table.workspaceId, table.revision),
		workspaceObservedIdx: index(
			"workspace_attestations_workspace_observed_idx",
		).on(table.workspaceId, table.observedAt),
	}),
);
