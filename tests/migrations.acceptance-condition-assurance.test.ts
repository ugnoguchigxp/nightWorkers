import { readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

describe("0060_acceptance_condition_assurance migration", () => {
	it("preserves legacy evidence and adds strict case identity columns", async () => {
		const client = createClient({ url: "file::memory:" });
		try {
			await client.executeMultiple(`
				CREATE TABLE verification_evidence_runs (
					id text PRIMARY KEY NOT NULL
				);
				CREATE TABLE verification_evidence_cases (
					id text PRIMARY KEY NOT NULL,
					name text NOT NULL
				);
				INSERT INTO verification_evidence_runs (id) VALUES ('run-1');
				INSERT INTO verification_evidence_cases (id, name)
					VALUES ('case-1', 'legacy case');
			`);
			const migration = await readFile(
				new URL(
					"../drizzle/migrations/0060_acceptance_condition_assurance.sql",
					import.meta.url,
				),
				"utf8",
			);

			await client.executeMultiple(migration);

			const run = await client.execute(
				"SELECT id, evidence_kinds_json FROM verification_evidence_runs",
			);
			expect(run.rows[0]).toMatchObject({
				id: "run-1",
				evidence_kinds_json: "[]",
			});
			const evidenceCase = await client.execute(
				"SELECT id, name, case_key, runner, evidence_kind FROM verification_evidence_cases",
			);
			expect(evidenceCase.rows[0]).toMatchObject({
				id: "case-1",
				name: "legacy case",
				case_key: null,
				runner: null,
				evidence_kind: null,
			});
			const confirmationTable = await client.execute(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'coding_agent_condition_confirmations'",
			);
			expect(confirmationTable.rows).toHaveLength(1);
			const confirmationColumns = await client.execute(
				"PRAGMA table_info(coding_agent_condition_confirmations)",
			);
			expect(confirmationColumns.rows.map((column) => column.name)).toEqual(
				expect.arrayContaining([
					"task_id",
					"run_id",
					"verification_document_id",
					"condition_id",
					"actor_kind",
					"source_state_hash",
					"evidence_ref",
				]),
			);
		} finally {
			client.close();
		}
	});
});
