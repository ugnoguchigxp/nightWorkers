import { client } from "./client";
import { ensureColumn } from "./schema-bootstrap-utils";

export async function ensureRuntimeAndUsageTables() {
	await client.execute(`
    CREATE TABLE IF NOT EXISTS agent_mode_sessions (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      repository_id text NOT NULL,
      epoch integer NOT NULL,
      predecessor_session_id text,
      execution_mode text NOT NULL,
      llm_role text NOT NULL,
      runtime_lane text NOT NULL,
      provider text,
      provider_endpoint_id text,
      model text,
      thinking_depth text,
      route_fingerprint text NOT NULL,
      status text NOT NULL,
      close_reason text,
      opened_at integer NOT NULL,
      closed_at integer,
      FOREIGN KEY (predecessor_session_id) REFERENCES agent_mode_sessions(id) ON DELETE set null
    )
  `);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS agent_mode_sessions_task_epoch_uidx ON agent_mode_sessions (task_id, epoch)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS agent_mode_sessions_active_task_uidx ON agent_mode_sessions (task_id) WHERE status = 'active'",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS agent_mode_sessions_task_status_updated_idx ON agent_mode_sessions (task_id, status, updated_at)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS agent_mode_sessions_predecessor_idx ON agent_mode_sessions (predecessor_session_id)",
	);
	await ensureColumn(
		"task_runs",
		"agent_mode_session_id",
		"agent_mode_session_id text",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS task_runs_agent_mode_session_started_idx ON task_runs (agent_mode_session_id, started_at)",
	);
	await client.execute(`
    CREATE TABLE IF NOT EXISTS task_messages (
      id text PRIMARY KEY NOT NULL,
      task_id text NOT NULL,
      run_id text,
      role text NOT NULL,
      content text NOT NULL,
      message_type text,
      metadata_json text,
      trace_owner text DEFAULT 'system' NOT NULL,
      trace_channel text DEFAULT 'internal' NOT NULL,
      created_at integer NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE set null
    )
  `);
	await ensureColumn(
		"task_messages",
		"trace_owner",
		"trace_owner text DEFAULT 'system' NOT NULL",
	);
	await ensureColumn(
		"task_messages",
		"trace_channel",
		"trace_channel text DEFAULT 'internal' NOT NULL",
	);

	await client.execute(
		"CREATE INDEX IF NOT EXISTS task_messages_task_id_idx ON task_messages (task_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS task_messages_run_id_idx ON task_messages (run_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS task_messages_task_channel_created_idx ON task_messages (task_id, trace_channel, created_at)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS native_api_turns (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      run_id text NOT NULL,
      task_id text NOT NULL,
      agent_mode_session_id text,
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
	await ensureColumn(
		"native_api_turns",
		"agent_mode_session_id",
		"agent_mode_session_id text",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS native_api_turns_resume_idx ON native_api_turns (task_id, status, provider, model, execution_mode, finished_at)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS native_api_turns_agent_mode_session_resume_idx ON native_api_turns (agent_mode_session_id, status, finished_at)",
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
      agent_mode_session_id text,
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
	await ensureColumn(
		"runtime_session_states",
		"agent_mode_session_id",
		"agent_mode_session_id text",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS runtime_session_states_agent_mode_session_lookup_idx ON runtime_session_states (agent_mode_session_id, status, last_seen_at)",
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
      agent_mode_session_id text,
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
      trace_owner text DEFAULT 'system' NOT NULL,
      trace_channel text DEFAULT 'internal' NOT NULL,
      usage_counter_scope text,
      usage_normalization_status text,
      source_sequence integer,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE set null
    )
  `);
	await ensureColumn(
		"llm_usage_records",
		"trace_owner",
		"trace_owner text DEFAULT 'system' NOT NULL",
	);
	await ensureColumn(
		"llm_usage_records",
		"trace_channel",
		"trace_channel text DEFAULT 'internal' NOT NULL",
	);
	await ensureColumn(
		"llm_usage_records",
		"agent_mode_session_id",
		"agent_mode_session_id text",
	);
	await ensureColumn(
		"llm_usage_records",
		"usage_counter_scope",
		"usage_counter_scope text",
	);
	await ensureColumn(
		"llm_usage_records",
		"usage_normalization_status",
		"usage_normalization_status text",
	);
	await ensureColumn(
		"llm_usage_records",
		"source_sequence",
		"source_sequence integer",
	);
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
	await client.execute(
		"CREATE INDEX IF NOT EXISTS llm_usage_records_task_owner_created_idx ON llm_usage_records (task_id, trace_owner, created_at)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS llm_usage_records_agent_mode_session_created_idx ON llm_usage_records (agent_mode_session_id, created_at)",
	);
	await client.execute(`
    CREATE TABLE IF NOT EXISTS llm_usage_counter_checkpoints (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      agent_mode_session_id text NOT NULL,
      provider_session_key text NOT NULL,
      provider text NOT NULL,
      model text,
      counter_scope text NOT NULL,
      raw_input_tokens integer,
      raw_cached_input_tokens integer,
      raw_output_tokens integer,
      raw_reasoning_output_tokens integer,
      source_run_id text,
      source_sequence integer,
      state_version integer DEFAULT 0 NOT NULL,
      FOREIGN KEY (agent_mode_session_id) REFERENCES agent_mode_sessions(id) ON DELETE cascade,
      FOREIGN KEY (source_run_id) REFERENCES task_runs(id) ON DELETE set null
    )
  `);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS llm_usage_counter_checkpoints_session_provider_uidx ON llm_usage_counter_checkpoints (agent_mode_session_id, provider_session_key)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS llm_usage_counter_checkpoints_session_updated_idx ON llm_usage_counter_checkpoints (agent_mode_session_id, updated_at)",
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
    CREATE TABLE IF NOT EXISTS runtime_retention_audit_events (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      event_type text NOT NULL,
      status text NOT NULL,
      started_at integer NOT NULL,
      finished_at integer,
      settings_snapshot_json text,
      rows_deleted_json text,
      error_summary text
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS runtime_retention_audit_events_created_idx ON runtime_retention_audit_events (created_at)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS runtime_retention_audit_events_type_created_idx ON runtime_retention_audit_events (event_type, created_at)",
	);
}
