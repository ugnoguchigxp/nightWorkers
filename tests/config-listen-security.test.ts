import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function loadConfig(input: {
	host: string;
	authRequired: boolean;
	nodeEnv?: string;
}) {
	return spawnSync(
		"bun",
		["-e", "await import('./api/config.ts'); process.stdout.write('loaded')"],
		{
			cwd: process.cwd(),
			encoding: "utf8",
			env: {
				...process.env,
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
		expect(result.stdout).toContain("loaded");
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
});
