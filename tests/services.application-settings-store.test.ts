import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { writeApplicationSettingBundle } from "../api/services/settings/application-settings-store";

describe("application settings store", () => {
	it("updates public and secret revisions in one bundle", async () => {
		await writeApplicationSettingBundle("llm", { value: 1 }, { secret: "one" });
		await writeApplicationSettingBundle("llm", { value: 2 }, { secret: "two" });

		const databasePath = process.env.DATABASE_URL?.replace(/^file:/, "");
		if (!databasePath) throw new Error("DATABASE_URL is required");
		const revisions = execFileSync(
			"sqlite3",
			[
				databasePath,
				"SELECT revision FROM application_settings WHERE scope = 'llm' UNION ALL SELECT revision FROM application_setting_secrets WHERE scope = 'llm' ORDER BY revision",
			],
			{ encoding: "utf8" },
		)
			.trim()
			.split("\n");

		expect(revisions).toHaveLength(2);
		expect(revisions[0]).toBe(revisions[1]);
		expect(Number(revisions[0])).toBeGreaterThanOrEqual(2);
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
						secrets: { llm: { apiKey: "worker-secret" } },
					}),
				},
			},
		);

		expect(JSON.parse(output)).toEqual({
			inheritedSnapshot: null,
			secret: { apiKey: "worker-secret" },
		});
	});
});
