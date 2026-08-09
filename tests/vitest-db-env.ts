import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const testDatabasePath =
	process.env.NIGHTWORKERS_VITEST_DB_PATH ||
	path.join(os.tmpdir(), "nightworkers-vitest.sqlite");

export function applyVitestDatabaseEnv() {
	process.env.NODE_ENV = "test";
	process.env.NIGHTWORKERS_DATABASE_ACCESS_SCOPE = "isolated_test";
	process.env.NIGHTWORKERS_VITEST_DB_PATH = testDatabasePath;
	process.env.DATABASE_URL = `file:${testDatabasePath}`;
	process.env.CORS_ORIGIN = "http://localhost:39174";
	process.env.NIGHTWORKERS_DESKTOP = "0";
}

export function requireVitestWorkspaceRoot(
	env: NodeJS.ProcessEnv = process.env,
) {
	const workspaceRoot = env.NIGHTWORKERS_VITEST_WORKSPACE_ROOT?.trim();
	if (!workspaceRoot) {
		throw new Error(
			"NIGHTWORKERS_VITEST_WORKSPACE_ROOT is required. Run a package test script.",
		);
	}
	return fs.realpathSync(workspaceRoot);
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

export function assertVitestWorkspaceIsolation(
	env: NodeJS.ProcessEnv = process.env,
) {
	const databasePath = env.NIGHTWORKERS_VITEST_DB_PATH?.trim();
	const runRoot = env.NIGHTWORKERS_VITEST_RUN_ROOT?.trim();
	const workspaceRoot = env.NIGHTWORKERS_VITEST_WORKSPACE_ROOT?.trim();
	if (!databasePath || !runRoot || !workspaceRoot) {
		throw new Error(
			"Vitest workspace isolation requires its database, run root, and workspace environment. Run a package test script.",
		);
	}
	const canonicalRunRoot = fs.realpathSync(runRoot);
	const canonicalWorkspace = fs.realpathSync(workspaceRoot);
	const canonicalDatabase = fs.realpathSync(databasePath);
	if (
		path.dirname(canonicalWorkspace) !== canonicalRunRoot ||
		path.basename(canonicalWorkspace) !== "workspaces" ||
		!isPathInside(canonicalRunRoot, canonicalDatabase)
	) {
		throw new Error(
			"Vitest database and workspace must belong to the same isolated run root.",
		);
	}
	return {
		runRoot: canonicalRunRoot,
		databasePath: canonicalDatabase,
		workspaceRoot: canonicalWorkspace,
	};
}

function isPathInside(root: string, candidate: string) {
	const relative = path.relative(root, candidate);
	return (
		Boolean(relative) &&
		relative !== ".." &&
		!relative.startsWith(`..${path.sep}`) &&
		!path.isAbsolute(relative)
	);
}
