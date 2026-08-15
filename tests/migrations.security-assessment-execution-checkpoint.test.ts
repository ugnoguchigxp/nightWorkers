import { readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

describe("0065_security_assessment_execution_checkpoint migration", () => {
	it("adds a nullable restart checkpoint without changing existing attempts", async () => {
		const client = createClient({ url: "file::memory:" });
		try {
			await client.executeMultiple(`
				CREATE TABLE security_assessment_attempts (
					id text PRIMARY KEY NOT NULL,
					attempt_ref text NOT NULL,
					status text NOT NULL
				);
				INSERT INTO security_assessment_attempts (id, attempt_ref, status)
					VALUES ('attempt-id', 'siat:v1:legacy', 'unavailable');
			`);
			const migration = await readFile(
				new URL(
					"../drizzle/migrations/0065_security_assessment_execution_checkpoint.sql",
					import.meta.url,
				),
				"utf8",
			);

			await client.executeMultiple(migration);

			const rows = await client.execute(
				"SELECT id, attempt_ref, status, execution_context_json FROM security_assessment_attempts",
			);
			expect(rows.rows).toEqual([
				expect.objectContaining({
					id: "attempt-id",
					attempt_ref: "siat:v1:legacy",
					status: "unavailable",
					execution_context_json: null,
				}),
			]);
			await client.execute({
				sql: "UPDATE security_assessment_attempts SET execution_context_json = ? WHERE id = ?",
				args: ['{"stage":"started","version":1}', "attempt-id"],
			});
			const updated = await client.execute(
				"SELECT execution_context_json FROM security_assessment_attempts WHERE id = 'attempt-id'",
			);
			expect(updated.rows[0]?.execution_context_json).toBe(
				'{"stage":"started","version":1}',
			);
		} finally {
			client.close();
		}
	});
});
