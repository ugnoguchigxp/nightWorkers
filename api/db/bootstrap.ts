import { client } from './client';

export async function ensureNightWorkersSchema() {
  await client.execute('PRAGMA foreign_keys = ON');
  await client.execute('PRAGMA busy_timeout = 5000');
  await ensureBaseNightWorkersTables();

  const taskRunColumns = await client.execute('PRAGMA table_info(task_runs)');
  const hasFinalJudgmentColumn = taskRunColumns.rows.some((row) => row.name === 'final_judgment');
  if (taskRunColumns.rows.length > 0 && !hasFinalJudgmentColumn) {
    await client.execute('ALTER TABLE task_runs ADD COLUMN final_judgment text');
  }

  const repositoryColumns = await client.execute('PRAGMA table_info(repositories)');
  const hasQueueEnabledColumn = repositoryColumns.rows.some((row) => row.name === 'queue_enabled');
  if (repositoryColumns.rows.length > 0 && !hasQueueEnabledColumn) {
    await client.execute(
      'ALTER TABLE repositories ADD COLUMN queue_enabled integer DEFAULT false NOT NULL'
    );
  }
  const hasMaxConcurrentSessionsColumn = repositoryColumns.rows.some(
    (row) => row.name === 'max_concurrent_sessions'
  );
  if (repositoryColumns.rows.length > 0 && !hasMaxConcurrentSessionsColumn) {
    await client.execute(
      'ALTER TABLE repositories ADD COLUMN max_concurrent_sessions integer DEFAULT 1 NOT NULL'
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
    'CREATE INDEX IF NOT EXISTS task_messages_task_id_idx ON task_messages (task_id)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS task_messages_run_id_idx ON task_messages (run_id)'
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
    'CREATE INDEX IF NOT EXISTS conversation_context_snapshots_task_id_idx ON conversation_context_snapshots (task_id)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS conversation_context_snapshots_run_id_idx ON conversation_context_snapshots (run_id)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS conversation_context_snapshots_task_updated_idx ON conversation_context_snapshots (task_id, updated_at)'
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
    'CREATE INDEX IF NOT EXISTS llm_usage_records_task_created_idx ON llm_usage_records (task_id, created_at)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS llm_usage_records_run_created_idx ON llm_usage_records (run_id, created_at)'
  );
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS llm_usage_records_call_id_uidx ON llm_usage_records (call_id)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS llm_usage_records_provider_created_idx ON llm_usage_records (provider, created_at)'
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
    'CREATE INDEX IF NOT EXISTS llm_model_pricing_provider_model_idx ON llm_model_pricing (provider, model)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS llm_model_pricing_enabled_idx ON llm_model_pricing (enabled)'
  );
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS llm_model_pricing_provider_model_currency_effective_uidx ON llm_model_pricing (provider, model, currency_code, effective_from)'
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
    'CREATE INDEX IF NOT EXISTS activity_artifacts_task_id_idx ON activity_artifacts (task_id)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS activity_artifacts_run_id_idx ON activity_artifacts (run_id)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS activity_artifacts_kind_created_at_idx ON activity_artifacts (kind, created_at)'
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
    'CREATE UNIQUE INDEX IF NOT EXISTS activity_events_task_seq_uidx ON activity_events (task_id, seq)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS activity_events_task_created_at_idx ON activity_events (task_id, created_at)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS activity_events_run_seq_idx ON activity_events (run_id, run_seq)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS activity_events_turn_seq_idx ON activity_events (turn_id, seq)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS activity_events_kind_created_at_idx ON activity_events (kind, created_at)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS activity_events_artifact_id_idx ON activity_events (artifact_id)'
  );
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS activity_events_dedupe_key_uidx ON activity_events (dedupe_key)'
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
    'CREATE INDEX IF NOT EXISTS task_run_todos_run_id_idx ON task_run_todos (run_id)'
  );
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS task_run_todos_run_seq_uidx ON task_run_todos (run_id, seq)'
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
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
      FOREIGN KEY (active_run_id) REFERENCES task_runs(id) ON DELETE set null
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS implementation_queue_entries_task_id_idx ON implementation_queue_entries (task_id)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS implementation_queue_entries_repository_status_idx ON implementation_queue_entries (repository_id, status)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS implementation_queue_entries_claim_order_idx ON implementation_queue_entries (status, priority, queue_position, created_at)'
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
      ask_commit_on_completion integer DEFAULT true NOT NULL,
      hook_policy_json text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    )
  `);
  await client.execute(`
    INSERT INTO todo_workflow_settings (
      id,
      require_per_todo_review,
      require_per_todo_fix,
      require_final_verification,
      ask_commit_on_completion,
      created_at,
      updated_at
    )
    SELECT 'global', true, true, true, true, unixepoch() * 1000, unixepoch() * 1000
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
    'CREATE UNIQUE INDEX IF NOT EXISTS blueprint_design_settings_task_id_uidx ON blueprint_design_settings (task_id)'
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
    'CREATE INDEX IF NOT EXISTS blueprint_artifact_adoptions_task_id_idx ON blueprint_artifact_adoptions (task_id)'
  );
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS blueprint_artifact_adoptions_message_uidx ON blueprint_artifact_adoptions (task_id, message_id)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS blueprint_db_design_adoptions (
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
    'CREATE INDEX IF NOT EXISTS blueprint_db_design_adoptions_task_id_idx ON blueprint_db_design_adoptions (task_id)'
  );
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS blueprint_db_design_adoptions_message_uidx ON blueprint_db_design_adoptions (task_id, message_id)'
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
    'CREATE INDEX IF NOT EXISTS blueprint_design_token_adoptions_task_id_idx ON blueprint_design_token_adoptions (task_id)'
  );
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS blueprint_design_token_adoptions_message_uidx ON blueprint_design_token_adoptions (task_id, message_id)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS design_questionnaire_sessions (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      repository_id text NOT NULL,
      source_blueprint_message_id text NOT NULL,
      status text DEFAULT 'draft' NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
      FOREIGN KEY (source_blueprint_message_id) REFERENCES task_messages(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS design_questionnaire_sessions_task_idx ON design_questionnaire_sessions (task_id)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS design_questionnaire_sessions_repository_idx ON design_questionnaire_sessions (repository_id)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS design_questionnaire_sessions_source_blueprint_idx ON design_questionnaire_sessions (source_blueprint_message_id)'
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
    'CREATE INDEX IF NOT EXISTS design_questionnaire_question_sets_session_idx ON design_questionnaire_question_sets (session_id)'
  );
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS design_questionnaire_question_sets_sequence_uidx ON design_questionnaire_question_sets (session_id, sequence)'
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
    'CREATE INDEX IF NOT EXISTS design_questionnaire_answers_session_idx ON design_questionnaire_answers (session_id)'
  );
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS design_questionnaire_answers_question_uidx ON design_questionnaire_answers (session_id, question_id)'
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
    'CREATE INDEX IF NOT EXISTS design_questionnaire_reviews_session_idx ON design_questionnaire_reviews (session_id)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS design_questionnaire_reviews_published_message_idx ON design_questionnaire_reviews (published_message_id)'
  );
}

async function ensureBaseNightWorkersTables() {
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
    'CREATE INDEX IF NOT EXISTS tasks_repository_id_idx ON tasks (repository_id)'
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
  await client.execute('CREATE INDEX IF NOT EXISTS task_runs_task_id_idx ON task_runs (task_id)');

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
    'CREATE INDEX IF NOT EXISTS task_events_task_run_id_idx ON task_events (task_run_id)'
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
  await client.execute('CREATE INDEX IF NOT EXISTS artifacts_run_id_idx ON artifacts (run_id)');
}
