import { ensureBaseNightWorkersTables } from './base-schema-bootstrap';
import { client } from './client';

async function ensureNullableDesignQuestionnaireBlueprintSource() {
  const columns = await client.execute('PRAGMA table_info(design_questionnaire_sessions)');
  const sourceColumn = columns.rows.find((row) => row.name === 'source_blueprint_message_id');
  if (!sourceColumn || sourceColumn.notnull !== 1) return;

  await client.execute('PRAGMA foreign_keys = OFF');
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
    await client.execute('DROP TABLE design_questionnaire_sessions');
    await client.execute(
      'ALTER TABLE design_questionnaire_sessions_next RENAME TO design_questionnaire_sessions'
    );
    await client.execute(
      'CREATE INDEX IF NOT EXISTS design_questionnaire_sessions_task_idx ON design_questionnaire_sessions (task_id)'
    );
    await client.execute(
      'CREATE INDEX IF NOT EXISTS design_questionnaire_sessions_repository_idx ON design_questionnaire_sessions (repository_id)'
    );
    await client.execute(
      'CREATE INDEX IF NOT EXISTS design_questionnaire_sessions_source_blueprint_idx ON design_questionnaire_sessions (source_blueprint_message_id)'
    );
  } finally {
    await client.execute('PRAGMA foreign_keys = ON');
  }
}

async function ensureProjectEvaluationTables() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS project_evaluation_runs (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      repository_id text NOT NULL,
      status text DEFAULT 'completed' NOT NULL,
      bundle_json text NOT NULL,
      raw_output_json text,
      summary text NOT NULL,
      overall_score real NOT NULL,
      overall_confidence real NOT NULL,
      evidence_level text DEFAULT 'repo-structure' NOT NULL,
      selected_model_json text,
      previous_evaluation_id text,
      strengths_json text,
      weaknesses_json text,
      next_evidence_to_collect_json text,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS project_eval_runs_repository_created_idx ON project_evaluation_runs (repository_id, created_at)'
  );
  const evaluationRunColumns = await client.execute('PRAGMA table_info(project_evaluation_runs)');
  const hasEvaluationStatusColumn = evaluationRunColumns.rows.some((row) => row.name === 'status');
  if (evaluationRunColumns.rows.length > 0 && !hasEvaluationStatusColumn) {
    await client.execute(
      "ALTER TABLE project_evaluation_runs ADD COLUMN status text DEFAULT 'completed' NOT NULL"
    );
  }

  await client.execute(`
    CREATE TABLE IF NOT EXISTS project_evaluation_dimensions (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      evaluation_id text NOT NULL,
      dimension_key text NOT NULL,
      label text NOT NULL,
      score real NOT NULL,
      confidence real NOT NULL,
      rationale text NOT NULL,
      evidence_json text,
      concerns_json text,
      FOREIGN KEY (evaluation_id) REFERENCES project_evaluation_runs(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS project_eval_dimensions_evaluation_idx ON project_evaluation_dimensions (evaluation_id)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS project_evaluation_activity_events (
      id text PRIMARY KEY NOT NULL,
      evaluation_id text NOT NULL,
      seq integer NOT NULL,
      phase text NOT NULL,
      level text NOT NULL,
      source text NOT NULL,
      message text NOT NULL,
      status text,
      payload_json text,
      created_at integer NOT NULL,
      FOREIGN KEY (evaluation_id) REFERENCES project_evaluation_runs(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS project_eval_activity_evaluation_seq_idx ON project_evaluation_activity_events (evaluation_id, seq)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS project_improvement_ideas (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      evaluation_id text NOT NULL,
      title text NOT NULL,
      summary text NOT NULL,
      agent_prompt text NOT NULL,
      expected_outcome text NOT NULL,
      implementation_focus_json text NOT NULL,
      target_dimensions_json text NOT NULL,
      FOREIGN KEY (evaluation_id) REFERENCES project_evaluation_runs(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS project_improvement_ideas_evaluation_idx ON project_improvement_ideas (evaluation_id)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS project_improvement_idea_score_impacts (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      idea_id text NOT NULL,
      dimension_key text NOT NULL,
      current_score integer NOT NULL,
      expected_score_gain integer NOT NULL,
      expected_score_after integer NOT NULL,
      rationale text NOT NULL,
      FOREIGN KEY (idea_id) REFERENCES project_improvement_ideas(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS project_improvement_score_impacts_idea_idx ON project_improvement_idea_score_impacts (idea_id)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS project_evaluation_task_links (
      id text PRIMARY KEY NOT NULL,
      evaluation_id text NOT NULL,
      idea_id text NOT NULL,
      task_id text NOT NULL,
      created_at integer NOT NULL,
      FOREIGN KEY (evaluation_id) REFERENCES project_evaluation_runs(id) ON DELETE cascade,
      FOREIGN KEY (idea_id) REFERENCES project_improvement_ideas(id) ON DELETE cascade,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS project_eval_task_links_evaluation_idx ON project_evaluation_task_links (evaluation_id)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS project_eval_task_links_idea_idx ON project_evaluation_task_links (idea_id)'
  );
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS project_eval_task_links_evaluation_idea_uidx ON project_evaluation_task_links (evaluation_id, idea_id)'
  );
}

export async function ensureNightWorkersSchema() {
  await client.execute('PRAGMA foreign_keys = ON');
  await client.execute('PRAGMA busy_timeout = 10000');
  await client.execute('PRAGMA journal_mode = WAL');

  // Drop legacy BBS tables if they exist
  await client.execute('DROP TABLE IF EXISTS comments');
  await client.execute('DROP TABLE IF EXISTS threads');

  await ensureBaseNightWorkersTables();
  await ensureNullableDesignQuestionnaireBlueprintSource();
  await ensureProjectEvaluationTables();

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
    'CREATE UNIQUE INDEX IF NOT EXISTS native_api_turns_run_turn_uidx ON native_api_turns (run_id, turn_index)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS native_api_turns_run_status_idx ON native_api_turns (run_id, status)'
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
    'CREATE UNIQUE INDEX IF NOT EXISTS native_api_tool_calls_run_call_uidx ON native_api_tool_calls (run_id, tool_call_id)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS native_api_tool_calls_run_status_idx ON native_api_tool_calls (run_id, status)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS native_api_tool_calls_turn_idx ON native_api_tool_calls (turn_id)'
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
    'CREATE INDEX IF NOT EXISTS background_processes_repository_status_idx ON background_processes (repository_id, status)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS background_processes_task_status_idx ON background_processes (task_id, status)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS background_processes_run_status_idx ON background_processes (run_id, status)'
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
      source_blueprint_message_id text,
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
