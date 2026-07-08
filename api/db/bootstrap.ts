import { ensureBaseNightWorkersTables } from "./base-schema-bootstrap";
import { client } from "./client";
import {
	ensureMissionPlannerTables,
	ensureProjectDetailTables,
} from "./project-detail-schema-bootstrap";
import { ensureProjectEvaluationTables } from "./project-evaluation-schema-bootstrap";
import { ensureReviewModeTables } from "./review-mode-schema-bootstrap";
import { ensureColumn } from "./schema-bootstrap-utils";
import { ensureVerificationTables } from "./verification-schema-bootstrap";

async function ensureNullableDesignQuestionnaireBlueprintSource() {
	const columns = await client.execute(
		"PRAGMA table_info(design_questionnaire_sessions)",
	);
	const sourceColumn = columns.rows.find(
		(row) => row.name === "source_blueprint_message_id",
	);
	if (!sourceColumn || sourceColumn.notnull !== 1) return;

	await client.execute("PRAGMA foreign_keys = OFF");
	try {
		await client.execute(`
      CREATE TABLE IF NOT EXISTS design_questionnaire_sessions_next (
        id text PRIMARY KEY NOT NULL,
        created_at integer NOT NULL,
        updated_at integer NOT NULL,
        task_id text NOT NULL,
        repository_id text NOT NULL,
        source_blueprint_message_id text,
        status text DEFAULT 'draft' NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
        FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
        FOREIGN KEY (source_blueprint_message_id) REFERENCES task_messages(id) ON DELETE cascade
      )
    `);
		await client.execute(`
      INSERT INTO design_questionnaire_sessions_next (
        id,
        created_at,
        updated_at,
        task_id,
        repository_id,
        source_blueprint_message_id,
        status
      )
      SELECT
        id,
        created_at,
        updated_at,
        task_id,
        repository_id,
        source_blueprint_message_id,
        status
      FROM design_questionnaire_sessions
    `);
		await client.execute("DROP TABLE design_questionnaire_sessions");
		await client.execute(
			"ALTER TABLE design_questionnaire_sessions_next RENAME TO design_questionnaire_sessions",
		);
		await client.execute(
			"CREATE INDEX IF NOT EXISTS design_questionnaire_sessions_task_idx ON design_questionnaire_sessions (task_id)",
		);
		await client.execute(
			"CREATE INDEX IF NOT EXISTS design_questionnaire_sessions_repository_idx ON design_questionnaire_sessions (repository_id)",
		);
		await client.execute(
			"CREATE INDEX IF NOT EXISTS design_questionnaire_sessions_source_blueprint_idx ON design_questionnaire_sessions (source_blueprint_message_id)",
		);
	} finally {
		await client.execute("PRAGMA foreign_keys = ON");
	}
}

export async function ensureNightWorkersSchema() {
	await client.execute("PRAGMA foreign_keys = ON");
	await client.execute("PRAGMA busy_timeout = 10000");
	await client.execute("PRAGMA journal_mode = WAL");

	// Drop legacy BBS tables if they exist
	await client.execute("DROP TABLE IF EXISTS comments");
	await client.execute("DROP TABLE IF EXISTS threads");

	await ensureBaseNightWorkersTables();
	await ensureNullableDesignQuestionnaireBlueprintSource();
	await ensureProjectEvaluationTables();
	await ensureProjectDetailTables();
	await ensureMissionPlannerTables();
	await ensureReviewModeTables();
	await ensureVerificationTables();

	const taskRunColumns = await client.execute("PRAGMA table_info(task_runs)");
	const hasFinalJudgmentColumn = taskRunColumns.rows.some(
		(row) => row.name === "final_judgment",
	);
	if (taskRunColumns.rows.length > 0 && !hasFinalJudgmentColumn) {
		await client.execute(
			"ALTER TABLE task_runs ADD COLUMN final_judgment text",
		);
	}

	const repositoryColumns = await client.execute(
		"PRAGMA table_info(repositories)",
	);
	const hasQueueEnabledColumn = repositoryColumns.rows.some(
		(row) => row.name === "queue_enabled",
	);
	if (repositoryColumns.rows.length > 0 && !hasQueueEnabledColumn) {
		await client.execute(
			"ALTER TABLE repositories ADD COLUMN queue_enabled integer DEFAULT false NOT NULL",
		);
	}
	const hasMaxConcurrentSessionsColumn = repositoryColumns.rows.some(
		(row) => row.name === "max_concurrent_sessions",
	);
	if (repositoryColumns.rows.length > 0 && !hasMaxConcurrentSessionsColumn) {
		await client.execute(
			"ALTER TABLE repositories ADD COLUMN max_concurrent_sessions integer DEFAULT 1 NOT NULL",
		);
	}
	const hasProjectMetaColumn = repositoryColumns.rows.some(
		(row) => row.name === "project_meta",
	);
	if (repositoryColumns.rows.length > 0 && !hasProjectMetaColumn) {
		await client.execute(
			"ALTER TABLE repositories ADD COLUMN project_meta text",
		);
	}

	await client.execute(`
    CREATE TABLE IF NOT EXISTS task_messages (
      id text PRIMARY KEY NOT NULL,
      task_id text NOT NULL,
      run_id text,
      role text NOT NULL,
      content text NOT NULL,
      message_type text,
      metadata_json text,
      created_at integer NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE set null
    )
  `);

	await client.execute(
		"CREATE INDEX IF NOT EXISTS task_messages_task_id_idx ON task_messages (task_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS task_messages_run_id_idx ON task_messages (run_id)",
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
    CREATE TABLE IF NOT EXISTS conversation_context_snapshots (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      run_id text,
      version integer NOT NULL,
      source_message_id text,
      source_run_id text,
      source_event_cursor text,
      job_type text,
      latest_user_message_id text,
      previous_run_id text,
      terminal_state text,
      token_estimate integer DEFAULT 0 NOT NULL,
      snapshot_json text NOT NULL,
      state_card_text text NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE set null
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS conversation_context_snapshots_task_id_idx ON conversation_context_snapshots (task_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS conversation_context_snapshots_run_id_idx ON conversation_context_snapshots (run_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS conversation_context_snapshots_task_updated_idx ON conversation_context_snapshots (task_id, updated_at)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS llm_usage_records (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      run_id text,
      call_id text NOT NULL,
      provider text NOT NULL,
      model text,
      label text NOT NULL,
      round integer,
      usage_mode text NOT NULL,
      input_tokens integer,
      output_tokens integer,
      cached_input_tokens integer,
      reasoning_output_tokens integer,
      total_tokens integer,
      system_prompt_tokens integer,
      user_prompt_tokens integer,
      state_card_tokens integer,
      response_tokens_estimate integer,
      duration_ms integer NOT NULL,
      raw_usage_json text,
      metadata_json text,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE set null
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS llm_usage_records_task_created_idx ON llm_usage_records (task_id, created_at)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS llm_usage_records_run_created_idx ON llm_usage_records (run_id, created_at)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS llm_usage_records_call_id_uidx ON llm_usage_records (call_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS llm_usage_records_provider_created_idx ON llm_usage_records (provider, created_at)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS llm_model_pricing (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      provider text NOT NULL,
      model text NOT NULL,
      currency_code text DEFAULT 'USD' NOT NULL,
      input_per_1m real,
      cached_input_per_1m real,
      output_per_1m real,
      reasoning_output_per_1m real,
      source_url text,
      source_label text,
      effective_from integer DEFAULT 0 NOT NULL,
      fetched_at integer,
      manual_override integer DEFAULT false NOT NULL,
      enabled integer DEFAULT true NOT NULL
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS llm_model_pricing_provider_model_idx ON llm_model_pricing (provider, model)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS llm_model_pricing_enabled_idx ON llm_model_pricing (enabled)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS llm_model_pricing_provider_model_currency_effective_uidx ON llm_model_pricing (provider, model, currency_code, effective_from)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS llm_usage_summary_buckets (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      bucket_hour_utc integer NOT NULL,
      repository_id text,
      repository_key text NOT NULL,
      provider text NOT NULL,
      model text,
      model_key text NOT NULL,
      pricing_currency_code text,
      pricing_currency_key text NOT NULL,
      pricing_status text NOT NULL,
      input_tokens integer DEFAULT 0 NOT NULL,
      output_tokens integer DEFAULT 0 NOT NULL,
      cached_input_tokens integer DEFAULT 0 NOT NULL,
      reasoning_output_tokens integer DEFAULT 0 NOT NULL,
      system_prompt_tokens integer DEFAULT 0 NOT NULL,
      user_prompt_tokens integer DEFAULT 0 NOT NULL,
      state_card_tokens integer DEFAULT 0 NOT NULL,
      total_tokens integer DEFAULT 0 NOT NULL,
      total_duration_ms integer DEFAULT 0 NOT NULL,
      output_duration_ms integer DEFAULT 0 NOT NULL,
      measured_duration_call_count integer DEFAULT 0 NOT NULL,
      call_count integer DEFAULT 0 NOT NULL,
      measured_call_count integer DEFAULT 0 NOT NULL,
      estimated_call_count integer DEFAULT 0 NOT NULL,
      mixed_call_count integer DEFAULT 0 NOT NULL,
      unavailable_call_count integer DEFAULT 0 NOT NULL,
      priced_call_count integer DEFAULT 0 NOT NULL,
      unpriced_call_count integer DEFAULT 0 NOT NULL,
      manual_priced_call_count integer DEFAULT 0 NOT NULL,
      estimated_cost real DEFAULT 0 NOT NULL,
      input_cost real DEFAULT 0 NOT NULL,
      cached_input_cost real DEFAULT 0 NOT NULL,
      output_cost real DEFAULT 0 NOT NULL,
      reasoning_output_cost real DEFAULT 0 NOT NULL,
      pricing_updated_at integer,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS llm_usage_summary_buckets_uidx ON llm_usage_summary_buckets (bucket_hour_utc, repository_key, provider, model_key, pricing_currency_key, pricing_status)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS llm_usage_summary_buckets_hour_idx ON llm_usage_summary_buckets (bucket_hour_utc)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS llm_usage_summary_buckets_repository_hour_idx ON llm_usage_summary_buckets (repository_key, bucket_hour_utc)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS llm_usage_summary_buckets_model_hour_idx ON llm_usage_summary_buckets (provider, model_key, bucket_hour_utc)",
	);
	await ensureColumn(
		"llm_usage_summary_buckets",
		"measured_duration_call_count",
		"measured_duration_call_count integer DEFAULT 0 NOT NULL",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS llm_usage_summary_warnings (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      bucket_hour_utc integer NOT NULL,
      repository_id text,
      repository_key text NOT NULL,
      provider text NOT NULL,
      model text,
      model_key text NOT NULL,
      code text NOT NULL,
      detail_key text NOT NULL,
      detail_json text,
      call_count integer DEFAULT 0 NOT NULL,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS llm_usage_summary_warnings_uidx ON llm_usage_summary_warnings (bucket_hour_utc, repository_key, provider, model_key, code, detail_key)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS llm_usage_summary_warnings_repository_hour_idx ON llm_usage_summary_warnings (repository_key, bucket_hour_utc)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS llm_usage_summary_warnings_code_idx ON llm_usage_summary_warnings (code)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS llm_usage_summary_task_buckets (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      bucket_hour_utc integer NOT NULL,
      repository_id text,
      repository_key text NOT NULL,
      task_id text NOT NULL,
      pricing_currency_code text,
      pricing_currency_key text NOT NULL,
      pricing_status text NOT NULL,
      input_tokens integer DEFAULT 0 NOT NULL,
      output_tokens integer DEFAULT 0 NOT NULL,
      cached_input_tokens integer DEFAULT 0 NOT NULL,
      reasoning_output_tokens integer DEFAULT 0 NOT NULL,
      system_prompt_tokens integer DEFAULT 0 NOT NULL,
      user_prompt_tokens integer DEFAULT 0 NOT NULL,
      state_card_tokens integer DEFAULT 0 NOT NULL,
      total_tokens integer DEFAULT 0 NOT NULL,
      total_duration_ms integer DEFAULT 0 NOT NULL,
      output_duration_ms integer DEFAULT 0 NOT NULL,
      measured_duration_call_count integer DEFAULT 0 NOT NULL,
      call_count integer DEFAULT 0 NOT NULL,
      priced_call_count integer DEFAULT 0 NOT NULL,
      estimated_cost real DEFAULT 0 NOT NULL,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS llm_usage_summary_task_buckets_uidx ON llm_usage_summary_task_buckets (bucket_hour_utc, repository_key, task_id, pricing_currency_key, pricing_status)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS llm_usage_summary_task_buckets_repository_idx ON llm_usage_summary_task_buckets (repository_key, task_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS llm_usage_summary_task_buckets_hour_idx ON llm_usage_summary_task_buckets (bucket_hour_utc)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS activity_artifacts (
      id text PRIMARY KEY NOT NULL,
      task_id text NOT NULL,
      run_id text,
      kind text NOT NULL,
      path text,
      content_text text,
      metadata_json text,
      created_at integer NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE set null
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS activity_artifacts_task_id_idx ON activity_artifacts (task_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS activity_artifacts_run_id_idx ON activity_artifacts (run_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS activity_artifacts_kind_created_at_idx ON activity_artifacts (kind, created_at)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS activity_events (
      id text PRIMARY KEY NOT NULL,
      task_id text NOT NULL,
      run_id text,
      turn_id text,
      parent_event_id text,
      seq integer NOT NULL,
      run_seq integer,
      kind text NOT NULL,
      source text NOT NULL,
      status text,
      text text,
      payload_json text,
      artifact_id text,
      client_temp_id text,
      external_id text,
      dedupe_key text,
      ingest_error text,
      visibility text DEFAULT 'visible' NOT NULL,
      created_at integer NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE set null,
      FOREIGN KEY (artifact_id) REFERENCES activity_artifacts(id) ON DELETE set null
    )
  `);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS activity_events_task_seq_uidx ON activity_events (task_id, seq)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS activity_events_task_created_at_idx ON activity_events (task_id, created_at)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS activity_events_run_seq_idx ON activity_events (run_id, run_seq)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS activity_events_turn_seq_idx ON activity_events (turn_id, seq)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS activity_events_kind_created_at_idx ON activity_events (kind, created_at)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS activity_events_artifact_id_idx ON activity_events (artifact_id)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS activity_events_dedupe_key_uidx ON activity_events (dedupe_key)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS background_processes (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      repository_id text NOT NULL,
      task_id text,
      run_id text,
      command text NOT NULL,
      cwd text NOT NULL,
      status text DEFAULT 'running' NOT NULL,
      pid integer,
      exit_code integer,
      signal text,
      started_at integer NOT NULL,
      ended_at integer,
      stop_reason text,
      latest_output text DEFAULT '' NOT NULL,
      output_artifact_id text,
      metadata_json text,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE set null,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE set null,
      FOREIGN KEY (output_artifact_id) REFERENCES activity_artifacts(id) ON DELETE set null
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS background_processes_repository_status_idx ON background_processes (repository_id, status)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS background_processes_task_status_idx ON background_processes (task_id, status)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS background_processes_run_status_idx ON background_processes (run_id, status)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS task_run_todos (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      run_id text NOT NULL,
      seq integer NOT NULL,
      title text NOT NULL,
      description text,
      task_type text NOT NULL,
      status text DEFAULT 'pending' NOT NULL,
      procedure_id text,
      procedure_snapshot text,
      context_snapshot text,
      completion_gate_result text,
      depends_on text,
      status_reason text,
      started_at integer,
      completed_at integer,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade
    )
  `);

	await client.execute(
		"CREATE INDEX IF NOT EXISTS task_run_todos_run_id_idx ON task_run_todos (run_id)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS task_run_todos_run_seq_uidx ON task_run_todos (run_id, seq)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS task_run_commit_records (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      run_id text NOT NULL UNIQUE,
      repository_id text NOT NULL,
      status text DEFAULT 'pending' NOT NULL,
      baseline_head text,
      baseline_status_json text,
      pre_existing_dirty_paths_json text,
      owned_candidate_paths_json text,
      stageable_owned_paths_json text,
      excluded_paths_json text,
      verification_status text DEFAULT 'not_run' NOT NULL,
      verification_evidence_json text,
      commit_sha text,
      commit_message text,
      push_status text,
      pushed_at integer,
      push_remote text,
      push_branch text,
      status_reason text,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
	await ensureColumn(
		"task_run_commit_records",
		"push_status",
		"push_status text",
	);
	await ensureColumn(
		"task_run_commit_records",
		"pushed_at",
		"pushed_at integer",
	);
	await ensureColumn(
		"task_run_commit_records",
		"push_remote",
		"push_remote text",
	);
	await ensureColumn(
		"task_run_commit_records",
		"push_branch",
		"push_branch text",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS task_run_commit_records_run_id_uidx ON task_run_commit_records (run_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS task_run_commit_records_repository_status_idx ON task_run_commit_records (repository_id, status)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS implementation_queue_entries (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      repository_id text NOT NULL,
      status text DEFAULT 'queued' NOT NULL,
      priority integer DEFAULT 0 NOT NULL,
      queue_position integer,
      processor_slot integer,
      active_run_id text,
      claimed_at integer,
      last_heartbeat_at integer,
      archived_at integer,
      status_reason text,
      lease_owner_id text,
      lease_acquired_at integer,
      lease_expires_at integer,
      lease_version integer DEFAULT 0 NOT NULL,
      attempt_count integer DEFAULT 0 NOT NULL,
      recovered_at integer,
      recovery_reason text,
      last_failure_kind text,
      execution_type text DEFAULT 'normal' NOT NULL,
      execution_lock_key text,
      sequence_group_id text,
      sequence_order integer,
      sequence_depends_on_entry_id text,
      scheduling_reason text,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
      FOREIGN KEY (active_run_id) REFERENCES task_runs(id) ON DELETE set null
    )
  `);
	await ensureColumn(
		"implementation_queue_entries",
		"lease_owner_id",
		"lease_owner_id text",
	);
	await ensureColumn(
		"implementation_queue_entries",
		"lease_acquired_at",
		"lease_acquired_at integer",
	);
	await ensureColumn(
		"implementation_queue_entries",
		"lease_expires_at",
		"lease_expires_at integer",
	);
	await ensureColumn(
		"implementation_queue_entries",
		"lease_version",
		"lease_version integer DEFAULT 0 NOT NULL",
	);
	await ensureColumn(
		"implementation_queue_entries",
		"attempt_count",
		"attempt_count integer DEFAULT 0 NOT NULL",
	);
	await ensureColumn(
		"implementation_queue_entries",
		"recovered_at",
		"recovered_at integer",
	);
	await ensureColumn(
		"implementation_queue_entries",
		"recovery_reason",
		"recovery_reason text",
	);
	await ensureColumn(
		"implementation_queue_entries",
		"last_failure_kind",
		"last_failure_kind text",
	);
	await ensureColumn(
		"implementation_queue_entries",
		"execution_type",
		"execution_type text DEFAULT 'normal' NOT NULL",
	);
	await ensureColumn(
		"implementation_queue_entries",
		"execution_lock_key",
		"execution_lock_key text",
	);
	await ensureColumn(
		"implementation_queue_entries",
		"sequence_group_id",
		"sequence_group_id text",
	);
	await ensureColumn(
		"implementation_queue_entries",
		"sequence_order",
		"sequence_order integer",
	);
	await ensureColumn(
		"implementation_queue_entries",
		"sequence_depends_on_entry_id",
		"sequence_depends_on_entry_id text",
	);
	await ensureColumn(
		"implementation_queue_entries",
		"scheduling_reason",
		"scheduling_reason text",
	);
	await client.execute(`
    UPDATE implementation_queue_entries
    SET execution_lock_key = 'repository:' || repository_id
    WHERE execution_lock_key IS NULL
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS implementation_queue_entries_task_id_idx ON implementation_queue_entries (task_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS implementation_queue_entries_repository_status_idx ON implementation_queue_entries (repository_id, status)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS implementation_queue_entries_claim_order_idx ON implementation_queue_entries (status, priority, queue_position, created_at)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS implementation_queue_entries_lease_expiry_idx ON implementation_queue_entries (status, lease_expires_at)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS implementation_queue_entries_active_run_idx ON implementation_queue_entries (active_run_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS implementation_queue_entries_lease_owner_idx ON implementation_queue_entries (lease_owner_id, lease_expires_at)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS implementation_queue_entries_scheduling_idx ON implementation_queue_entries (repository_id, execution_lock_key, execution_type, status)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS implementation_queue_entries_sequence_idx ON implementation_queue_entries (sequence_group_id, sequence_order)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS implementation_queue_settings (
      id text PRIMARY KEY NOT NULL,
      processor_count integer DEFAULT 1 NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    )
  `);
	await client.execute(`
    INSERT INTO implementation_queue_settings (id, processor_count, created_at, updated_at)
    SELECT 'global', 1, unixepoch() * 1000, unixepoch() * 1000
    WHERE NOT EXISTS (SELECT 1 FROM implementation_queue_settings WHERE id = 'global')
  `);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS todo_workflow_settings (
      id text PRIMARY KEY NOT NULL,
      require_per_todo_review integer DEFAULT true NOT NULL,
      require_per_todo_fix integer DEFAULT true NOT NULL,
      require_final_verification integer DEFAULT true NOT NULL,
      require_register_candidate_prompt integer DEFAULT true NOT NULL,
      ask_commit_on_completion integer DEFAULT true NOT NULL,
      hook_policy_json text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    )
  `);
	await ensureColumn(
		"todo_workflow_settings",
		"require_register_candidate_prompt",
		"require_register_candidate_prompt integer DEFAULT true NOT NULL",
	);
	await client.execute(`
    INSERT INTO todo_workflow_settings (
      id,
      require_per_todo_review,
      require_per_todo_fix,
      require_final_verification,
      require_register_candidate_prompt,
      ask_commit_on_completion,
      created_at,
      updated_at
    )
    SELECT 'global', true, true, true, true, true, unixepoch() * 1000, unixepoch() * 1000
    WHERE NOT EXISTS (SELECT 1 FROM todo_workflow_settings WHERE id = 'global')
  `);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS blueprint_design_settings (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      settings_json text NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade
    )
  `);

	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS blueprint_design_settings_task_id_uidx ON blueprint_design_settings (task_id)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS blueprint_artifact_adoptions (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      message_id text NOT NULL,
      adopted integer DEFAULT false NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (message_id) REFERENCES task_messages(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS blueprint_artifact_adoptions_task_id_idx ON blueprint_artifact_adoptions (task_id)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS blueprint_artifact_adoptions_message_uidx ON blueprint_artifact_adoptions (task_id, message_id)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS blueprint_design_token_adoptions (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      message_id text NOT NULL,
      adopted integer DEFAULT false NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (message_id) REFERENCES task_messages(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS blueprint_design_token_adoptions_task_id_idx ON blueprint_design_token_adoptions (task_id)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS blueprint_design_token_adoptions_message_uidx ON blueprint_design_token_adoptions (task_id, message_id)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS design_questionnaire_sessions (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      repository_id text NOT NULL,
      source_blueprint_message_id text,
      status text DEFAULT 'draft' NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
      FOREIGN KEY (source_blueprint_message_id) REFERENCES task_messages(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS design_questionnaire_sessions_task_idx ON design_questionnaire_sessions (task_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS design_questionnaire_sessions_repository_idx ON design_questionnaire_sessions (repository_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS design_questionnaire_sessions_source_blueprint_idx ON design_questionnaire_sessions (source_blueprint_message_id)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS design_questionnaire_question_sets (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      session_id text NOT NULL,
      sequence integer NOT NULL,
      questionnaire_json text,
      raw_output text,
      validation_status text DEFAULT 'valid' NOT NULL,
      FOREIGN KEY (session_id) REFERENCES design_questionnaire_sessions(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS design_questionnaire_question_sets_session_idx ON design_questionnaire_question_sets (session_id)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS design_questionnaire_question_sets_sequence_uidx ON design_questionnaire_question_sets (session_id, sequence)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS design_questionnaire_answers (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      session_id text NOT NULL,
      question_id text NOT NULL,
      answer_json text NOT NULL,
      answered_at integer NOT NULL,
      FOREIGN KEY (session_id) REFERENCES design_questionnaire_sessions(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS design_questionnaire_answers_session_idx ON design_questionnaire_answers (session_id)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS design_questionnaire_answers_question_uidx ON design_questionnaire_answers (session_id, question_id)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS design_questionnaire_reviews (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      session_id text NOT NULL,
      review_json text,
      published_message_id text,
      status text DEFAULT 'draft' NOT NULL,
      FOREIGN KEY (session_id) REFERENCES design_questionnaire_sessions(id) ON DELETE cascade,
      FOREIGN KEY (published_message_id) REFERENCES task_messages(id) ON DELETE set null
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS design_questionnaire_reviews_session_idx ON design_questionnaire_reviews (session_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS design_questionnaire_reviews_published_message_idx ON design_questionnaire_reviews (published_message_id)",
	);
}
