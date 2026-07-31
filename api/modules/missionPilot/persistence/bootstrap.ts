import type { Client } from "@libsql/client";
import { client as nightWorkersSqlClient } from "../../../db/client";
import { backfillMissionPilotTraceProvenance } from "./provenance-backfill";

export type MissionPilotSqlClient = Pick<Client, "execute">;

let productionBootstrapTail: Promise<void> = Promise.resolve();

async function ensureColumn(
	client: MissionPilotSqlClient,
	table: string,
	column: string,
	definition: string,
) {
	const columns = await client.execute(`PRAGMA table_info(${table})`);
	if (
		columns.rows.length > 0 &&
		!columns.rows.some((row) => row.name === column)
	)
		await client.execute(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

const canonicalSchemaStatements = [
	`CREATE TABLE IF NOT EXISTS mission_pilot_sessions (
		id text PRIMARY KEY NOT NULL, task_id text NOT NULL, repository_id text NOT NULL,
		source_kind text NOT NULL, source_id text NOT NULL, authorization_version integer,
		authorization_json text, desired_state text DEFAULT 'stopped' NOT NULL,
		phase text DEFAULT 'created' NOT NULL, resume_phase text,
		initial_prompt_snapshot text NOT NULL, initial_prompt_state text DEFAULT 'pending' NOT NULL,
		initial_prompt_message_id text, active_run_id text, version integer DEFAULT 0 NOT NULL,
		context_revision integer DEFAULT 1 NOT NULL, context_digest text NOT NULL,
		next_wake_at integer, lease_owner text, lease_expires_at integer,
		last_error_code text, last_error_message text, started_at integer, stopped_at integer,
		created_at integer NOT NULL, updated_at integer NOT NULL,
		FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
		FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
		FOREIGN KEY (initial_prompt_message_id) REFERENCES task_messages(id) ON DELETE set null,
		FOREIGN KEY (active_run_id) REFERENCES task_runs(id) ON DELETE set null)`,
	"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_sessions_task_uidx ON mission_pilot_sessions (task_id)",
	"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_sessions_source_uidx ON mission_pilot_sessions (source_kind, source_id)",
	"CREATE INDEX IF NOT EXISTS mission_pilot_sessions_repository_state_idx ON mission_pilot_sessions (repository_id, desired_state, updated_at)",
	"CREATE INDEX IF NOT EXISTS mission_pilot_sessions_lease_idx ON mission_pilot_sessions (lease_expires_at)",
	`CREATE TABLE IF NOT EXISTS mission_pilot_context_snapshots (
		id text PRIMARY KEY NOT NULL, session_id text NOT NULL, revision integer NOT NULL,
		reason text NOT NULL, context_json text NOT NULL, digest text NOT NULL,
		token_estimate integer DEFAULT 0 NOT NULL, created_at integer NOT NULL,
		FOREIGN KEY (session_id) REFERENCES mission_pilot_sessions(id) ON DELETE cascade)`,
	"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_context_snapshots_revision_uidx ON mission_pilot_context_snapshots (session_id, revision)",
	`CREATE TABLE IF NOT EXISTS mission_pilot_agent_sessions (
		session_id text PRIMARY KEY NOT NULL, engine_mode text DEFAULT 'agent' NOT NULL,
		runtime_state text DEFAULT 'stopped' NOT NULL, system_context_version integer DEFAULT 1 NOT NULL,
		conversation_revision integer DEFAULT 0 NOT NULL, compaction_revision integer,
		next_conversation_sequence integer DEFAULT 1 NOT NULL, last_consumed_event_sequence integer,
		next_turn_index integer DEFAULT 1 NOT NULL, next_event_sequence integer DEFAULT 1 NOT NULL,
		current_turn_id text, provider_endpoint_id text, model text, thinking_depth text,
		context_revision integer DEFAULT 1 NOT NULL, context_digest text DEFAULT '' NOT NULL,
		lease_owner text, lease_expires_at integer, last_failure_json text,
		created_at integer NOT NULL, updated_at integer NOT NULL,
		FOREIGN KEY (session_id) REFERENCES mission_pilot_sessions(id) ON DELETE cascade)`,
	"CREATE INDEX IF NOT EXISTS mission_pilot_agent_sessions_runtime_lease_idx ON mission_pilot_agent_sessions (runtime_state, lease_expires_at)",
	`CREATE TABLE IF NOT EXISTS mission_pilot_agent_turns (
		id text PRIMARY KEY NOT NULL, session_id text NOT NULL, turn_index integer NOT NULL,
		trigger_event_from integer, trigger_event_to integer, status text DEFAULT 'running' NOT NULL,
		provider text, model text, started_at integer NOT NULL, finished_at integer, error_json text,
		FOREIGN KEY (session_id) REFERENCES mission_pilot_sessions(id) ON DELETE cascade)`,
	"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_agent_turns_turn_uidx ON mission_pilot_agent_turns (session_id, turn_index)",
	"CREATE INDEX IF NOT EXISTS mission_pilot_agent_turns_status_idx ON mission_pilot_agent_turns (session_id, status)",
	`CREATE TABLE IF NOT EXISTS mission_pilot_tool_calls (
		id text PRIMARY KEY NOT NULL, session_id text NOT NULL, turn_id text NOT NULL,
		provider_call_id text NOT NULL, action_id text NOT NULL, arguments_json text NOT NULL,
		status text DEFAULT 'pending' NOT NULL, idempotency_key text NOT NULL,
		expected_task_revision integer, result_json text, failure_json text,
		started_at integer, finished_at integer, created_at integer NOT NULL, updated_at integer NOT NULL,
		FOREIGN KEY (session_id) REFERENCES mission_pilot_sessions(id) ON DELETE cascade,
		FOREIGN KEY (turn_id) REFERENCES mission_pilot_agent_turns(id) ON DELETE cascade)`,
	"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_tool_calls_provider_call_uidx ON mission_pilot_tool_calls (session_id, provider_call_id)",
	"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_tool_calls_idempotency_uidx ON mission_pilot_tool_calls (session_id, idempotency_key)",
	"CREATE INDEX IF NOT EXISTS mission_pilot_tool_calls_status_idx ON mission_pilot_tool_calls (session_id, status)",
	`CREATE TABLE IF NOT EXISTS mission_pilot_action_executions (
		id text PRIMARY KEY NOT NULL, session_id text NOT NULL, task_id text NOT NULL,
		tool_call_id text NOT NULL, action_id text NOT NULL, idempotency_key text NOT NULL,
		arguments_digest text NOT NULL, expected_task_revision integer,
		status text DEFAULT 'pending' NOT NULL, result_json text, failure_json text,
		source_resource_type text, source_resource_id text, created_at integer NOT NULL,
		started_at integer, finished_at integer, updated_at integer NOT NULL,
		FOREIGN KEY (session_id) REFERENCES mission_pilot_sessions(id) ON DELETE cascade,
		FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
		FOREIGN KEY (tool_call_id) REFERENCES mission_pilot_tool_calls(id) ON DELETE cascade)`,
	"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_action_executions_idempotency_uidx ON mission_pilot_action_executions (session_id, idempotency_key)",
	"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_action_executions_tool_call_uidx ON mission_pilot_action_executions (tool_call_id)",
	"CREATE INDEX IF NOT EXISTS mission_pilot_action_executions_status_idx ON mission_pilot_action_executions (session_id, status)",
	`CREATE TABLE IF NOT EXISTS mission_pilot_conversation_items (
		id text PRIMARY KEY NOT NULL, session_id text NOT NULL, sequence integer NOT NULL,
		kind text NOT NULL, turn_id text, tool_call_id text, body_json text NOT NULL,
		source_kind text, source_id text, created_at integer NOT NULL,
		FOREIGN KEY (session_id) REFERENCES mission_pilot_sessions(id) ON DELETE cascade,
		FOREIGN KEY (turn_id) REFERENCES mission_pilot_agent_turns(id) ON DELETE set null,
		FOREIGN KEY (tool_call_id) REFERENCES mission_pilot_tool_calls(id) ON DELETE set null)`,
	"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_conversation_items_sequence_uidx ON mission_pilot_conversation_items (session_id, sequence)",
	"CREATE INDEX IF NOT EXISTS mission_pilot_conversation_items_kind_idx ON mission_pilot_conversation_items (session_id, kind, sequence)",
	`CREATE TABLE IF NOT EXISTS mission_pilot_task_event_inbox (
		id text PRIMARY KEY NOT NULL, session_id text NOT NULL, task_id text NOT NULL,
		sequence integer NOT NULL, event_type text NOT NULL, source_event_id text NOT NULL,
		task_revision integer NOT NULL, payload_json text NOT NULL, available_at integer NOT NULL,
		consumed_at integer, created_at integer NOT NULL,
		FOREIGN KEY (session_id) REFERENCES mission_pilot_sessions(id) ON DELETE cascade,
		FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade)`,
	"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_task_event_inbox_sequence_uidx ON mission_pilot_task_event_inbox (session_id, sequence)",
	"CREATE UNIQUE INDEX IF NOT EXISTS mission_pilot_task_event_inbox_source_uidx ON mission_pilot_task_event_inbox (session_id, source_event_id)",
	"CREATE INDEX IF NOT EXISTS mission_pilot_task_event_inbox_available_idx ON mission_pilot_task_event_inbox (session_id, consumed_at, available_at)",
	`CREATE TABLE IF NOT EXISTS mission_pilot_repair_requests (
		id text PRIMARY KEY NOT NULL, session_id text NOT NULL, source_run_id text,
		request_json text NOT NULL, source_revision integer NOT NULL, source_digest text NOT NULL,
		status text DEFAULT 'requested' NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL,
		FOREIGN KEY (session_id) REFERENCES mission_pilot_sessions(id) ON DELETE cascade)`,
	"CREATE INDEX IF NOT EXISTS mission_pilot_repair_requests_session_idx ON mission_pilot_repair_requests (session_id, created_at)",
] as const;

async function ensureMissionPilotTables(client: MissionPilotSqlClient) {
	for (const statement of canonicalSchemaStatements)
		await client.execute(statement);
	await client.execute(
		"UPDATE mission_pilot_agent_sessions SET engine_mode = 'agent' WHERE engine_mode <> 'agent'",
	);
	for (const [column, definition] of [
		["authorization_version", "authorization_version integer"],
		["authorization_json", "authorization_json text"],
		["resume_phase", "resume_phase text"],
		[
			"initial_prompt_state",
			"initial_prompt_state text DEFAULT 'pending' NOT NULL",
		],
		["initial_prompt_message_id", "initial_prompt_message_id text"],
		["active_run_id", "active_run_id text"],
		["context_revision", "context_revision integer DEFAULT 1 NOT NULL"],
		["context_digest", "context_digest text DEFAULT '' NOT NULL"],
		["next_wake_at", "next_wake_at integer"],
		["lease_owner", "lease_owner text"],
		["lease_expires_at", "lease_expires_at integer"],
		["last_error_code", "last_error_code text"],
		["last_error_message", "last_error_message text"],
		["started_at", "started_at integer"],
		["stopped_at", "stopped_at integer"],
	] as const)
		await ensureColumn(client, "mission_pilot_sessions", column, definition);
}

async function bootstrapMissionPilotTablesWithClient(
	sqlClient: MissionPilotSqlClient,
) {
	await ensureMissionPilotTables(sqlClient);
	await backfillMissionPilotTraceProvenance(sqlClient);
}

/** Uses the process-wide NightWorkers persistence owner and write gate. */
export function bootstrapMissionPilotTables() {
	const bootstrap = productionBootstrapTail.then(() =>
		bootstrapMissionPilotTablesWithClient(nightWorkersSqlClient),
	);
	productionBootstrapTail = bootstrap.catch(() => undefined);
	return bootstrap;
}

/** Isolated-schema helper; unavailable to production callers. */
export function bootstrapMissionPilotTablesForTest(
	sqlClient: MissionPilotSqlClient,
) {
	if (
		process.env.NODE_ENV !== "test" &&
		process.env.NIGHTWORKERS_E2E_ISOLATED !== "1"
	)
		throw new Error("Mission Pilot test bootstrap is disabled.");
	return bootstrapMissionPilotTablesWithClient(sqlClient);
}
