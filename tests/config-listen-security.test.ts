import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function loadConfig(input: {
	host: string;
	authRequired: boolean;
	nodeEnv?: string;
}) {
	return spawnSync(
		"bun",
		[
			"-e",
			"const { config } = await import('./api/config.ts'); process.stdout.write(config.DATABASE_URL)",
		],
		{
			cwd: process.cwd(),
			encoding: "utf8",
			env: {
				...process.env,
				NIGHTWORKERS_VITEST_DB_PATH: undefined,
				NODE_ENV: input.nodeEnv ?? "production",
				HOST: input.host,
				PORT: "0",
				DATABASE_URL: "file:/tmp/nightworkers-config-security.sqlite",
				JWT_SECRET: "nightworkers-config-security-secret-32-chars",
				AUTH_MODE: "local",
				API_AUTH_REQUIRED: String(input.authRequired),
				CORS_ORIGIN: "https://nightworkers.example.test",
				NIGHTWORKERS_DESKTOP: "0",
			},
		},
	);
}

describe("production listen config", () => {
	it.each([
		"127.0.0.1",
		"::1",
	])("loads unauthenticated loopback host %s", (host) => {
		const result = loadConfig({ host, authRequired: false });
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain("nightworkers-config-security.sqlite");
	});

	it.each([
		"0.0.0.0",
		"10.0.0.2",
		"203.0.113.7",
	])("rejects unauthenticated non-loopback host %s", (host) => {
		const result = loadConfig({ host, authRequired: false });
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain(
			"Non-loopback production binding requires API_AUTH_REQUIRED=true",
		);
	});

	it("loads authenticated non-loopback host with explicit CORS", () => {
		const result = loadConfig({ host: "0.0.0.0", authRequired: true });
		expect(result.status, result.stderr).toBe(0);
	});

	it("isolates a direct Bun test from the working DATABASE_URL", () => {
		const result = loadConfig({
			host: "127.0.0.1",
			authRequired: false,
			nodeEnv: "test",
		});
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain("nightworkers-bun-test-");
		expect(result.stdout).not.toContain("nightworkers-config-security.sqlite");
	});
});
