import { beforeAll, describe, expect, it } from "vitest";
import app from "../api/app";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { client } from "../api/db/client";

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

describe("removed product authentication", () => {
	it("does not expose the former authentication API", async () => {
		const response = await app.request("/api/auth/methods");
		expect(response.status).toBe(404);
	});

	it("removes legacy authentication tables and persisted auth settings idempotently", async () => {
		const now = Date.now();
		await client.execute(`
			CREATE TABLE users (
				id text PRIMARY KEY NOT NULL,
				email text NOT NULL
			)
		`);
		await client.execute(`
			CREATE TABLE refresh_tokens (
				id text PRIMARY KEY NOT NULL,
				user_id text NOT NULL,
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade
			)
		`);
		await client.execute(`
			CREATE TABLE user_external_accounts (
				id text PRIMARY KEY NOT NULL,
				user_id text NOT NULL,
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade
			)
		`);
		await client.execute({
			sql: `
				INSERT OR REPLACE INTO application_settings
					(scope, value_json, revision, created_at, updated_at)
				VALUES ('auth', ?, 1, ?, ?)
			`,
			args: ['{"mode":"local"}', now, now],
		});
		await client.execute({
			sql: `
				INSERT OR REPLACE INTO application_setting_secrets
					(scope, value_json, revision, created_at, updated_at)
				VALUES ('auth', ?, 1, ?, ?)
			`,
			args: ['{"secret":"legacy"}', now, now],
		});

		await ensureNightWorkersSchema();
		await ensureNightWorkersSchema();

		const tables = await client.execute(`
			SELECT name
			FROM sqlite_master
			WHERE type = 'table'
				AND name IN ('users', 'refresh_tokens', 'user_external_accounts')
		`);
		expect(tables.rows).toHaveLength(0);

		const settings = await client.execute(`
			SELECT scope FROM application_settings WHERE scope = 'auth'
			UNION ALL
			SELECT scope FROM application_setting_secrets WHERE scope = 'auth'
		`);
		expect(settings.rows).toHaveLength(0);
	});
});
