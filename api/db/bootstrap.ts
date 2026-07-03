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

async function ensureProjectDetailTables() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS mission_goals (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      repository_id text NOT NULL,
      title text NOT NULL,
      goal_text text NOT NULL,
      active integer DEFAULT true NOT NULL,
      source text DEFAULT 'user' NOT NULL,
      sort_order integer DEFAULT 0 NOT NULL,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS mission_goals_repository_active_idx ON mission_goals (repository_id, active, sort_order)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS mission_task_candidate_batches (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      repository_id text NOT NULL,
      status text DEFAULT 'running' NOT NULL,
      requested_goal_ids_json text NOT NULL,
      signal_snapshot_json text NOT NULL,
      selected_model_json text,
      raw_output_json text,
      error_message text,
      started_at integer NOT NULL,
      completed_at integer,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS mission_batches_repository_created_idx ON mission_task_candidate_batches (repository_id, created_at)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS mission_task_candidates (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      batch_id text NOT NULL,
      repository_id text NOT NULL,
      goal_id text,
      title text NOT NULL,
      summary text NOT NULL,
      rationale text NOT NULL,
      evidence_json text NOT NULL,
      evaluation_contribution integer,
      importance_percent integer NOT NULL,
      confidence_percent integer NOT NULL,
      token_size text NOT NULL,
      complexity text NOT NULL,
      task_prompt text NOT NULL,
      acceptance_criteria text NOT NULL,
      verification_plan text NOT NULL,
      status text DEFAULT 'candidate' NOT NULL,
      task_id text,
      FOREIGN KEY (batch_id) REFERENCES mission_task_candidate_batches(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
      FOREIGN KEY (goal_id) REFERENCES mission_goals(id) ON DELETE set null,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE set null
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS mission_candidates_repository_status_idx ON mission_task_candidates (repository_id, status, created_at)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS mission_candidates_batch_idx ON mission_task_candidates (batch_id)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS mission_candidates_task_idx ON mission_task_candidates (task_id)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS project_quality_runs (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      repository_id text NOT NULL,
      run_type text NOT NULL,
      status text DEFAULT 'running' NOT NULL,
      command text NOT NULL,
      exit_code integer,
      started_at integer NOT NULL,
      completed_at integer,
      output_artifact_id text,
      latest_output text,
      coverage_summary_json text,
      coverage_gate_json text,
      e2e_summary_json text,
      error_message text,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS project_quality_runs_repository_status_idx ON project_quality_runs (repository_id, status, created_at)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS project_quality_runs_repository_type_created_idx ON project_quality_runs (repository_id, run_type, created_at)'
  );
}

async function ensureMissionPlannerTables() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS missions (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      repository_id text NOT NULL,
      title text NOT NULL,
      goal_text text NOT NULL,
      non_goals_json text DEFAULT '[]' NOT NULL,
      status text DEFAULT 'draft' NOT NULL,
      source_goal_ids_json text DEFAULT '[]' NOT NULL,
      latest_planning_result_id text,
      status_reason text,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS missions_repository_status_created_idx ON missions (repository_id, status, created_at)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS mission_decomposition_runs (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      mission_id text NOT NULL,
      repository_id text NOT NULL,
      status text DEFAULT 'running' NOT NULL,
      input_bundle_json text NOT NULL,
      stage_outputs_json text NOT NULL,
      selected_models_json text NOT NULL,
      error_message text,
      started_at integer NOT NULL,
      completed_at integer,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS mission_decomp_runs_mission_created_idx ON mission_decomposition_runs (mission_id, created_at)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS mission_decomp_runs_repository_created_idx ON mission_decomposition_runs (repository_id, created_at)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS mission_planning_results (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      mission_id text NOT NULL,
      repository_id text NOT NULL,
      decomposition_run_id text NOT NULL,
      status text DEFAULT 'draft' NOT NULL,
      planning_result_json text NOT NULL,
      deterministic_checks_json text,
      evaluation_json text,
      status_reason text,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
      FOREIGN KEY (decomposition_run_id) REFERENCES mission_decomposition_runs(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS mission_planning_results_mission_status_created_idx ON mission_planning_results (mission_id, status, created_at)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS mission_planning_results_repository_status_created_idx ON mission_planning_results (repository_id, status, created_at)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS mission_task_proposals (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      mission_id text NOT NULL,
      planning_result_id text NOT NULL,
      repository_id text NOT NULL,
      work_package_id text NOT NULL,
      decomposition_task_id text NOT NULL,
      status text DEFAULT 'proposed' NOT NULL,
      title text NOT NULL,
      summary text NOT NULL,
      initial_prompt text NOT NULL,
      expected_outcome text NOT NULL,
      implementation_focus_json text NOT NULL,
      acceptance_criteria_json text NOT NULL,
      verification_gate_json text NOT NULL,
      dependencies_json text NOT NULL,
      target_files_or_modules_json text NOT NULL,
      risk text NOT NULL,
      approval_required integer DEFAULT false NOT NULL,
      scheduling_json text NOT NULL,
      task_id text,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE cascade,
      FOREIGN KEY (planning_result_id) REFERENCES mission_planning_results(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE set null
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS mission_task_proposals_mission_status_created_idx ON mission_task_proposals (mission_id, status, created_at)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS mission_task_proposals_planning_status_idx ON mission_task_proposals (planning_result_id, status)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS mission_task_proposals_task_idx ON mission_task_proposals (task_id)'
  );
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS mission_task_proposals_planning_task_uidx ON mission_task_proposals (planning_result_id, decomposition_task_id)'
  );
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS mission_task_proposals_task_uidx ON mission_task_proposals (task_id)'
  );
}

async function ensureReviewModeTables() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS review_recommendations (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      run_id text NOT NULL,
      task_id text NOT NULL,
      repository_id text NOT NULL,
      level text NOT NULL,
      default_action text NOT NULL,
      reasons_json text NOT NULL,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS review_recommendations_run_uidx ON review_recommendations (run_id)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS review_recommendations_task_idx ON review_recommendations (task_id)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS review_recommendations_repository_level_idx ON review_recommendations (repository_id, level)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS review_sessions (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      run_id text NOT NULL,
      task_id text NOT NULL,
      repository_id text NOT NULL,
      status text DEFAULT 'not_started' NOT NULL,
      recommendation_id text,
      started_at integer,
      completed_at integer,
      final_action text,
      final_note text,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
      FOREIGN KEY (recommendation_id) REFERENCES review_recommendations(id) ON DELETE set null
    )
  `);
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS review_sessions_run_uidx ON review_sessions (run_id)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS review_sessions_task_status_idx ON review_sessions (task_id, status)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS review_artifacts (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      review_session_id text NOT NULL,
      run_id text NOT NULL,
      task_id text NOT NULL,
      kind text NOT NULL,
      status text DEFAULT 'not_started' NOT NULL,
      artifact_json text,
      source_evidence_refs_json text NOT NULL,
      FOREIGN KEY (review_session_id) REFERENCES review_sessions(id) ON DELETE cascade,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS review_artifacts_session_kind_uidx ON review_artifacts (review_session_id, kind)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS review_artifacts_run_kind_idx ON review_artifacts (run_id, kind)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS review_findings (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      review_session_id text NOT NULL,
      run_id text NOT NULL,
      task_id text NOT NULL,
      severity text NOT NULL,
      title text NOT NULL,
      body text,
      disposition text,
      disposition_status text DEFAULT 'unresolved' NOT NULL,
      disposition_note text,
      evidence_refs_json text NOT NULL,
      source_section text,
      created_goal_id text,
      created_task_proposal_id text,
      context_still_candidate_id text,
      FOREIGN KEY (review_session_id) REFERENCES review_sessions(id) ON DELETE cascade,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS review_findings_session_status_idx ON review_findings (review_session_id, disposition_status)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS review_findings_run_severity_idx ON review_findings (run_id, severity)'
  );
  await ensureColumn('review_findings', 'disposition_note', 'disposition_note text');
  await ensureColumn('review_findings', 'source_section', 'source_section text');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS review_knowledge_candidates (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      review_session_id text NOT NULL,
      finding_id text NOT NULL,
      candidate_type text NOT NULL,
      title text NOT NULL,
      body text NOT NULL,
      avoid text,
      prefer text,
      status text DEFAULT 'draft' NOT NULL,
      context_still_candidate_id text,
      send_error text,
      FOREIGN KEY (review_session_id) REFERENCES review_sessions(id) ON DELETE cascade,
      FOREIGN KEY (finding_id) REFERENCES review_findings(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS review_knowledge_candidates_session_status_idx ON review_knowledge_candidates (review_session_id, status)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS review_knowledge_candidates_finding_idx ON review_knowledge_candidates (finding_id)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS review_proposed_goals (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      review_session_id text NOT NULL,
      finding_id text NOT NULL,
      run_id text NOT NULL,
      task_id text NOT NULL,
      repository_id text NOT NULL,
      title text NOT NULL,
      expected_outcome text NOT NULL,
      acceptance_criteria text NOT NULL,
      verification_gate text NOT NULL,
      evidence_refs_json text NOT NULL,
      status text DEFAULT 'draft' NOT NULL,
      decision_note text,
      materialized_task_id text,
      materialization_target text,
      materialization_error text,
      FOREIGN KEY (review_session_id) REFERENCES review_sessions(id) ON DELETE cascade,
      FOREIGN KEY (finding_id) REFERENCES review_findings(id) ON DELETE cascade,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
      FOREIGN KEY (materialized_task_id) REFERENCES tasks(id) ON DELETE set null
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS review_proposed_goals_session_status_idx ON review_proposed_goals (review_session_id, status)'
  );
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS review_proposed_goals_finding_uidx ON review_proposed_goals (finding_id)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS review_security_handoffs (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      review_session_id text NOT NULL,
      finding_id text NOT NULL,
      run_id text NOT NULL,
      task_id text NOT NULL,
      repository_id text NOT NULL,
      title text NOT NULL,
      summary text NOT NULL,
      requested_integration text,
      status text DEFAULT 'needs_configuration' NOT NULL,
      changed_paths_json text NOT NULL,
      evidence_refs_json text NOT NULL,
      handoff_artifact_json text,
      FOREIGN KEY (review_session_id) REFERENCES review_sessions(id) ON DELETE cascade,
      FOREIGN KEY (finding_id) REFERENCES review_findings(id) ON DELETE cascade,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS review_security_handoffs_session_status_idx ON review_security_handoffs (review_session_id, status)'
  );
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS review_security_handoffs_finding_uidx ON review_security_handoffs (finding_id)'
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
  await ensureProjectDetailTables();
  await ensureMissionPlannerTables();
  await ensureReviewModeTables();

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
    'CREATE UNIQUE INDEX IF NOT EXISTS native_api_turns_run_turn_uidx ON native_api_turns (run_id, turn_index)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS native_api_turns_run_status_idx ON native_api_turns (run_id, status)'
  );
  await ensureColumn('native_api_turns', 'execution_mode', 'execution_mode text');
  await client.execute(
    'CREATE INDEX IF NOT EXISTS native_api_turns_resume_idx ON native_api_turns (task_id, status, provider, model, execution_mode, finished_at)'
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
    'CREATE INDEX IF NOT EXISTS runtime_session_states_run_idx ON runtime_session_states (run_id)'
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
      status_reason text,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS task_run_commit_records_run_id_uidx ON task_run_commit_records (run_id)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS task_run_commit_records_repository_status_idx ON task_run_commit_records (repository_id, status)'
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
  await ensureColumn('implementation_queue_entries', 'lease_owner_id', 'lease_owner_id text');
  await ensureColumn(
    'implementation_queue_entries',
    'lease_acquired_at',
    'lease_acquired_at integer'
  );
  await ensureColumn(
    'implementation_queue_entries',
    'lease_expires_at',
    'lease_expires_at integer'
  );
  await ensureColumn(
    'implementation_queue_entries',
    'lease_version',
    'lease_version integer DEFAULT 0 NOT NULL'
  );
  await ensureColumn(
    'implementation_queue_entries',
    'attempt_count',
    'attempt_count integer DEFAULT 0 NOT NULL'
  );
  await ensureColumn('implementation_queue_entries', 'recovered_at', 'recovered_at integer');
  await ensureColumn('implementation_queue_entries', 'recovery_reason', 'recovery_reason text');
  await ensureColumn('implementation_queue_entries', 'last_failure_kind', 'last_failure_kind text');
  await ensureColumn(
    'implementation_queue_entries',
    'execution_type',
    "execution_type text DEFAULT 'normal' NOT NULL"
  );
  await ensureColumn(
    'implementation_queue_entries',
    'execution_lock_key',
    'execution_lock_key text'
  );
  await ensureColumn('implementation_queue_entries', 'sequence_group_id', 'sequence_group_id text');
  await ensureColumn('implementation_queue_entries', 'sequence_order', 'sequence_order integer');
  await ensureColumn(
    'implementation_queue_entries',
    'sequence_depends_on_entry_id',
    'sequence_depends_on_entry_id text'
  );
  await ensureColumn('implementation_queue_entries', 'scheduling_reason', 'scheduling_reason text');
  await client.execute(`
    UPDATE implementation_queue_entries
    SET execution_lock_key = 'repository:' || repository_id
    WHERE execution_lock_key IS NULL
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
  await client.execute(
    'CREATE INDEX IF NOT EXISTS implementation_queue_entries_lease_expiry_idx ON implementation_queue_entries (status, lease_expires_at)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS implementation_queue_entries_active_run_idx ON implementation_queue_entries (active_run_id)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS implementation_queue_entries_lease_owner_idx ON implementation_queue_entries (lease_owner_id, lease_expires_at)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS implementation_queue_entries_scheduling_idx ON implementation_queue_entries (repository_id, execution_lock_key, execution_type, status)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS implementation_queue_entries_sequence_idx ON implementation_queue_entries (sequence_group_id, sequence_order)'
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
    'todo_workflow_settings',
    'require_register_candidate_prompt',
    'require_register_candidate_prompt integer DEFAULT true NOT NULL'
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

async function ensureColumn(table: string, column: string, definition: string) {
  const columns = await client.execute(`PRAGMA table_info(${table})`);
  const exists = columns.rows.some((row) => row.name === column);
  if (columns.rows.length > 0 && !exists) {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}
