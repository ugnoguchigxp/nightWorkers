import { client } from "../../../db/client";

export async function ensureCodingAgentRuntimeExecutionTables() {
	await client.execute(`
		CREATE TABLE IF NOT EXISTS coding_agent_run_executions (
			run_id text PRIMARY KEY NOT NULL,
			agent_mode_session_id text NOT NULL,
			status text NOT NULL,
			owner_kind text NOT NULL,
			owner_instance_id text NOT NULL,
			owner_pid integer,
			lease_version integer DEFAULT 1 NOT NULL,
			acquired_at integer NOT NULL,
			heartbeat_at integer NOT NULL,
			lease_expires_at integer NOT NULL,
			interruption_revision integer DEFAULT 0 NOT NULL,
			interruption_reason text,
			interruption_snapshot_json text,
			created_at integer NOT NULL,
			updated_at integer NOT NULL,
			FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade,
			FOREIGN KEY (agent_mode_session_id) REFERENCES agent_mode_sessions(id) ON DELETE cascade
		)
	`);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS coding_agent_run_executions_owner_status_idx ON coding_agent_run_executions (owner_kind, owner_instance_id, status)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS coding_agent_run_executions_status_lease_idx ON coding_agent_run_executions (status, lease_expires_at)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS coding_agent_run_executions_session_idx ON coding_agent_run_executions (agent_mode_session_id)",
	);
}
