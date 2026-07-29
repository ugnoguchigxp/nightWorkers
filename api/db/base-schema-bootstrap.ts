import crypto from "node:crypto";
import { client } from "./client";

export async function ensureBaseNightWorkersTables() {
	await client.execute(`
    CREATE TABLE IF NOT EXISTS repositories (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      name text NOT NULL,
      local_path text NOT NULL,
      branch text DEFAULT 'main' NOT NULL,
      allowed integer DEFAULT true NOT NULL,
      queue_enabled integer DEFAULT false NOT NULL,
      max_concurrent_sessions integer DEFAULT 1 NOT NULL,
      safety_policy text
    )
  `);
	await ensureColumn(
		"repositories",
		"feature_settings",
		"feature_settings text",
	);
	await ensureColumn(
		"repositories",
		"git_integration_policy_json",
		"git_integration_policy_json text",
	);
	await ensureColumn(
		"repositories",
		"git_integration_version",
		"git_integration_version integer DEFAULT 0 NOT NULL",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS tasks (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      repository_id text NOT NULL,
      title text NOT NULL,
      description text,
      objective text,
      acceptance_criteria text,
      revision integer DEFAULT 1 NOT NULL,
      current_revision_snapshot_id text,
      worktree_path text,
      status text DEFAULT 'draft' NOT NULL,
	  completed_at integer,
	  archived_at integer,
      compiled_prompt text,
      timeout_seconds integer DEFAULT 3600 NOT NULL,
      priority integer DEFAULT 0 NOT NULL,
      created_by text,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
	await ensureColumn("tasks", "worktree_path", "worktree_path text");
	await ensureColumn("tasks", "completed_at", "completed_at integer");
	await ensureColumn("tasks", "archived_at", "archived_at integer");
	await ensureColumn(
		"tasks",
		"revision",
		"revision integer DEFAULT 1 NOT NULL",
	);
	await ensureColumn(
		"tasks",
		"current_revision_snapshot_id",
		"current_revision_snapshot_id text",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS tasks_repository_id_idx ON tasks (repository_id)",
	);
	await client.execute(`
		CREATE TABLE IF NOT EXISTS task_revision_snapshots (
			id text PRIMARY KEY NOT NULL,
			created_at integer NOT NULL,
			updated_at integer NOT NULL,
			task_id text NOT NULL,
			revision integer NOT NULL,
			digest text NOT NULL,
			title text NOT NULL,
			description text,
			objective text,
			acceptance_criteria text,
			specification_refs_json text DEFAULT '[]' NOT NULL,
			source_kind text DEFAULT 'canonical' NOT NULL,
			created_by text,
			FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade
		)
	`);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS task_revision_snapshots_task_revision_uidx ON task_revision_snapshots (task_id, revision)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS task_revision_snapshots_task_digest_idx ON task_revision_snapshots (task_id, digest)",
	);
	await backfillTaskRevisionSnapshots();

	await client.execute(`
    CREATE TABLE IF NOT EXISTS task_runs (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      repository_id text,
      task_revision_snapshot_id text,
      task_revision integer,
      task_digest text,
      admission_subject_id text,
      status text DEFAULT 'running' NOT NULL,
	  todo_plan_revision integer DEFAULT 0 NOT NULL,
      worker_kind text DEFAULT 'native-local-worker' NOT NULL,
      base_ref text,
      worktree_path text,
      timeout_seconds integer DEFAULT 3600 NOT NULL,
      context_snapshot text,
      summary text,
      final_report text,
      final_judgment text,
      started_at integer NOT NULL,
      ended_at integer,
      finished_at integer,
      log_content text,
      diff_patch text,
      test_results text,
      details_purged_at integer,
      purged_detail_count integer DEFAULT 0 NOT NULL,
      purged_detail_bytes integer DEFAULT 0 NOT NULL,
      purged_manifest_digest text,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
	await ensureColumn("task_runs", "worktree_path", "worktree_path text");
	await ensureColumn(
		"task_runs",
		"workspace_authority_kind",
		"workspace_authority_kind text",
	);
	await ensureColumn(
		"task_runs",
		"task_revision_snapshot_id",
		"task_revision_snapshot_id text",
	);
	await ensureColumn("task_runs", "task_revision", "task_revision integer");
	await ensureColumn("task_runs", "task_digest", "task_digest text");
	await ensureColumn(
		"task_runs",
		"admission_subject_id",
		"admission_subject_id text",
	);
	await ensureColumn("task_runs", "workspace_id", "workspace_id text");
	await ensureColumn(
		"task_runs",
		"workspace_allocation_version",
		"workspace_allocation_version integer",
	);
	await ensureColumn(
		"task_runs",
		"repository_identity_revision",
		"repository_identity_revision integer",
	);
	await ensureColumn(
		"task_runs",
		"admission_attestation_id",
		"admission_attestation_id text",
	);
	await ensureColumn(
		"task_runs",
		"admission_attestation_digest",
		"admission_attestation_digest text",
	);
	await ensureColumn(
		"task_runs",
		"admitted_head_sha",
		"admitted_head_sha text",
	);
	await ensureColumn(
		"task_runs",
		"details_purged_at",
		"details_purged_at integer",
	);
	await ensureColumn(
		"task_runs",
		"purged_detail_count",
		"purged_detail_count integer DEFAULT 0 NOT NULL",
	);
	await ensureColumn(
		"task_runs",
		"purged_detail_bytes",
		"purged_detail_bytes integer DEFAULT 0 NOT NULL",
	);
	await ensureColumn(
		"task_runs",
		"purged_manifest_digest",
		"purged_manifest_digest text",
	);
	await ensureColumn(
		"task_runs",
		"todo_plan_revision",
		"todo_plan_revision integer DEFAULT 0 NOT NULL",
	);
	await ensureColumn(
		"task_runs",
		"agent_mode_session_id",
		"agent_mode_session_id text",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS task_runs_task_id_idx ON task_runs (task_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS task_runs_agent_mode_session_started_idx ON task_runs (agent_mode_session_id, started_at)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS task_events (
      id text PRIMARY KEY NOT NULL,
      task_run_id text NOT NULL,
      type text NOT NULL,
      message text NOT NULL,
      timestamp integer NOT NULL,
      seq integer DEFAULT 0 NOT NULL,
      actor text DEFAULT 'system' NOT NULL,
      event_type text,
      payload_json text,
      FOREIGN KEY (task_run_id) REFERENCES task_runs(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS task_events_task_run_id_idx ON task_events (task_run_id)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS task_events_task_run_seq_uidx ON task_events (task_run_id, seq)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS task_run_action_records (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      run_id text NOT NULL,
      sequence integer NOT NULL,
      tool_name text NOT NULL,
      normalized_args_digest text NOT NULL,
      action_key text NOT NULL,
      progress_revision integer NOT NULL,
      dedupe_revision integer NOT NULL,
      execution_status text DEFAULT 'pending' NOT NULL,
      transport_status text,
      domain_outcome text,
      effect text NOT NULL,
      result_digest text,
      evidence_refs_json text,
      artifact_refs_json text,
      model_view_json text,
      repeat_count integer DEFAULT 0 NOT NULL,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS task_run_action_records_run_sequence_uidx ON task_run_action_records (run_id, sequence)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS task_run_action_records_run_action_revision_uidx ON task_run_action_records (run_id, action_key, dedupe_revision)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS task_run_action_records_run_created_idx ON task_run_action_records (run_id, created_at)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS native_api_turns (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      run_id text NOT NULL,
      task_id text NOT NULL,
      turn_index integer NOT NULL,
      status text DEFAULT 'running' NOT NULL,
      provider text,
      model text,
      execution_mode text,
      history_json text,
      provider_debug_json text,
      error_json text,
      started_at integer NOT NULL,
      finished_at integer,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS native_api_turns_run_turn_uidx ON native_api_turns (run_id, turn_index)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS native_api_turns_run_status_idx ON native_api_turns (run_id, status)",
	);
	await ensureColumn(
		"native_api_turns",
		"execution_mode",
		"execution_mode text",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS native_api_turns_resume_idx ON native_api_turns (task_id, status, provider, model, execution_mode, finished_at)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS native_api_tool_calls (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      run_id text NOT NULL,
      task_id text NOT NULL,
      turn_id text NOT NULL,
      tool_call_id text NOT NULL,
      tool_name text NOT NULL,
      status text DEFAULT 'pending' NOT NULL,
      arguments_json text,
      result_json text,
      error_json text,
      model_visible_output text,
      todo_seq integer,
      source text DEFAULT 'provider_native' NOT NULL,
      started_at integer,
      finished_at integer,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (turn_id) REFERENCES native_api_turns(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS native_api_tool_calls_run_call_uidx ON native_api_tool_calls (run_id, tool_call_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS native_api_tool_calls_run_status_idx ON native_api_tool_calls (run_id, status)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS native_api_tool_calls_turn_idx ON native_api_tool_calls (turn_id)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS runtime_session_states (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      repository_id text,
      run_id text,
      runtime_lane text NOT NULL,
      provider text NOT NULL,
      provider_session_id text,
      execution_mode text,
      model text,
      status text NOT NULL,
      last_seen_at integer NOT NULL,
      metadata_json text,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE set null
    )
  `);
	await client.execute(`
    CREATE INDEX IF NOT EXISTS runtime_session_states_lookup_idx
    ON runtime_session_states (
      task_id,
      repository_id,
      runtime_lane,
      provider,
      execution_mode,
      status,
      last_seen_at
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS runtime_session_states_run_idx ON runtime_session_states (run_id)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS artifacts (
      id text PRIMARY KEY NOT NULL,
      run_id text NOT NULL,
      kind text NOT NULL,
      path text NOT NULL,
      metadata_json text,
      created_at integer NOT NULL,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS artifacts_run_id_idx ON artifacts (run_id)",
	);
}

async function backfillTaskRevisionSnapshots() {
	await repairCurrentTaskRevisionSnapshotPointers();
	const rows = await client.execute(`
		SELECT
			t.id,
			t.revision,
			t.title,
			t.description,
			t.objective,
			t.acceptance_criteria,
			t.created_by,
			t.created_at,
			t.updated_at
		FROM tasks t
		LEFT JOIN task_revision_snapshots s
			ON s.task_id = t.id AND s.revision = t.revision
		WHERE s.id IS NULL
	`);
	for (const row of rows.rows) {
		const taskId = String(row.id);
		const revision = Number(row.revision ?? 1);
		const snapshotId = crypto.randomUUID();
		const digest = `legacy-unbound:${taskId}:${revision}`;
		await client.batch(
			[
				{
					sql: `
						INSERT INTO task_revision_snapshots (
							id,
							created_at,
							updated_at,
							task_id,
							revision,
							digest,
							title,
							description,
							objective,
							acceptance_criteria,
							specification_refs_json,
							source_kind,
							created_by
						) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'legacy_migration', ?)
					`,
					args: [
						snapshotId,
						Number(row.created_at),
						Number(row.updated_at),
						taskId,
						revision,
						digest,
						String(row.title),
						row.description ?? null,
						row.objective ?? null,
						row.acceptance_criteria ?? null,
						row.created_by ?? null,
					],
				},
				{
					sql: `
						UPDATE tasks
						SET current_revision_snapshot_id = ?
						WHERE id = ? AND revision = ?
					`,
					args: [snapshotId, taskId, revision],
				},
			],
			"write",
		);
	}
}

async function repairCurrentTaskRevisionSnapshotPointers() {
	await client.execute(`
		UPDATE tasks
		SET current_revision_snapshot_id = (
			SELECT s.id
			FROM task_revision_snapshots s
			WHERE s.task_id = tasks.id AND s.revision = tasks.revision
			LIMIT 1
		)
		WHERE current_revision_snapshot_id IS NULL
		  AND EXISTS (
			SELECT 1
			FROM task_revision_snapshots s
			WHERE s.task_id = tasks.id AND s.revision = tasks.revision
		  )
	`);
}

async function ensureColumn(table: string, column: string, definition: string) {
	const columns = await client.execute(`PRAGMA table_info(${table})`);
	const exists = columns.rows.some((row) => row.name === column);
	if (columns.rows.length > 0 && !exists) {
		await client.execute(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
	}
}
