import { client } from "./client";

export async function ensureMissionPilotTables() {
	await client.execute(`
    CREATE TABLE IF NOT EXISTS mission_objectives (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      mission_id text NOT NULL,
      repository_id text NOT NULL,
      planning_result_id text NOT NULL,
      external_objective_id text NOT NULL,
      title text NOT NULL,
      completion_criteria_json text NOT NULL,
      verification_gate_json text NOT NULL,
      status text DEFAULT 'pending' NOT NULL,
      evidence_refs_json text DEFAULT '[]' NOT NULL,
      status_reason text,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
      FOREIGN KEY (planning_result_id) REFERENCES mission_planning_results(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_objectives_planning_external_uidx ON mission_objectives (planning_result_id, external_objective_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_objectives_mission_status_created_idx ON mission_objectives (mission_id, status, created_at)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_objectives_repository_status_idx ON mission_objectives (repository_id, status)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS mission_events (
      id text PRIMARY KEY NOT NULL,
      mission_id text NOT NULL,
      repository_id text NOT NULL,
      mission_task_id text,
      event_type text NOT NULL,
      summary text NOT NULL,
      actor_json text NOT NULL,
      payload_json text,
      evidence_refs_json text DEFAULT '[]' NOT NULL,
      source_kind text NOT NULL,
      source_id text NOT NULL,
      source_version text DEFAULT '1' NOT NULL,
      occurred_at integer NOT NULL,
      created_at integer NOT NULL,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_events_source_uidx ON mission_events (mission_id, event_type, source_kind, source_id, source_version)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_events_mission_occurred_idx ON mission_events (mission_id, occurred_at, created_at)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_events_mission_task_occurred_idx ON mission_events (mission_task_id, occurred_at)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS pilot_actions (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      mission_id text NOT NULL,
      repository_id text NOT NULL,
      target_type text,
      target_id text,
      type text NOT NULL,
      status text DEFAULT 'started' NOT NULL,
      idempotency_key text NOT NULL,
      request_hash text NOT NULL,
      reason text NOT NULL,
      actor_json text NOT NULL,
      evidence_refs_json text DEFAULT '[]' NOT NULL,
      result_ref_json text,
      next_if_succeeded text,
      next_if_failed text,
      requires_human_attention integer DEFAULT false NOT NULL,
      error_code text,
      error_message text,
      started_at integer NOT NULL,
      completed_at integer,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS pilot_actions_mission_type_key_uidx ON pilot_actions (mission_id, type, idempotency_key)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS pilot_actions_mission_status_created_idx ON pilot_actions (mission_id, status, created_at)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS pilot_actions_target_created_idx ON pilot_actions (target_type, target_id, created_at)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS mission_approvals (
      id text PRIMARY KEY NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL,
      mission_id text NOT NULL, repository_id text NOT NULL, target_type text NOT NULL,
      target_id text NOT NULL, approval_type text NOT NULL, status text DEFAULT 'requested' NOT NULL,
      risk_level text NOT NULL, approval_required integer NOT NULL, requested_reason text NOT NULL,
      requested_by_actor_json text NOT NULL, decided_by_actor_json text, decision_reason text,
      snapshot_json text NOT NULL, snapshot_hash text NOT NULL, requested_at integer NOT NULL,
      decided_at integer, expires_at integer,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_approvals_mission_status_created_idx ON mission_approvals (mission_id, status, created_at)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_approvals_target_type_status_idx ON mission_approvals (target_type, target_id, approval_type, status)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_approvals_hash_status_idx ON mission_approvals (snapshot_hash, status)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_approvals_open_snapshot_uidx ON mission_approvals (mission_id, target_type, target_id, approval_type, snapshot_hash) WHERE status = 'requested'",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS mission_attention_items (
      id text PRIMARY KEY NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL,
      mission_id text NOT NULL, repository_id text NOT NULL, target_type text NOT NULL,
      target_id text NOT NULL, type text NOT NULL, status text DEFAULT 'open' NOT NULL,
      severity text NOT NULL, title text NOT NULL, summary text NOT NULL,
      action_schema_json text NOT NULL, evidence_refs_json text DEFAULT '[]' NOT NULL,
      source_event_id text, source_ref_json text, resolved_by_actor_json text, resolved_at integer,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
      FOREIGN KEY (source_event_id) REFERENCES mission_events(id) ON DELETE set null
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_attention_mission_status_created_idx ON mission_attention_items (mission_id, status, created_at)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_attention_target_status_idx ON mission_attention_items (target_type, target_id, status)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS mission_tasks (
      id text PRIMARY KEY NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL,
      mission_id text NOT NULL, repository_id text NOT NULL, planning_result_id text NOT NULL,
      task_candidate_id text NOT NULL, objective_ids_json text NOT NULL, nightworkers_task_id text,
      queue_entry_id text, active_run_id text, approval_id text NOT NULL, approval_snapshot_hash text NOT NULL,
      title text NOT NULL, purpose text NOT NULL, status text DEFAULT 'approved' NOT NULL,
      risk_level text NOT NULL, approval_required integer NOT NULL, dependencies_json text NOT NULL,
      verification_gate_json text NOT NULL, scheduling_json text NOT NULL, last_synced_at integer,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
      FOREIGN KEY (planning_result_id) REFERENCES mission_planning_results(id) ON DELETE restrict,
      FOREIGN KEY (task_candidate_id) REFERENCES mission_task_proposals(id) ON DELETE restrict,
      FOREIGN KEY (nightworkers_task_id) REFERENCES tasks(id) ON DELETE set null,
      FOREIGN KEY (queue_entry_id) REFERENCES implementation_queue_entries(id) ON DELETE set null,
      FOREIGN KEY (active_run_id) REFERENCES task_runs(id) ON DELETE set null,
      FOREIGN KEY (approval_id) REFERENCES mission_approvals(id) ON DELETE restrict
    )
  `);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_tasks_candidate_uidx ON mission_tasks (task_candidate_id)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_tasks_nightworkers_task_uidx ON mission_tasks (nightworkers_task_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_tasks_mission_status_created_idx ON mission_tasks (mission_id, status, created_at)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_tasks_queue_entry_idx ON mission_tasks (queue_entry_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_tasks_active_run_idx ON mission_tasks (active_run_id)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS mission_autopilot_grants (
      id text PRIMARY KEY NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL,
      mission_id text NOT NULL, repository_id text NOT NULL, autonomy_level integer NOT NULL,
      allowed_actions_json text NOT NULL, status text DEFAULT 'active' NOT NULL,
      granted_by_actor_json text NOT NULL, expires_at integer, paused_at integer, revoked_at integer,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_autopilot_grants_mission_status_idx ON mission_autopilot_grants (mission_id, status, created_at)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_autopilot_grants_active_mission_uidx ON mission_autopilot_grants (mission_id) WHERE status = 'active'",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS mission_evaluations (
      id text PRIMARY KEY NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL,
      mission_id text NOT NULL, repository_id text NOT NULL, scope_type text NOT NULL, scope_id text NOT NULL,
      mission_task_id text, run_id text, result text NOT NULL, summary text NOT NULL,
      objective_updates_json text NOT NULL, evidence_refs_json text NOT NULL, input_digest text NOT NULL,
      next_recommended_action text NOT NULL, created_by_actor_json text NOT NULL,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
      FOREIGN KEY (mission_task_id) REFERENCES mission_tasks(id) ON DELETE set null,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE set null
    )
  `);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_evaluations_scope_digest_uidx ON mission_evaluations (mission_id, scope_type, scope_id, input_digest)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_evaluations_mission_created_idx ON mission_evaluations (mission_id, created_at)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_evaluations_run_idx ON mission_evaluations (run_id)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS mission_plan_revisions (
      id text PRIMARY KEY NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL,
      mission_id text NOT NULL, repository_id text NOT NULL, base_revision_id text,
      planning_result_id text NOT NULL, revision_number integer NOT NULL, summary text NOT NULL,
      task_graph_json text NOT NULL, applied_diff_json text, created_by_actor_json text NOT NULL,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
      FOREIGN KEY (base_revision_id) REFERENCES mission_plan_revisions(id) ON DELETE restrict,
      FOREIGN KEY (planning_result_id) REFERENCES mission_planning_results(id) ON DELETE restrict
    )
  `);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_plan_revisions_mission_revision_uidx ON mission_plan_revisions (mission_id, revision_number)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_plan_revisions_mission_planning_uidx ON mission_plan_revisions (mission_id, planning_result_id)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS mission_replan_suggestions (
      id text PRIMARY KEY NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL,
      mission_id text NOT NULL, repository_id text NOT NULL, base_revision_id text NOT NULL,
      source_evaluation_id text NOT NULL, status text DEFAULT 'draft' NOT NULL, reason text NOT NULL,
      task_graph_diff_json text NOT NULL, diff_hash text NOT NULL, approval_id text,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
      FOREIGN KEY (base_revision_id) REFERENCES mission_plan_revisions(id) ON DELETE restrict,
      FOREIGN KEY (source_evaluation_id) REFERENCES mission_evaluations(id) ON DELETE restrict,
      FOREIGN KEY (approval_id) REFERENCES mission_approvals(id) ON DELETE set null
    )
  `);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_replan_suggestions_evaluation_diff_uidx ON mission_replan_suggestions (mission_id, source_evaluation_id, diff_hash)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_replan_suggestions_mission_status_created_idx ON mission_replan_suggestions (mission_id, status, created_at)",
	);
}
