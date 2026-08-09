import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildVitestChildEnvironment,
	cleanupVitestDatabase,
	resolveVitestDatabase,
} from "../scripts/vitest-database.mjs";
import {
	assertVitestDatabaseIsolation,
	assertVitestWorkspaceIsolation,
} from "./vitest-db-env";

const testDirectory = path.join(
	os.tmpdir(),
	`nightworkers-vitest-db-test-${process.pid}`,
);

afterEach(() => {
	fs.rmSync(testDirectory, { recursive: true, force: true });
});

describe("Vitest database lifecycle", () => {
	it("replaces inherited run ownership with manifest-free Vitest isolation", () => {
		const inherited = {
			KEEP_ME: "value",
			NIGHTWORKERS_E2E: "1",
			NIGHTWORKERS_E2E_ISOLATED: "1",
			NIGHTWORKERS_E2E_RUN_ROOT: "/tmp/outer-e2e",
			NIGHTWORKERS_ISOLATED_RUN_ROOT: "/tmp/outer-run",
			NIGHTWORKERS_ISOLATED_RUN_ID: "outer-run",
			NIGHTWORKERS_ISOLATED_MANIFEST_PATH: "/tmp/outer-manifest.json",
		};
		const result = buildVitestChildEnvironment({
			env: inherited,
			databasePath: "/tmp/vitest.sqlite",
			runRoot: "/tmp/vitest-run",
			workspaceRoot: "/tmp/vitest-workspace",
		});

		expect(result).toMatchObject({
			KEEP_ME: "value",
			NODE_ENV: "test",
			NIGHTWORKERS_DATABASE_ACCESS_SCOPE: "isolated_test",
			NIGHTWORKERS_VITEST_DB_PATH: "/tmp/vitest.sqlite",
			NIGHTWORKERS_VITEST_RUN_ROOT: "/tmp/vitest-run",
			NIGHTWORKERS_VITEST_WORKSPACE_ROOT: "/tmp/vitest-workspace",
		});
		expect(result).not.toHaveProperty("NIGHTWORKERS_E2E_ISOLATED");
		expect(result).not.toHaveProperty("NIGHTWORKERS_E2E");
		expect(result).not.toHaveProperty("NIGHTWORKERS_E2E_RUN_ROOT");
		expect(result).not.toHaveProperty("NIGHTWORKERS_ISOLATED_RUN_ROOT");
		expect(result).not.toHaveProperty("NIGHTWORKERS_ISOLATED_RUN_ID");
		expect(result).not.toHaveProperty("NIGHTWORKERS_ISOLATED_MANIFEST_PATH");
		expect(inherited.NIGHTWORKERS_E2E_ISOLATED).toBe("1");
	});

	it("allows cleanup only for the configured isolated test database", () => {
		const databasePath = path.join(testDirectory, "isolated.sqlite");
		expect(() =>
			assertVitestDatabaseIsolation(`file:${databasePath}`, {
				NIGHTWORKERS_VITEST_DB_PATH: databasePath,
			}),
		).not.toThrow();
		expect(() =>
			assertVitestDatabaseIsolation("file:.nightworkers/sqlite.db", {
				NIGHTWORKERS_VITEST_DB_PATH: databasePath,
			}),
		).toThrow("Refusing destructive test cleanup");
	});

	it("requires the database and workspace to share an isolated run root", () => {
		const runRoot = path.join(testDirectory, "run");
		const databasePath = path.join(runRoot, "database", "vitest.sqlite");
		const workspaceRoot = path.join(runRoot, "workspaces");
		fs.mkdirSync(path.dirname(databasePath), { recursive: true });
		fs.mkdirSync(workspaceRoot, { recursive: true });
		fs.writeFileSync(databasePath, "");
		expect(
			assertVitestWorkspaceIsolation({
				NIGHTWORKERS_VITEST_DB_PATH: databasePath,
				NIGHTWORKERS_VITEST_RUN_ROOT: runRoot,
				NIGHTWORKERS_VITEST_WORKSPACE_ROOT: workspaceRoot,
			}),
		).toEqual({
			runRoot: fs.realpathSync(runRoot),
			databasePath: fs.realpathSync(databasePath),
			workspaceRoot: fs.realpathSync(workspaceRoot),
		});
		const outsideDatabase = path.join(testDirectory, "working.sqlite");
		fs.writeFileSync(outsideDatabase, "");
		expect(() =>
			assertVitestWorkspaceIsolation({
				NIGHTWORKERS_VITEST_DB_PATH: outsideDatabase,
				NIGHTWORKERS_VITEST_RUN_ROOT: runRoot,
				NIGHTWORKERS_VITEST_WORKSPACE_ROOT: workspaceRoot,
			}),
		).toThrow("same isolated run root");
		expect(() => assertVitestWorkspaceIsolation({})).toThrow(
			"Run a package test script",
		);
	});

	it("preserves an explicitly configured database", () => {
		fs.mkdirSync(testDirectory, { recursive: true });
		const databasePath = path.join(testDirectory, "configured.sqlite");
		fs.writeFileSync(databasePath, "owned by caller");
		const database = resolveVitestDatabase({
			env: { NIGHTWORKERS_VITEST_DB_PATH: databasePath },
		});

		cleanupVitestDatabase(database);

		expect(database.owned).toBe(false);
		expect(fs.readFileSync(databasePath, "utf8")).toBe("owned by caller");
	});

	it("removes the generated database and SQLite side files", () => {
		fs.mkdirSync(testDirectory, { recursive: true });
		const database = resolveVitestDatabase({
			env: {},
			pid: 123,
			now: 456,
			random: 0.5,
			tempDirectory: testDirectory,
		});
		for (const suffix of ["", "-shm", "-wal"]) {
			fs.writeFileSync(`${database.databasePath}${suffix}`, "temporary");
		}

		cleanupVitestDatabase(database);

		expect(database.owned).toBe(true);
		for (const suffix of ["", "-shm", "-wal"]) {
			expect(fs.existsSync(`${database.databasePath}${suffix}`)).toBe(false);
		}
	});
});
