import { createClient } from "@libsql/client";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrapMissionPilotStorage } from "@nightworkers/mission-pilot/backend";

const clients: ReturnType<typeof createClient>[] = [];
const logger = { info() {}, error() {} };

afterEach(() => {
	for (const client of clients.splice(0)) client.close();
});

async function createCoreReferences() {
	const client = createClient({ url: ":memory:" });
	clients.push(client);
	for (const statement of [
		"CREATE TABLE repositories (id text PRIMARY KEY NOT NULL)",
		"CREATE TABLE tasks (id text PRIMARY KEY NOT NULL)",
		"CREATE TABLE task_messages (id text PRIMARY KEY NOT NULL, trace_owner text, trace_channel text, metadata_json text, message_type text, role text, run_id text)",
		"CREATE TABLE task_runs (id text PRIMARY KEY NOT NULL)",
		"CREATE TABLE design_questionnaire_sessions (id text PRIMARY KEY NOT NULL)",
		"CREATE TABLE llm_usage_records (id text PRIMARY KEY NOT NULL, metadata_json text, trace_owner text, trace_channel text, run_id text)",
		"CREATE TABLE activity_events (id text PRIMARY KEY NOT NULL, payload_json text, trace_owner text, trace_channel text, run_id text, source text, kind text, external_id text)",
	]) {
		await client.execute(statement);
	}
	await client.execute("INSERT INTO repositories (id) VALUES ('repository-1')");
	await client.execute("INSERT INTO tasks (id) VALUES ('task-1')");
	return client;
}

describe("Mission Pilot package persistence", () => {
	it("recognizes existing package rows and preserves session history on restart", async () => {
		const client = await createCoreReferences();
		await bootstrapMissionPilotStorage({ client, logger });
		await client.execute({
			sql: `INSERT INTO mission_pilot_sessions (
				id, task_id, repository_id, source_kind, source_id,
				initial_prompt_snapshot, context_digest, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				"session-1",
				"task-1",
				"repository-1",
				"task",
				"task-1",
				"Preserve me",
				"digest-1",
				1,
				1,
			],
		});
		await client.execute(
			"INSERT INTO mission_pilot_agent_sessions (session_id, context_digest, created_at, updated_at) VALUES ('session-1', 'digest-1', 1, 1)",
		);
		await client.execute(
			"INSERT INTO mission_pilot_conversation_items (id, session_id, sequence, kind, body_json, created_at) VALUES ('item-1', 'session-1', 1, 'assistant_message', '{}', 1)",
		);
		await client.execute(
			"INSERT INTO mission_pilot_task_event_inbox (id, session_id, task_id, sequence, event_type, source_event_id, task_revision, payload_json, available_at, created_at) VALUES ('event-1', 'session-1', 'task-1', 1, 'mission_pilot.play_requested', 'source-1', 1, '{}', 1, 1)",
		);

		await bootstrapMissionPilotStorage({ client, logger });

		const session = await client.execute(
			"SELECT initial_prompt_snapshot FROM mission_pilot_sessions WHERE id = 'session-1'",
		);
		const conversations = await client.execute(
			"SELECT count(*) AS count FROM mission_pilot_conversation_items WHERE session_id = 'session-1'",
		);
		const inbox = await client.execute(
			"SELECT count(*) AS count FROM mission_pilot_task_event_inbox WHERE session_id = 'session-1'",
		);
		expect(session.rows[0]?.initial_prompt_snapshot).toBe("Preserve me");
		expect(Number(conversations.rows[0]?.count)).toBe(1);
		expect(Number(inbox.rows[0]?.count)).toBe(1);
	});

	it("reports package bootstrap failure without mutating the host client", async () => {
		const calls: unknown[] = [];
		const failure = new Error("package storage unavailable");
		await expect(
			bootstrapMissionPilotStorage({
				client: {
					execute(input) {
						calls.push(input);
						throw failure;
					},
				},
				logger,
			}),
		).rejects.toBe(failure);
		expect(calls).toHaveLength(1);
	});
});
