import { client } from "./client";

export async function ensureBaseNightWorkersTables() {
	await client.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      email text NOT NULL,
      password_hash text,
      name text NOT NULL,
      is_active integer DEFAULT true NOT NULL
    )
  `);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id text PRIMARY KEY NOT NULL,
      token text NOT NULL,
      user_id text NOT NULL,
      expires_at integer NOT NULL,
      created_at integer NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS refresh_tokens_token_unique ON refresh_tokens (token)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS rt_user_id_idx ON refresh_tokens (user_id)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS user_external_accounts (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      provider text NOT NULL,
      external_id text NOT NULL,
      email text,
      created_at integer NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS uex_provider_ext_uidx ON user_external_accounts (provider, external_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS uex_user_id_idx ON user_external_accounts (user_id)",
	);

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
      status text DEFAULT 'draft' NOT NULL,
      compiled_prompt text,
      timeout_seconds integer DEFAULT 3600 NOT NULL,
      priority integer DEFAULT 0 NOT NULL,
      created_by text,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS tasks_repository_id_idx ON tasks (repository_id)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS task_runs (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      repository_id text,
      status text DEFAULT 'running' NOT NULL,
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
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS task_runs_task_id_idx ON task_runs (task_id)",
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
    CREATE TABLE IF NOT EXISTS task_run_control_states (
      run_id text PRIMARY KEY NOT NULL,
      version integer DEFAULT 1 NOT NULL,
      phase text DEFAULT 'active' NOT NULL,
      progress_revision integer DEFAULT 0 NOT NULL,
      workspace_revision integer DEFAULT 0 NOT NULL,
      workflow_revision integer DEFAULT 0 NOT NULL,
      todo_revision integer DEFAULT 0 NOT NULL,
      evidence_revision integer DEFAULT 0 NOT NULL,
      context_epoch integer DEFAULT 0 NOT NULL,
      last_mutation_sequence integer,
      last_evidence_sequence integer,
      consecutive_no_progress_turns integer DEFAULT 0 NOT NULL,
      terminal_reason text,
      state_version integer DEFAULT 0 NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade
    )
  `);

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

async function ensureColumn(table: string, column: string, definition: string) {
	const columns = await client.execute(`PRAGMA table_info(${table})`);
	const exists = columns.rows.some((row) => row.name === column);
	if (columns.rows.length > 0 && !exists) {
		await client.execute(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
	}
}
