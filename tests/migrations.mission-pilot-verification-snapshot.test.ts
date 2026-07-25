import { readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

describe("0051_mission_pilot_verification_snapshot migration", () => {
	it("preserves snapshot references and removes the dedicated Test phase schema", async () => {
		const client = createClient({ url: "file::memory:" });
		try {
			await client.executeMultiple(`
				CREATE TABLE mission_pilot_sessions (
					id text PRIMARY KEY NOT NULL,
					active_test_snapshot_id text,
					test_cycle integer DEFAULT 0 NOT NULL
				);
				CREATE TABLE mission_pilot_phase_runs (
					id text PRIMARY KEY NOT NULL
				);
				CREATE TABLE mission_pilot_test_snapshots (
					id text PRIMARY KEY NOT NULL,
					session_id text NOT NULL,
					phase_run_id text NOT NULL,
					verification_document_id text NOT NULL,
					context_revision integer NOT NULL,
					context_digest text NOT NULL,
					checklist_digest text NOT NULL,
					required_total integer NOT NULL,
					required_complete integer NOT NULL,
					failed_required integer NOT NULL,
					unknown_required integer NOT NULL,
					evidence_run_ids_json text NOT NULL,
					completion_check_event_id text NOT NULL,
					test_changed_paths_json text NOT NULL,
					verdict text NOT NULL,
					snapshot_json text NOT NULL,
					created_at integer NOT NULL
				);
				CREATE TABLE mission_pilot_review_decisions (
					id text PRIMARY KEY NOT NULL,
					session_id text NOT NULL,
					review_session_id text NOT NULL,
					review_phase_run_id text NOT NULL,
					context_revision integer NOT NULL,
					context_digest text NOT NULL,
					test_snapshot_id text NOT NULL,
					target_manifest_digest text NOT NULL,
					verdict text NOT NULL,
					blocking_count integer NOT NULL,
					warning_count integer NOT NULL,
					info_count integer NOT NULL,
					finding_ids_json text NOT NULL,
					decision_json text NOT NULL,
					created_at integer NOT NULL
				);
				INSERT INTO mission_pilot_sessions
					(id, active_test_snapshot_id, test_cycle)
					VALUES ('session-1', 'snapshot-1', 2);
				INSERT INTO mission_pilot_phase_runs (id) VALUES ('phase-1');
				INSERT INTO mission_pilot_test_snapshots VALUES (
					'snapshot-1', 'session-1', 'phase-1', 'document-1', 3, 'ctx',
					'checklist', 1, 1, 0, 0, '["evidence-1"]', 'event-1',
					'["src/a.ts"]', 'pass', '{}', 1
				);
				INSERT INTO mission_pilot_review_decisions VALUES (
					'decision-1', 'session-1', 'review-1', 'phase-1', 3, 'ctx',
					'snapshot-1', 'target', 'pass', 0, 0, 0, '[]', '{}', 1
				);
			`);
			const migration = await readFile(
				new URL(
					"../drizzle/migrations/0051_mission_pilot_verification_snapshot.sql",
					import.meta.url,
				),
				"utf8",
			);

			await client.executeMultiple(migration);

			const snapshot = await client.execute(
				"SELECT source_phase_run_id, changed_paths_json FROM mission_pilot_verification_snapshots",
			);
			expect(snapshot.rows).toEqual([
				expect.objectContaining({
					source_phase_run_id: "phase-1",
					changed_paths_json: '["src/a.ts"]',
				}),
			]);
			const decision = await client.execute(
				"SELECT verification_snapshot_id FROM mission_pilot_review_decisions",
			);
			expect(decision.rows[0]).toMatchObject({
				verification_snapshot_id: "snapshot-1",
			});
			const session = await client.execute(
				"SELECT active_verification_snapshot_id FROM mission_pilot_sessions",
			);
			expect(session.rows[0]).toMatchObject({
				active_verification_snapshot_id: "snapshot-1",
			});
			const columns = await client.execute(
				"PRAGMA table_info(mission_pilot_sessions)",
			);
			expect(columns.rows.map((row) => row.name)).not.toEqual(
				expect.arrayContaining(["active_test_snapshot_id", "test_cycle"]),
			);
			const legacyTable = await client.execute(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mission_pilot_test_snapshots'",
			);
			expect(legacyTable.rows).toHaveLength(0);
		} finally {
			client.close();
		}
	});
});
