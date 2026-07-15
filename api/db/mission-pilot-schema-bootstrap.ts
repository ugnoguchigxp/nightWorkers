import { client } from "./client";
import { ensureColumn } from "./schema-bootstrap-utils";
export async function ensureMissionPilotTables() {
	await client.execute(
		`CREATE TABLE IF NOT EXISTS mission_pilot_sessions (id text PRIMARY KEY NOT NULL, task_id text NOT NULL, repository_id text NOT NULL, source_kind text NOT NULL, source_id text NOT NULL, authorization_version integer, authorization_json text, desired_state text DEFAULT 'stopped' NOT NULL, phase text DEFAULT 'created' NOT NULL, resume_phase text, initial_prompt_snapshot text NOT NULL, initial_prompt_state text DEFAULT 'pending' NOT NULL, initial_prompt_message_id text, active_run_id text, version integer DEFAULT 0 NOT NULL, context_revision integer DEFAULT 1 NOT NULL, context_digest text NOT NULL, next_wake_at integer, lease_owner text, lease_expires_at integer, last_error_code text, last_error_message text, queue_handoff_json text, pre_queue_diagnostic_json text, started_at integer, stopped_at integer, created_at integer NOT NULL, updated_at integer NOT NULL, FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade, FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade, FOREIGN KEY (initial_prompt_message_id) REFERENCES task_messages(id) ON DELETE set null, FOREIGN KEY (active_run_id) REFERENCES task_runs(id) ON DELETE set null)`,
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_sessions_task_uidx ON mission_pilot_sessions (task_id)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_sessions_source_uidx ON mission_pilot_sessions (source_kind, source_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_pilot_sessions_repository_state_idx ON mission_pilot_sessions (repository_id, desired_state, updated_at)",
	);
	const sessionColumns = await client.execute(
		"PRAGMA table_info(mission_pilot_sessions)",
	);
	if (!sessionColumns.rows.some((row) => row.name === "lease_owner")) {
		await client.execute(
			"ALTER TABLE mission_pilot_sessions ADD COLUMN lease_owner text",
		);
	}
	if (!sessionColumns.rows.some((row) => row.name === "lease_expires_at")) {
		await client.execute(
			"ALTER TABLE mission_pilot_sessions ADD COLUMN lease_expires_at integer",
		);
	}
	if (!sessionColumns.rows.some((row) => row.name === "queue_handoff_json")) {
		await client.execute(
			"ALTER TABLE mission_pilot_sessions ADD COLUMN queue_handoff_json text",
		);
	}
	if (
		!sessionColumns.rows.some((row) => row.name === "pre_queue_diagnostic_json")
	) {
		await client.execute(
			"ALTER TABLE mission_pilot_sessions ADD COLUMN pre_queue_diagnostic_json text",
		);
	}
	await ensureColumn(
		"mission_pilot_sessions",
		"plan_routing_revision",
		"plan_routing_revision integer DEFAULT 0 NOT NULL",
	);
	await ensureColumn(
		"mission_pilot_sessions",
		"active_phase_run_id",
		"active_phase_run_id text",
	);
	await ensureColumn(
		"mission_pilot_sessions",
		"active_test_snapshot_id",
		"active_test_snapshot_id text",
	);
	await ensureColumn(
		"mission_pilot_sessions",
		"active_review_decision_id",
		"active_review_decision_id text",
	);
	await ensureColumn(
		"mission_pilot_sessions",
		"active_closeout_id",
		"active_closeout_id text",
	);
	await ensureColumn(
		"mission_pilot_sessions",
		"implementation_cycle",
		"implementation_cycle integer DEFAULT 1 NOT NULL",
	);
	await ensureColumn(
		"mission_pilot_sessions",
		"test_cycle",
		"test_cycle integer DEFAULT 0 NOT NULL",
	);
	await ensureColumn(
		"mission_pilot_sessions",
		"review_cycle",
		"review_cycle integer DEFAULT 0 NOT NULL",
	);
	await ensureColumn(
		"mission_pilot_sessions",
		"total_correction_cycle",
		"total_correction_cycle integer DEFAULT 0 NOT NULL",
	);
	for (const [name, definition] of [
		["runtime_kind", "runtime_kind text DEFAULT 'legacy' NOT NULL"],
		["runtime_state", "runtime_state text DEFAULT 'stopped' NOT NULL"],
		[
			"conversation_revision",
			"conversation_revision integer DEFAULT 0 NOT NULL",
		],
		[
			"next_conversation_sequence",
			"next_conversation_sequence integer DEFAULT 1 NOT NULL",
		],
		["next_event_sequence", "next_event_sequence integer DEFAULT 1 NOT NULL"],
		["next_turn_index", "next_turn_index integer DEFAULT 1 NOT NULL"],
		[
			"system_context_version",
			"system_context_version integer DEFAULT 1 NOT NULL",
		],
		["compaction_revision", "compaction_revision integer DEFAULT 0 NOT NULL"],
		[
			"last_consumed_event_sequence",
			"last_consumed_event_sequence integer DEFAULT 0 NOT NULL",
		],
		["provider_conversation_ref", "provider_conversation_ref text"],
	] as const) {
		await ensureColumn("mission_pilot_sessions", name, definition);
	}
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_pilot_sessions_lease_idx ON mission_pilot_sessions (lease_expires_at)",
	);
	await client.execute(`CREATE TABLE IF NOT EXISTS mission_pilot_agent_turns (
		id text PRIMARY KEY NOT NULL, session_id text NOT NULL, turn_index integer NOT NULL,
		trigger_event_from integer, trigger_event_to integer, status text DEFAULT 'running' NOT NULL,
		provider text, model text, provider_conversation_ref text, started_at integer NOT NULL,
		finished_at integer, error_json text,
		FOREIGN KEY (session_id) REFERENCES mission_pilot_sessions(id) ON DELETE cascade)`);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_agent_turns_turn_uidx ON mission_pilot_agent_turns (session_id, turn_index)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_pilot_agent_turns_status_idx ON mission_pilot_agent_turns (session_id, status)",
	);
	await client.execute(`CREATE TABLE IF NOT EXISTS mission_pilot_tool_calls (
		id text PRIMARY KEY NOT NULL, session_id text NOT NULL, turn_id text NOT NULL,
		provider_call_id text NOT NULL, action_id text NOT NULL, arguments_json text NOT NULL,
		status text DEFAULT 'pending' NOT NULL, idempotency_key text NOT NULL,
		expected_task_revision integer, result_json text, failure_json text,
		started_at integer, finished_at integer, created_at integer NOT NULL, updated_at integer NOT NULL,
		FOREIGN KEY (session_id) REFERENCES mission_pilot_sessions(id) ON DELETE cascade,
		FOREIGN KEY (turn_id) REFERENCES mission_pilot_agent_turns(id) ON DELETE cascade)`);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_tool_calls_provider_call_uidx ON mission_pilot_tool_calls (session_id, provider_call_id)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_tool_calls_idempotency_uidx ON mission_pilot_tool_calls (session_id, idempotency_key)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_pilot_tool_calls_status_idx ON mission_pilot_tool_calls (session_id, status)",
	);
	await client.execute(`CREATE TABLE IF NOT EXISTS mission_pilot_conversation_items (
		id text PRIMARY KEY NOT NULL, session_id text NOT NULL, sequence integer NOT NULL,
		kind text NOT NULL, turn_id text, tool_call_id text, body_json text NOT NULL,
		source_kind text, source_id text, created_at integer NOT NULL,
		FOREIGN KEY (session_id) REFERENCES mission_pilot_sessions(id) ON DELETE cascade,
		FOREIGN KEY (turn_id) REFERENCES mission_pilot_agent_turns(id) ON DELETE set null,
		FOREIGN KEY (tool_call_id) REFERENCES mission_pilot_tool_calls(id) ON DELETE set null)`);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_conversation_items_sequence_uidx ON mission_pilot_conversation_items (session_id, sequence)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_pilot_conversation_items_kind_idx ON mission_pilot_conversation_items (session_id, kind, sequence)",
	);
	await client.execute(`CREATE TABLE IF NOT EXISTS mission_pilot_task_event_inbox (
		id text PRIMARY KEY NOT NULL, session_id text NOT NULL, task_id text NOT NULL,
		sequence integer NOT NULL, event_type text NOT NULL, source_event_id text NOT NULL,
		task_revision integer NOT NULL, payload_json text NOT NULL, available_at integer NOT NULL,
		consumed_at integer, created_at integer NOT NULL,
		FOREIGN KEY (session_id) REFERENCES mission_pilot_sessions(id) ON DELETE cascade,
		FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade)`);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_task_event_inbox_sequence_uidx ON mission_pilot_task_event_inbox (session_id, sequence)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_task_event_inbox_source_uidx ON mission_pilot_task_event_inbox (session_id, source_event_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_pilot_task_event_inbox_available_idx ON mission_pilot_task_event_inbox (session_id, consumed_at, available_at)",
	);
	await client.execute(
		`CREATE TABLE IF NOT EXISTS mission_pilot_context_snapshots (id text PRIMARY KEY NOT NULL, session_id text NOT NULL, revision integer NOT NULL, reason text NOT NULL, context_json text NOT NULL, digest text NOT NULL, token_estimate integer DEFAULT 0 NOT NULL, created_at integer NOT NULL, FOREIGN KEY (session_id) REFERENCES mission_pilot_sessions(id) ON DELETE cascade)`,
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_context_snapshots_revision_uidx ON mission_pilot_context_snapshots (session_id, revision)",
	);
	await client.execute(
		`CREATE TABLE IF NOT EXISTS mission_pilot_plan_routing_revisions (id text PRIMARY KEY NOT NULL, session_id text NOT NULL, revision integer NOT NULL, entries_json text NOT NULL, updated_by text NOT NULL, reason text NOT NULL, idempotency_key text, request_hash text, created_at integer NOT NULL, FOREIGN KEY (session_id) REFERENCES mission_pilot_sessions(id) ON DELETE cascade)`,
	);
	await ensureColumn(
		"mission_pilot_plan_routing_revisions",
		"idempotency_key",
		"idempotency_key text",
	);
	await ensureColumn(
		"mission_pilot_plan_routing_revisions",
		"request_hash",
		"request_hash text",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_plan_routing_revisions_revision_uidx ON mission_pilot_plan_routing_revisions (session_id, revision)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_plan_routing_revisions_idempotency_uidx ON mission_pilot_plan_routing_revisions (session_id, idempotency_key)",
	);
	await client.execute(
		`CREATE TABLE IF NOT EXISTS mission_pilot_questionnaire_drafts (id text PRIMARY KEY NOT NULL, session_id text NOT NULL, questionnaire_session_id text NOT NULL, answers_json text NOT NULL, answer_evidence_json text NOT NULL, state text DEFAULT 'waiting_user' NOT NULL, deadline_at integer NOT NULL, version integer DEFAULT 0 NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, FOREIGN KEY (session_id) REFERENCES mission_pilot_sessions(id) ON DELETE cascade, FOREIGN KEY (questionnaire_session_id) REFERENCES design_questionnaire_sessions(id) ON DELETE cascade)`,
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_questionnaire_drafts_questionnaire_uidx ON mission_pilot_questionnaire_drafts (questionnaire_session_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_pilot_questionnaire_drafts_deadline_idx ON mission_pilot_questionnaire_drafts (state, deadline_at)",
	);
	await client.execute(
		`CREATE TABLE IF NOT EXISTS mission_pilot_steps (id text PRIMARY KEY NOT NULL, session_id text NOT NULL, step_key text NOT NULL, ordinal integer NOT NULL, status text DEFAULT 'pending' NOT NULL, attempt integer DEFAULT 0 NOT NULL, context_revision integer NOT NULL, context_digest text NOT NULL, artifact_message_id text, evidence_json text NOT NULL, last_error text, started_at integer, finished_at integer, created_at integer NOT NULL, updated_at integer NOT NULL, FOREIGN KEY (session_id) REFERENCES mission_pilot_sessions(id) ON DELETE cascade, FOREIGN KEY (artifact_message_id) REFERENCES task_messages(id) ON DELETE set null)`,
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_steps_step_uidx ON mission_pilot_steps (session_id, step_key)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_pilot_steps_status_idx ON mission_pilot_steps (status, updated_at)",
	);
	await client.execute(
		`CREATE TABLE IF NOT EXISTS mission_pilot_plan_reviews (id text PRIMARY KEY NOT NULL, session_id text NOT NULL, context_revision integer NOT NULL, context_digest text NOT NULL, feature_plan_message_id text NOT NULL, attempt integer NOT NULL, verdict text NOT NULL, review_json text NOT NULL, created_at integer NOT NULL, FOREIGN KEY (session_id) REFERENCES mission_pilot_sessions(id) ON DELETE cascade, FOREIGN KEY (feature_plan_message_id) REFERENCES task_messages(id) ON DELETE cascade)`,
	);
	await ensureColumn(
		"mission_pilot_plan_reviews",
		"routing_revision",
		"routing_revision integer DEFAULT 0 NOT NULL",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_plan_reviews_attempt_uidx ON mission_pilot_plan_reviews (session_id, attempt)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_pilot_plan_reviews_context_idx ON mission_pilot_plan_reviews (session_id, context_revision)",
	);
	await client.execute(
		`CREATE TABLE IF NOT EXISTS mission_pilot_artifact_correction_runs (id text PRIMARY KEY NOT NULL, session_id text NOT NULL, task_id text NOT NULL, plan_review_id text NOT NULL, ordinal integer NOT NULL, target text NOT NULL, focus_json text NOT NULL, instruction text NOT NULL, preserve_unfocused_content integer DEFAULT true NOT NULL, source_message_id text NOT NULL, source_context_revision integer NOT NULL, source_context_digest text NOT NULL, status text DEFAULT 'pending' NOT NULL, dispatch_key text NOT NULL, result_message_id text, result_artifact_id text, output_context_revision integer, attempt integer DEFAULT 0 NOT NULL, last_error text, started_at integer, finished_at integer, created_at integer NOT NULL, updated_at integer NOT NULL, FOREIGN KEY (session_id) REFERENCES mission_pilot_sessions(id) ON DELETE cascade, FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade, FOREIGN KEY (plan_review_id) REFERENCES mission_pilot_plan_reviews(id) ON DELETE cascade, FOREIGN KEY (source_message_id) REFERENCES task_messages(id) ON DELETE cascade, FOREIGN KEY (result_message_id) REFERENCES task_messages(id) ON DELETE set null)`,
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_artifact_correction_runs_review_ordinal_uidx ON mission_pilot_artifact_correction_runs (session_id, plan_review_id, ordinal)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_artifact_correction_runs_dispatch_uidx ON mission_pilot_artifact_correction_runs (dispatch_key)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_pilot_artifact_correction_runs_status_idx ON mission_pilot_artifact_correction_runs (status, updated_at)",
	);
	await client.execute(`CREATE TABLE IF NOT EXISTS mission_pilot_phase_runs (
		id text PRIMARY KEY NOT NULL, session_id text NOT NULL, task_id text NOT NULL,
		phase text NOT NULL, cycle integer NOT NULL, attempt integer NOT NULL,
		run_id text NOT NULL, parent_phase_run_id text, input_context_revision integer NOT NULL,
		input_context_digest text NOT NULL, output_context_revision integer, status text DEFAULT 'starting' NOT NULL,
		verdict text, evidence_json text NOT NULL, started_at integer NOT NULL, finished_at integer,
		FOREIGN KEY (session_id) REFERENCES mission_pilot_sessions(id) ON DELETE cascade,
		FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
		FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade)`);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_phase_runs_run_uidx ON mission_pilot_phase_runs (run_id)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_phase_runs_attempt_uidx ON mission_pilot_phase_runs (session_id, phase, cycle, attempt)",
	);
	await client.execute(`CREATE TABLE IF NOT EXISTS mission_pilot_test_snapshots (
		id text PRIMARY KEY NOT NULL, session_id text NOT NULL, phase_run_id text NOT NULL,
		verification_document_id text NOT NULL, context_revision integer NOT NULL, context_digest text NOT NULL,
		checklist_digest text NOT NULL, required_total integer NOT NULL, required_complete integer NOT NULL,
		failed_required integer NOT NULL, unknown_required integer NOT NULL, evidence_run_ids_json text NOT NULL,
		completion_check_event_id text NOT NULL, test_changed_paths_json text NOT NULL, verdict text NOT NULL,
		snapshot_json text NOT NULL, created_at integer NOT NULL,
		FOREIGN KEY (session_id) REFERENCES mission_pilot_sessions(id) ON DELETE cascade,
		FOREIGN KEY (phase_run_id) REFERENCES mission_pilot_phase_runs(id) ON DELETE cascade)`);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_test_snapshots_phase_run_uidx ON mission_pilot_test_snapshots (phase_run_id)",
	);
	await client.execute(`CREATE TABLE IF NOT EXISTS mission_pilot_review_decisions (
		id text PRIMARY KEY NOT NULL, session_id text NOT NULL, review_session_id text NOT NULL,
		review_phase_run_id text NOT NULL, context_revision integer NOT NULL, context_digest text NOT NULL,
		test_snapshot_id text NOT NULL, target_manifest_digest text NOT NULL, verdict text NOT NULL,
		blocking_count integer NOT NULL, warning_count integer NOT NULL, info_count integer NOT NULL,
		finding_ids_json text NOT NULL, decision_json text NOT NULL, created_at integer NOT NULL,
		FOREIGN KEY (session_id) REFERENCES mission_pilot_sessions(id) ON DELETE cascade,
		FOREIGN KEY (review_phase_run_id) REFERENCES mission_pilot_phase_runs(id) ON DELETE cascade,
		FOREIGN KEY (test_snapshot_id) REFERENCES mission_pilot_test_snapshots(id) ON DELETE restrict)`);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_review_decisions_phase_run_uidx ON mission_pilot_review_decisions (review_phase_run_id)",
	);
	await client.execute(`CREATE TABLE IF NOT EXISTS mission_pilot_closeouts (
		id text PRIMARY KEY NOT NULL, session_id text NOT NULL, attempt integer NOT NULL, repository_id text NOT NULL,
		baseline_head text NOT NULL, review_decision_id text NOT NULL, reviewed_context_digest text NOT NULL,
		owned_phase_run_ids_json text NOT NULL, stageable_owned_paths_json text NOT NULL, excluded_paths_json text NOT NULL,
		status text NOT NULL, commit_sha text, commit_message text, push_policy text NOT NULL, push_status text NOT NULL,
		push_remote text, push_branch text, status_reason text, created_at integer NOT NULL, updated_at integer NOT NULL,
		FOREIGN KEY (session_id) REFERENCES mission_pilot_sessions(id) ON DELETE cascade,
		FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
		FOREIGN KEY (review_decision_id) REFERENCES mission_pilot_review_decisions(id) ON DELETE restrict)`);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_closeouts_attempt_uidx ON mission_pilot_closeouts (session_id, attempt)",
	);
	await client.execute(`CREATE TABLE IF NOT EXISTS mission_pilot_events (
		id text PRIMARY KEY NOT NULL, session_id text NOT NULL, task_id text NOT NULL, event_type text NOT NULL,
		phase text NOT NULL, cycle integer, context_revision integer NOT NULL, context_digest text NOT NULL,
		dedupe_key text NOT NULL, source_kind text NOT NULL, source_id text, payload_json text NOT NULL,
		process_status text DEFAULT 'pending' NOT NULL, attempt_count integer DEFAULT 0 NOT NULL,
		available_at integer NOT NULL, processed_at integer, last_error text, created_at integer NOT NULL, updated_at integer NOT NULL,
		FOREIGN KEY (session_id) REFERENCES mission_pilot_sessions(id) ON DELETE cascade,
		FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade)`);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_events_dedupe_uidx ON mission_pilot_events (session_id, dedupe_key)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_pilot_events_pending_idx ON mission_pilot_events (process_status, available_at)",
	);
	await client.execute(`CREATE TABLE IF NOT EXISTS task_archive_records (
		id text PRIMARY KEY NOT NULL, task_id text NOT NULL, mission_pilot_session_id text, source_run_id text,
		previous_status text NOT NULL, reason text NOT NULL, evidence_json text NOT NULL, archived_at integer NOT NULL,
		restored_at integer, restored_to_status text, restored_by text,
		FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
		FOREIGN KEY (mission_pilot_session_id) REFERENCES mission_pilot_sessions(id) ON DELETE set null,
		FOREIGN KEY (source_run_id) REFERENCES task_runs(id) ON DELETE set null)`);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS task_archive_records_task_idx ON task_archive_records (task_id, archived_at)",
	);
}
