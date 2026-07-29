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
