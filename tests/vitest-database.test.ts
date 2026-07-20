import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	cleanupVitestDatabase,
	resolveVitestDatabase,
} from "../scripts/vitest-database.mjs";
import { assertVitestDatabaseIsolation } from "./vitest-db-env";

const testDirectory = path.join(
	os.tmpdir(),
	`nightworkers-vitest-db-test-${process.pid}`,
);

afterEach(() => {
	fs.rmSync(testDirectory, { recursive: true, force: true });
});

describe("Vitest database lifecycle", () => {
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
