import { readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

describe("0050_coding_agent_todo_key migration", () => {
	it("backfills legacy rows and enforces Run-local Todo key uniqueness", async () => {
		const client = createClient({ url: "file::memory:" });
		try {
			await client.execute(`
				CREATE TABLE task_run_todos (
					id text PRIMARY KEY NOT NULL,
					run_id text NOT NULL
				)
			`);
			await client.batch([
				{
					sql: "INSERT INTO task_run_todos (id, run_id) VALUES (?, ?)",
					args: ["legacy-a", "run-a"],
				},
				{
					sql: "INSERT INTO task_run_todos (id, run_id) VALUES (?, ?)",
					args: ["legacy-b", "run-b"],
				},
			]);
			const migration = await readFile(
				new URL(
					"../drizzle/migrations/0050_coding_agent_todo_key.sql",
					import.meta.url,
				),
				"utf8",
			);

			await client.executeMultiple(migration);

			const rows = await client.execute(
				"SELECT id, run_id, todo_key FROM task_run_todos ORDER BY id",
			);
			expect(rows.rows).toEqual([
				expect.objectContaining({
					id: "legacy-a",
					run_id: "run-a",
					todo_key: "legacy-a",
				}),
				expect.objectContaining({
					id: "legacy-b",
					run_id: "run-b",
					todo_key: "legacy-b",
				}),
			]);
			await expect(
				client.execute({
					sql: "INSERT INTO task_run_todos (id, run_id, todo_key) VALUES (?, ?, ?)",
					args: ["new-id", "run-a", "legacy-a"],
				}),
			).rejects.toThrow(/UNIQUE constraint failed/);
			await expect(
				client.execute({
					sql: "INSERT INTO task_run_todos (id, run_id, todo_key) VALUES (?, ?, ?)",
					args: ["null-key", "run-a", null],
				}),
			).rejects.toThrow(/todo_key must not be null/);
		} finally {
			client.close();
		}
	});
});
