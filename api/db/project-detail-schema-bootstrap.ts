import { client } from "./client";

export async function ensureProjectDetailTables() {
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
		"CREATE INDEX IF NOT EXISTS project_quality_runs_repository_status_idx ON project_quality_runs (repository_id, status, created_at)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS project_quality_runs_repository_type_created_idx ON project_quality_runs (repository_id, run_type, created_at)",
	);
}

export async function ensureMissionPlannerTables() {
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
		"CREATE INDEX IF NOT EXISTS missions_repository_status_created_idx ON missions (repository_id, status, created_at)",
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
		"CREATE INDEX IF NOT EXISTS mission_decomp_runs_mission_created_idx ON mission_decomposition_runs (mission_id, created_at)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_decomp_runs_repository_created_idx ON mission_decomposition_runs (repository_id, created_at)",
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
		"CREATE INDEX IF NOT EXISTS mission_planning_results_mission_status_created_idx ON mission_planning_results (mission_id, status, created_at)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_planning_results_repository_status_created_idx ON mission_planning_results (repository_id, status, created_at)",
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
		"CREATE INDEX IF NOT EXISTS mission_task_proposals_mission_status_created_idx ON mission_task_proposals (mission_id, status, created_at)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_task_proposals_planning_status_idx ON mission_task_proposals (planning_result_id, status)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_task_proposals_task_idx ON mission_task_proposals (task_id)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_task_proposals_planning_task_uidx ON mission_task_proposals (planning_result_id, decomposition_task_id)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_task_proposals_task_uidx ON mission_task_proposals (task_id)",
	);
}
