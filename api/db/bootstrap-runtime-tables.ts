import { client } from "./client";
import { ensureColumn } from "./schema-bootstrap-utils";

export async function ensureRuntimeAndUsageTables() {
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
      trace_owner text DEFAULT 'system' NOT NULL,
      trace_channel text DEFAULT 'internal' NOT NULL,
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
