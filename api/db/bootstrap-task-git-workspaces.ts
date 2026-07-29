import { client } from "./client";
import { ensureColumn } from "./schema-bootstrap-utils";

export async function ensureTaskGitWorkspaceTable() {
	await client.execute(`
    CREATE TABLE IF NOT EXISTS task_git_workspaces (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL UNIQUE,
      repository_id text NOT NULL,
      plan_review_id text,
      admission_key text,
      status text DEFAULT 'planned' NOT NULL,
      materialization_kind text NOT NULL,
      materialization_intent_json text,
      bootstrap_evidence_json text,
      integration_policy_snapshot_json text NOT NULL,
      source_branch text NOT NULL,
      target_branch text NOT NULL,
      target_base_sha text,
      worktree_path text,
      worktree_id text,
      allocation_version integer DEFAULT 1 NOT NULL,
      expected_head_sha text,
      provision_attempt integer DEFAULT 0 NOT NULL,
      initialization_attempt integer DEFAULT 0 NOT NULL,
      lease_owner text,
      lease_expires_at integer,
      last_verified_head text,
      attention_resume_status text,
      last_error_code text,
      last_error_message text,
      provisioned_at integer,
      initialized_at integer,
      released_at integer,
      retired_at integer,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
	await ensureColumn(
		"task_git_workspaces",
		"initialization_attempt",
		"initialization_attempt integer DEFAULT 0 NOT NULL",
	);
	await ensureColumn(
		"task_git_workspaces",
		"initialized_at",
		"initialized_at integer",
	);
	for (const [name, definition] of [
		["repository_identity_revision", "repository_identity_revision integer"],
		["repository_identity_digest", "repository_identity_digest text"],
		["base_worktree_id", "base_worktree_id text"],
		["base_worktree_path_canonical", "base_worktree_path_canonical text"],
		["task_worktree_path_canonical", "task_worktree_path_canonical text"],
		["git_common_dir_digest", "git_common_dir_digest text"],
		["source_ref", "source_ref text"],
		["target_ref", "target_ref text"],
		["attestation_revision", "attestation_revision integer DEFAULT 0 NOT NULL"],
		["last_attestation_id", "last_attestation_id text"],
		["last_attestation_digest", "last_attestation_digest text"],
	] as const) {
		await ensureColumn("task_git_workspaces", name, definition);
	}
	await client.execute(`
    CREATE TABLE IF NOT EXISTS workspace_attestations (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      workspace_id text NOT NULL,
      task_id text NOT NULL,
      repository_id text NOT NULL,
      revision integer NOT NULL,
      digest text NOT NULL,
      canonical_path text NOT NULL,
      git_common_dir_canonical text NOT NULL,
      branch_ref text,
      head_sha text NOT NULL,
      expected_head_sha text,
      dirty integer NOT NULL,
      conflicted integer NOT NULL,
      staged_paths_json text DEFAULT '[]' NOT NULL,
      modified_paths_json text DEFAULT '[]' NOT NULL,
      untracked_paths_json text DEFAULT '[]' NOT NULL,
      conflict_paths_json text DEFAULT '[]' NOT NULL,
      ahead integer DEFAULT 0 NOT NULL,
      behind integer DEFAULT 0 NOT NULL,
      comparison_ref text,
      comparison_sha text,
      upstream_ref text,
      upstream_sha text,
      upstream_ahead integer,
      upstream_behind integer,
      upstream_freshness text DEFAULT 'upstream_missing' NOT NULL,
      upstream_fetched_at integer,
      observed_at integer NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES task_git_workspaces(id) ON DELETE cascade,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
	for (const [name, definition] of [
		["staged_paths_json", "staged_paths_json text DEFAULT '[]' NOT NULL"],
		["modified_paths_json", "modified_paths_json text DEFAULT '[]' NOT NULL"],
		["untracked_paths_json", "untracked_paths_json text DEFAULT '[]' NOT NULL"],
		["conflict_paths_json", "conflict_paths_json text DEFAULT '[]' NOT NULL"],
		["upstream_ref", "upstream_ref text"],
		["upstream_sha", "upstream_sha text"],
		["upstream_ahead", "upstream_ahead integer"],
		["upstream_behind", "upstream_behind integer"],
		[
			"upstream_freshness",
			"upstream_freshness text DEFAULT 'upstream_missing' NOT NULL",
		],
		["upstream_fetched_at", "upstream_fetched_at integer"],
	] as const) {
		await ensureColumn("workspace_attestations", name, definition);
	}
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS workspace_attestations_workspace_revision_uidx ON workspace_attestations (workspace_id, revision)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS workspace_attestations_workspace_observed_idx ON workspace_attestations (workspace_id, observed_at)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS task_git_workspaces_repository_status_idx ON task_git_workspaces (repository_id, status)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS task_git_workspaces_active_branch_uidx ON task_git_workspaces (repository_id, source_branch) WHERE retired_at IS NULL",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS task_git_workspaces_active_path_uidx ON task_git_workspaces (worktree_path) WHERE worktree_path IS NOT NULL AND retired_at IS NULL",
	);
}
