import os from "node:os";
import path from "node:path";

export const testDatabasePath =
	process.env.NIGHTWORKERS_VITEST_DB_PATH ||
	path.join(os.tmpdir(), "nightworkers-vitest.sqlite");

export function applyVitestDatabaseEnv() {
	process.env.NODE_ENV = "test";
	process.env.NIGHTWORKERS_VITEST_DB_PATH = testDatabasePath;
	process.env.DATABASE_URL = `file:${testDatabasePath}`;
	process.env.JWT_SECRET = "nightworkers-vitest-jwt-secret-with-enough-length";
	process.env.AUTH_MODE = "local";
	process.env.API_AUTH_REQUIRED = "false";
	process.env.APP_URL = "http://localhost:39174";
	process.env.CORS_ORIGIN = "http://localhost:39174";
	process.env.NIGHTWORKERS_DESKTOP = "0";
}

export function assertVitestDatabaseIsolation(
	databaseUrl: string | undefined,
	env: NodeJS.ProcessEnv = process.env,
) {
	const expectedPath = env.NIGHTWORKERS_VITEST_DB_PATH?.trim();
	if (!expectedPath) {
		throw new Error(
			"NIGHTWORKERS_VITEST_DB_PATH is required before destructive test cleanup.",
		);
	}
	const actualPath = databaseUrl?.startsWith("file:")
		? databaseUrl.slice("file:".length)
		: databaseUrl;
	if (!actualPath || path.resolve(actualPath) !== path.resolve(expectedPath)) {
		throw new Error(
			`Refusing destructive test cleanup outside the isolated Vitest database: ${actualPath || "<missing>"}`,
		);
	}
}
