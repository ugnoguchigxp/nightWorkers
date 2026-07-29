import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
	migrateLegacyApplicationSettingSecrets,
	readApplicationSettingSecrets,
	writeApplicationSettingBundle,
} from "../api/services/settings/application-settings-store";

describe("application settings store", () => {
	it("stores public settings in SQLite and secrets outside SQLite", async () => {
		await writeApplicationSettingBundle("llm", { value: 1 }, { secret: "one" });
		await writeApplicationSettingBundle("llm", { value: 2 }, { secret: "two" });

		const databasePath = process.env.DATABASE_URL?.replace(/^file:/, "");
		if (!databasePath) throw new Error("DATABASE_URL is required");
		const rows = execFileSync(
			"sqlite3",
			[
				databasePath,
				"SELECT revision FROM application_settings WHERE scope = 'llm'; SELECT count(*) FROM application_setting_secrets WHERE scope = 'llm'",
			],
			{ encoding: "utf8" },
		)
			.trim()
			.split("\n");

		expect(Number(rows[0])).toBeGreaterThanOrEqual(2);
		expect(rows[1]).toBe("0");
		expect(readApplicationSettingSecrets("llm")).toEqual({ secret: "two" });
	});

	it("purges migrated legacy secret bytes from SQLite and its WAL", () => {
		const databasePath = process.env.DATABASE_URL?.replace(/^file:/, "");
		if (!databasePath) throw new Error("DATABASE_URL is required");
		const legacySecret = `legacy-provider-${crypto.randomUUID()}`;
		execFileSync("sqlite3", [
			databasePath,
			`INSERT INTO application_setting_secrets(scope, value_json, revision, created_at, updated_at)
			 VALUES('integrations', json_object('apiKey', '${legacySecret}'), 1, unixepoch(), unixepoch())
			 ON CONFLICT(scope) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at;`,
		]);

		expect(migrateLegacyApplicationSettingSecrets()).toContain("integrations");
		for (const candidate of [
			databasePath,
			`${databasePath}-wal`,
			`${databasePath}-shm`,
		]) {
			const bytes = fs.existsSync(candidate)
				? fs.readFileSync(candidate)
				: Buffer.alloc(0);
			expect(bytes.includes(Buffer.from(legacySecret))).toBe(false);
		}
	});

	it("consumes the worker snapshot without leaving secrets in child environments", () => {
		const output = execFileSync(
			"bun",
			[
				"-e",
				'import { consumeApplicationSettingsWorkerSnapshot, readApplicationSettingSecrets } from "./api/services/settings/application-settings-store.ts"; consumeApplicationSettingsWorkerSnapshot(); console.log(JSON.stringify({ inheritedSnapshot: process.env.NIGHTWORKERS_APPLICATION_SETTINGS_SNAPSHOT ?? null, secret: readApplicationSettingSecrets("llm") }));',
			],
			{
				cwd: process.cwd(),
				encoding: "utf8",
				env: {
					...process.env,
					NIGHTWORKERS_EXECUTION_ROLE: "worker",
					NIGHTWORKERS_APPLICATION_SETTINGS_SNAPSHOT: JSON.stringify({
						public: {},
					}),
				},
			},
		);

		expect(JSON.parse(output)).toEqual({
			inheritedSnapshot: null,
			secret: null,
		});
	});
});
