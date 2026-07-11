import { client } from "./client";
export async function ensureMissionPilotTables() {
	await client.execute(
		`CREATE TABLE IF NOT EXISTS mission_pilot_sessions (id text PRIMARY KEY NOT NULL, task_id text NOT NULL, repository_id text NOT NULL, source_kind text NOT NULL, source_id text NOT NULL, authorization_version integer, authorization_json text, desired_state text DEFAULT 'stopped' NOT NULL, phase text DEFAULT 'created' NOT NULL, resume_phase text, initial_prompt_snapshot text NOT NULL, initial_prompt_state text DEFAULT 'pending' NOT NULL, initial_prompt_message_id text, active_run_id text, version integer DEFAULT 0 NOT NULL, context_revision integer DEFAULT 1 NOT NULL, context_digest text NOT NULL, next_wake_at integer, last_error_code text, last_error_message text, started_at integer, stopped_at integer, created_at integer NOT NULL, updated_at integer NOT NULL, FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade, FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade, FOREIGN KEY (initial_prompt_message_id) REFERENCES task_messages(id) ON DELETE set null, FOREIGN KEY (active_run_id) REFERENCES task_runs(id) ON DELETE set null)`,
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
	await client.execute(
		`CREATE TABLE IF NOT EXISTS mission_pilot_context_snapshots (id text PRIMARY KEY NOT NULL, session_id text NOT NULL, revision integer NOT NULL, reason text NOT NULL, context_json text NOT NULL, digest text NOT NULL, token_estimate integer DEFAULT 0 NOT NULL, created_at integer NOT NULL, FOREIGN KEY (session_id) REFERENCES mission_pilot_sessions(id) ON DELETE cascade)`,
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_context_snapshots_revision_uidx ON mission_pilot_context_snapshots (session_id, revision)",
	);
}
