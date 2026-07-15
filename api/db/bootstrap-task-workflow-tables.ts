import { client } from "./client";
import { ensureColumn } from "./schema-bootstrap-utils";

export async function ensureTaskWorkflowTables() {
	await client.execute(`
    CREATE TABLE IF NOT EXISTS task_git_workspaces (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL UNIQUE,
      repository_id text NOT NULL,
      plan_review_id text,
      admission_key text,
      status text DEFAULT 'planned' NOT NULL,
      materialization_kind text NOT NULL,
      materialization_intent_json text,
      bootstrap_evidence_json text,
      integration_policy_snapshot_json text NOT NULL,
      source_branch text NOT NULL,
      target_branch text NOT NULL,
      target_base_sha text,
      worktree_path text,
      worktree_id text,
      allocation_version integer DEFAULT 1 NOT NULL,
      expected_head_sha text,
      provision_attempt integer DEFAULT 0 NOT NULL,
      lease_owner text,
      lease_expires_at integer,
      last_verified_head text,
      attention_resume_status text,
      last_error_code text,
      last_error_message text,
      provisioned_at integer,
      released_at integer,
      retired_at integer,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS task_git_workspaces_repository_status_idx ON task_git_workspaces (repository_id, status)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS task_git_workspaces_active_branch_uidx ON task_git_workspaces (repository_id, source_branch) WHERE retired_at IS NULL",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS task_git_workspaces_active_path_uidx ON task_git_workspaces (worktree_path) WHERE worktree_path IS NOT NULL AND retired_at IS NULL",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS repository_git_mutation_leases (
      repository_id text PRIMARY KEY NOT NULL,
      owner_id text NOT NULL,
      operation text NOT NULL,
      lease_version integer DEFAULT 0 NOT NULL,
      acquired_at integer NOT NULL,
      expires_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS task_run_merge_records (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      run_id text NOT NULL UNIQUE,
      task_id text NOT NULL,
      repository_id text NOT NULL,
      workspace_id text NOT NULL,
      source_branch text NOT NULL,
      source_commit_sha text NOT NULL,
      plan_target_branch text NOT NULL,
      plan_target_base_sha text NOT NULL,
      target_branch text NOT NULL,
      target_selected_sha text NOT NULL,
      observed_target_sha text,
      strategy text NOT NULL,
      decision text DEFAULT 'undecided' NOT NULL,
      status text DEFAULT 'decision_required' NOT NULL,
      record_version integer DEFAULT 0 NOT NULL,
      ci_status text DEFAULT 'not_required' NOT NULL,
      ci_evidence_json text,
      preview_evidence_json text,
      conflict_paths_json text,
      merge_origin text,
      merge_commit_sha text,
      target_head_after text,
      target_push_status text,
      target_pushed_at integer,
      decided_at integer,
      merged_at integer,
      last_error_code text,
      last_error_message text,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
      FOREIGN KEY (workspace_id) REFERENCES task_git_workspaces(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS task_run_merge_records_repository_status_idx ON task_run_merge_records (repository_id, status)",
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
      trace_owner text DEFAULT 'system' NOT NULL,
      trace_channel text DEFAULT 'internal' NOT NULL,
      created_at integer NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE set null,
      FOREIGN KEY (artifact_id) REFERENCES activity_artifacts(id) ON DELETE set null
    )
  `);
	await ensureColumn(
		"activity_events",
		"trace_owner",
		"trace_owner text DEFAULT 'system' NOT NULL",
	);
	await ensureColumn(
		"activity_events",
		"trace_channel",
		"trace_channel text DEFAULT 'internal' NOT NULL",
	);
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
	await client.execute(
		"CREATE INDEX IF NOT EXISTS activity_events_task_channel_seq_idx ON activity_events (task_id, trace_channel, seq)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS activity_events_task_owner_channel_created_idx ON activity_events (task_id, trace_owner, trace_channel, created_at)",
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
	  objective text,
	  context text,
	  next_action text DEFAULT '' NOT NULL,
	  acceptance_criteria_json text DEFAULT '[]' NOT NULL,
      task_type text NOT NULL,
      status text DEFAULT 'pending' NOT NULL,
      procedure_id text,
      procedure_snapshot text,
      context_snapshot text,
      completion_gate_result text,
  evidence_requirements_json text,
  evidence_refs_json text,
      depends_on text,
      status_reason text,
	  last_failure text,
	  attempt_count integer DEFAULT 0 NOT NULL,
	  system_context_version integer DEFAULT 0 NOT NULL,
	  system_context_snapshot text,
	  created_by text DEFAULT 'migration' NOT NULL,
	  revision integer DEFAULT 0 NOT NULL,
      started_at integer,
      completed_at integer,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade
    )
  `);
	await ensureColumn(
		"task_run_todos",
		"evidence_requirements_json",
		"evidence_requirements_json text",
	);
	await ensureColumn(
		"task_run_todos",
		"evidence_refs_json",
		"evidence_refs_json text",
	);
	await ensureColumn("task_run_todos", "objective", "objective text");
	await ensureColumn("task_run_todos", "context", "context text");
	await ensureColumn(
		"task_run_todos",
		"next_action",
		"next_action text DEFAULT '' NOT NULL",
	);
	await ensureColumn(
		"task_run_todos",
		"acceptance_criteria_json",
		"acceptance_criteria_json text DEFAULT '[]' NOT NULL",
	);
	await ensureColumn("task_run_todos", "last_failure", "last_failure text");
	await ensureColumn(
		"task_run_todos",
		"attempt_count",
		"attempt_count integer DEFAULT 0 NOT NULL",
	);
	await ensureColumn(
		"task_run_todos",
		"system_context_version",
		"system_context_version integer DEFAULT 0 NOT NULL",
	);
	await ensureColumn(
		"task_run_todos",
		"system_context_snapshot",
		"system_context_snapshot text",
	);
	await ensureColumn(
		"task_run_todos",
		"created_by",
		"created_by text DEFAULT 'migration' NOT NULL",
	);
	await ensureColumn(
		"task_run_todos",
		"revision",
		"revision integer DEFAULT 0 NOT NULL",
	);

	await client.execute(
		"CREATE INDEX IF NOT EXISTS task_run_todos_run_id_idx ON task_run_todos (run_id)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS task_run_todos_run_seq_uidx ON task_run_todos (run_id, seq)",
	);
	await client.execute(`
		UPDATE task_run_todos
		SET status = 'pending', updated_at = unixepoch() * 1000
		WHERE status = 'running'
		  AND EXISTS (
			SELECT 1
			FROM task_run_todos earlier
			WHERE earlier.run_id = task_run_todos.run_id
			  AND earlier.status = 'running'
			  AND earlier.seq < task_run_todos.seq
		  )
	`);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS task_run_todos_single_running_uidx ON task_run_todos (run_id) WHERE status = 'running'",
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
  mission_pilot_admission_key text,
  claim_ready integer DEFAULT true NOT NULL,
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
	await ensureColumn(
		"implementation_queue_entries",
		"mission_pilot_admission_key",
		"mission_pilot_admission_key text",
	);
	await ensureColumn(
		"implementation_queue_entries",
		"claim_ready",
		"claim_ready integer DEFAULT true NOT NULL",
	);
	await ensureColumn(
		"implementation_queue_entries",
		"workspace_id",
		"workspace_id text REFERENCES task_git_workspaces(id) ON DELETE set null",
	);
	await ensureColumn(
		"implementation_queue_entries",
		"workspace_required",
		"workspace_required integer DEFAULT false NOT NULL",
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
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS implementation_queue_entries_mission_pilot_admission_uidx ON implementation_queue_entries (mission_pilot_admission_key)",
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
}
