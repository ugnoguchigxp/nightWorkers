import { client } from "./client";
export async function ensureMissionPilotTables() {
	await client.execute(
		`CREATE TABLE IF NOT EXISTS mission_pilot_sessions (id text PRIMARY KEY NOT NULL, task_id text NOT NULL, repository_id text NOT NULL, source_kind text NOT NULL, source_id text NOT NULL, authorization_version integer, authorization_json text, desired_state text DEFAULT 'stopped' NOT NULL, phase text DEFAULT 'created' NOT NULL, resume_phase text, initial_prompt_snapshot text NOT NULL, initial_prompt_state text DEFAULT 'pending' NOT NULL, initial_prompt_message_id text, active_run_id text, version integer DEFAULT 0 NOT NULL, context_revision integer DEFAULT 1 NOT NULL, context_digest text NOT NULL, next_wake_at integer, lease_owner text, lease_expires_at integer, last_error_code text, last_error_message text, started_at integer, stopped_at integer, created_at integer NOT NULL, updated_at integer NOT NULL, FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade, FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade, FOREIGN KEY (initial_prompt_message_id) REFERENCES task_messages(id) ON DELETE set null, FOREIGN KEY (active_run_id) REFERENCES task_runs(id) ON DELETE set null)`,
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
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_pilot_sessions_lease_idx ON mission_pilot_sessions (lease_expires_at)",
	);
	await client.execute(
		`CREATE TABLE IF NOT EXISTS mission_pilot_context_snapshots (id text PRIMARY KEY NOT NULL, session_id text NOT NULL, revision integer NOT NULL, reason text NOT NULL, context_json text NOT NULL, digest text NOT NULL, token_estimate integer DEFAULT 0 NOT NULL, created_at integer NOT NULL, FOREIGN KEY (session_id) REFERENCES mission_pilot_sessions(id) ON DELETE cascade)`,
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_context_snapshots_revision_uidx ON mission_pilot_context_snapshots (session_id, revision)",
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
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_plan_reviews_attempt_uidx ON mission_pilot_plan_reviews (session_id, attempt)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS mission_pilot_plan_reviews_context_idx ON mission_pilot_plan_reviews (session_id, context_revision)",
	);
}
