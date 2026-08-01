import { readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

describe("0061_strict_evidence_confirmation_receipt migration", () => {
	it("preserves legacy receipts and adds strict immutable binding columns", async () => {
		const client = createClient({ url: "file::memory:" });
		try {
			await client.executeMultiple(`
				CREATE TABLE coding_agent_evidence_check_confirmations (
					id text PRIMARY KEY NOT NULL,
					snapshot_json text NOT NULL
				);
				CREATE TABLE coding_agent_evidence_readiness_settlements (
					id text PRIMARY KEY NOT NULL,
					snapshot_json text NOT NULL
				);
				INSERT INTO coding_agent_evidence_check_confirmations
					(id, snapshot_json) VALUES ('legacy-confirmation', '{}');
				INSERT INTO coding_agent_evidence_readiness_settlements
					(id, snapshot_json) VALUES ('legacy-settlement', '{}');
			`);
			const migration = await readFile(
				new URL(
					"../drizzle/migrations/0061_strict_evidence_confirmation_receipt.sql",
					import.meta.url,
				),
				"utf8",
			);

			await client.executeMultiple(migration);

			const confirmationColumns = await client.execute(
				"PRAGMA table_info(coding_agent_evidence_check_confirmations)",
			);
			expect(confirmationColumns.rows.map((column) => column.name)).toEqual(
				expect.arrayContaining([
					"policy_version",
					"source_state_hash",
					"verification_document_digest",
					"authorized_verify_digest",
					"receipt_digest",
				]),
			);
			const settlementColumns = await client.execute(
				"PRAGMA table_info(coding_agent_evidence_readiness_settlements)",
			);
			expect(settlementColumns.rows.map((column) => column.name)).toEqual(
				expect.arrayContaining(["confirmation_id", "receipt_digest"]),
			);
			const legacy = await client.execute(
				"SELECT id, policy_version, receipt_digest FROM coding_agent_evidence_check_confirmations",
			);
			expect(legacy.rows[0]).toMatchObject({
				id: "legacy-confirmation",
				policy_version: null,
				receipt_digest: null,
			});
		} finally {
			client.close();
		}
	});
});
