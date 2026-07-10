import { client } from "./client";
import { ensureColumn } from "./schema-bootstrap-utils";

export async function ensureTaskGenerationTables() {
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
      interpretation_scope text DEFAULT 'unknown' NOT NULL,
      interpretation_intent text DEFAULT 'unknown' NOT NULL,
      interpretation_source text DEFAULT 'unknown' NOT NULL,
      interpretation_confidence_percent integer DEFAULT 0 NOT NULL,
      interpretation_reason text,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
	await ensureColumn(
		"mission_goals",
		"interpretation_scope",
		"interpretation_scope text DEFAULT 'unknown' NOT NULL",
	);
	await ensureColumn(
		"mission_goals",
		"interpretation_intent",
		"interpretation_intent text DEFAULT 'unknown' NOT NULL",
	);
	await ensureColumn(
		"mission_goals",
		"interpretation_source",
		"interpretation_source text DEFAULT 'unknown' NOT NULL",
	);
	await ensureColumn(
		"mission_goals",
		"interpretation_confidence_percent",
		"interpretation_confidence_percent integer DEFAULT 0 NOT NULL",
	);
	await ensureColumn(
		"mission_goals",
		"interpretation_reason",
		"interpretation_reason text",
	);
	await client.execute(`
    UPDATE mission_goals
    SET
      interpretation_scope = 'project_wide',
      interpretation_intent = 'maintain_threshold',
      interpretation_source = 'preset',
      interpretation_confidence_percent = 100,
      interpretation_reason = COALESCE(interpretation_reason, 'Preset Goal はプロジェクト横断制約として扱う')
    WHERE source = 'preset'
      AND interpretation_scope = 'unknown'
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_goals_repository_active_idx ON mission_goals (repository_id, active, sort_order)",
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
		"CREATE INDEX IF NOT EXISTS mission_batches_repository_created_idx ON mission_task_candidate_batches (repository_id, created_at)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS mission_task_candidates (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      batch_id text NOT NULL,
      repository_id text NOT NULL,
      goal_id text,
      candidate_kind text DEFAULT 'feature_followup' NOT NULL,
      primary_module text,
      secondary_modules_json text DEFAULT '[]' NOT NULL,
      routing_confidence_percent integer DEFAULT 0 NOT NULL,
      routing_reason text,
      constraint_goal_ids_json text DEFAULT '[]' NOT NULL,
      plan_mode_open_questions_json text DEFAULT '[]' NOT NULL,
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
	await ensureColumn(
		"mission_task_candidates",
		"candidate_kind",
		"candidate_kind text DEFAULT 'feature_followup' NOT NULL",
	);
	await ensureColumn(
		"mission_task_candidates",
		"primary_module",
		"primary_module text",
	);
	await ensureColumn(
		"mission_task_candidates",
		"secondary_modules_json",
		"secondary_modules_json text DEFAULT '[]' NOT NULL",
	);
	await ensureColumn(
		"mission_task_candidates",
		"routing_confidence_percent",
		"routing_confidence_percent integer DEFAULT 0 NOT NULL",
	);
	await ensureColumn(
		"mission_task_candidates",
		"routing_reason",
		"routing_reason text",
	);
	await ensureColumn(
		"mission_task_candidates",
		"constraint_goal_ids_json",
		"constraint_goal_ids_json text DEFAULT '[]' NOT NULL",
	);
	await ensureColumn(
		"mission_task_candidates",
		"plan_mode_open_questions_json",
		"plan_mode_open_questions_json text DEFAULT '[]' NOT NULL",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_candidates_repository_status_idx ON mission_task_candidates (repository_id, status, created_at)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_candidates_batch_idx ON mission_task_candidates (batch_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_candidates_task_idx ON mission_task_candidates (task_id)",
	);
}
