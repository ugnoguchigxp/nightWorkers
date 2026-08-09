import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function loadConfig(input: { host: string; nodeEnv?: string }) {
	const nodeEnv = input.nodeEnv ?? "production";
	return spawnSync(
		"bun",
		[
			"-e",
			"const { config } = await import('./api/config.ts'); process.stdout.write(config.DATABASE_URL + '|' + config.PORT)",
		],
		{
			cwd: process.cwd(),
			encoding: "utf8",
			env: {
				...process.env,
				NIGHTWORKERS_DATABASE_ACCESS_SCOPE:
					nodeEnv === "test" ? "isolated_test" : "operational",
				NIGHTWORKERS_VITEST_DB_PATH: undefined,
				NIGHTWORKERS_CONFIG_TEST: "1",
				NODE_ENV: nodeEnv,
				HOST: input.host,
				PORT: "0",
				DATABASE_URL: "file:/tmp/nightworkers-config-security.sqlite",
				CORS_ORIGIN: "http://127.0.0.1:39174",
				NIGHTWORKERS_DESKTOP: "0",
			},
		},
	);
}

describe("local-only listen config", () => {
	it.each([
		"127.0.0.1",
		"localhost",
		"::1",
	])("loads loopback host %s", (host) => {
		const result = loadConfig({ host });
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain(".nightworkers/sqlite.db");
		expect(result.stdout).toContain("|39173");
	});

	it.each([
		"0.0.0.0",
		"10.0.0.2",
		"203.0.113.7",
	])("rejects non-loopback host %s in every environment", (host) => {
		for (const nodeEnv of ["development", "production"]) {
			const result = loadConfig({ host, nodeEnv });
			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain(
				"NightWorkers is local-only. HOST must resolve to a loopback address",
			);
		}
	});

	it("isolates a direct Bun test from the working DATABASE_URL", () => {
		const result = loadConfig({
			host: "127.0.0.1",
			nodeEnv: "test",
		});
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain("nightworkers-bun-test-");
		expect(result.stdout).not.toContain("nightworkers-config-security.sqlite");
	});
});
