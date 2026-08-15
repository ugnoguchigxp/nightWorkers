import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
	cleanupIsolatedRuntimeEnvironment,
	createIsolatedRuntimeEnvironment,
	type IsolatedRuntimeEnvironment,
} from "../scripts/isolated-runtime-environment.mjs";
import {
	assertDatabaseAccessEnvironment,
	DATABASE_ACCESS_SCOPES,
	requireDatabaseAccessScope,
} from "../shared/runtime-database-access.mjs";

const sandboxes: string[] = [];
const isolatedEnvironments: IsolatedRuntimeEnvironment[] = [];

afterEach(() => {
	for (const environment of isolatedEnvironments.splice(0)) {
		if (fs.existsSync(environment.runRoot)) {
			cleanupIsolatedRuntimeEnvironment(environment);
		}
	}
	for (const sandbox of sandboxes.splice(0)) {
		fs.rmSync(sandbox, { recursive: true, force: true });
	}
});

function createSandbox() {
	const sandbox = fs.mkdtempSync(
		path.join(os.tmpdir(), "nightworkers-database-access-test-"),
	);
	sandboxes.push(sandbox);
	return sandbox;
}

describe("runtime database access safety", () => {
	it("fails closed when database access scope is absent", () => {
		expect(() => requireDatabaseAccessScope({})).toThrow(
			"NIGHTWORKERS_DATABASE_ACCESS_SCOPE must explicitly select",
		);
	});

	it("rejects an isolated run id containing path traversal", () => {
		expect(() =>
			createIsolatedRuntimeEnvironment({
				repositoryRoot: createSandbox(),
				scope: DATABASE_ACCESS_SCOPES.isolatedEvaluation,
				runId: "../outside",
			}),
		).toThrow("runId must be one path segment");
	});

	it("accepts the operational database only for operational scope", () => {
		const databasePath = path.join(createSandbox(), "operational.sqlite");
		fs.writeFileSync(databasePath, "");
		expect(
			assertDatabaseAccessEnvironment(
				{
					NIGHTWORKERS_DATABASE_ACCESS_SCOPE: "operational",
					DATABASE_URL: pathToFileURL(databasePath).href,
				},
				{ operationalDatabasePath: databasePath },
			),
		).toMatchObject({
			scope: DATABASE_ACCESS_SCOPES.operational,
			databasePath,
		});
	});

	it("rejects an evaluation database that resolves to the operational database", () => {
		const repositoryRoot = createSandbox();
		const isolated = createIsolatedRuntimeEnvironment({
			repositoryRoot,
			scope: DATABASE_ACCESS_SCOPES.isolatedEvaluation,
			runId: "evaluation-run",
		});
		isolatedEnvironments.push(isolated);

		expect(() =>
			assertDatabaseAccessEnvironment(isolated.env, {
				operationalDatabasePath: isolated.databasePath,
			}),
		).toThrow("cannot target the operational database");
	});

	it("keeps the isolated evaluation database when API config initializes", () => {
		const repositoryRoot = createSandbox();
		const isolated = createIsolatedRuntimeEnvironment({
			repositoryRoot,
			scope: DATABASE_ACCESS_SCOPES.isolatedEvaluation,
			runId: "config-run",
		});
		isolatedEnvironments.push(isolated);
		const result = spawnSync(
			"bun",
			[
				"-e",
				'const { config } = await import("./api/config.ts"); console.log(JSON.stringify(config.DATABASE_ACCESS));',
			],
			{
				cwd: path.resolve("."),
				env: {
					...isolated.env,
					NODE_ENV: "development",
					CORS_ORIGIN: "http://localhost:39174",
				},
				encoding: "utf8",
			},
		);

		expect(result.status, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout.trim())).toMatchObject({
			scope: DATABASE_ACCESS_SCOPES.isolatedEvaluation,
			databasePath: isolated.databasePath,
			runId: isolated.runId,
		});
	});

	it("refuses cleanup when the requested run root differs from the manifest", () => {
		const repositoryRoot = createSandbox();
		const isolated = createIsolatedRuntimeEnvironment({
			repositoryRoot,
			scope: DATABASE_ACCESS_SCOPES.isolatedEvaluation,
			runId: "cleanup-run",
		});
		isolatedEnvironments.push(isolated);
		const outside = path.join(repositoryRoot, "outside");
		fs.mkdirSync(outside);

		expect(() =>
			cleanupIsolatedRuntimeEnvironment({ ...isolated, runRoot: outside }),
		).toThrow("mismatched run root");
		expect(fs.existsSync(isolated.databasePath)).toBe(true);
	});

	it("prevents an arbitrary Bun script from opening a database without scope", () => {
		const sandbox = createSandbox();
		const databasePath = path.join(sandbox, "sentinel.sqlite");
		fs.writeFileSync(databasePath, "operational-sentinel");
		const env = { ...process.env };
		delete env.NIGHTWORKERS_DATABASE_ACCESS_SCOPE;
		delete env.NIGHTWORKERS_ISOLATED_MANIFEST_PATH;
		delete env.NIGHTWORKERS_ISOLATED_RUN_ID;
		delete env.NIGHTWORKERS_ISOLATED_RUN_ROOT;
		env.NODE_ENV = "development";
		env.NIGHTWORKERS_DESKTOP = "0";
		env.DATABASE_URL = pathToFileURL(databasePath).href;
		env.CORS_ORIGIN = "http://localhost:39174";

		const result = spawnSync(
			"bun",
			["-e", 'await import("./api/db/client.ts")'],
			{
				cwd: path.resolve("."),
				env,
				encoding: "utf8",
			},
		);

		expect(result.status).not.toBe(0);
		expect(`${result.stdout}${result.stderr}`).toContain(
			"NIGHTWORKERS_DATABASE_ACCESS_SCOPE must explicitly select",
		);
		expect(fs.readFileSync(databasePath, "utf8")).toBe("operational-sentinel");
		expect(fs.existsSync(`${databasePath}-wal`)).toBe(false);
		expect(fs.existsSync(`${databasePath}-shm`)).toBe(false);
	});

	it("prevents direct settings-store access from bypassing the database scope", () => {
		const sandbox = createSandbox();
		const databasePath = path.join(sandbox, "settings-sentinel.sqlite");
		fs.writeFileSync(databasePath, "settings-sentinel");
		const env = { ...process.env };
		delete env.NIGHTWORKERS_DATABASE_ACCESS_SCOPE;
		delete env.NIGHTWORKERS_ISOLATED_MANIFEST_PATH;
		delete env.NIGHTWORKERS_ISOLATED_RUN_ID;
		delete env.NIGHTWORKERS_ISOLATED_RUN_ROOT;
		env.NODE_ENV = "development";
		env.NIGHTWORKERS_DESKTOP = "0";
		env.DATABASE_URL = pathToFileURL(databasePath).href;

		const result = spawnSync(
			"bun",
			[
				"-e",
				'const settings = await import("./api/services/settings/application-settings-store.ts"); settings.readApplicationSetting("general");',
			],
			{
				cwd: path.resolve("."),
				env,
				encoding: "utf8",
			},
		);

		expect(result.status).not.toBe(0);
		expect(`${result.stdout}${result.stderr}`).toContain(
			"NIGHTWORKERS_DATABASE_ACCESS_SCOPE must explicitly select",
		);
		expect(fs.readFileSync(databasePath, "utf8")).toBe("settings-sentinel");
		expect(fs.existsSync(`${databasePath}-wal`)).toBe(false);
		expect(fs.existsSync(`${databasePath}-shm`)).toBe(false);
	});

	it("cleans an evaluation runtime when the pilot worker fails", () => {
		const sandbox = createSandbox();
		const targetRoot = path.join(sandbox, "target");
		const producerRoot = path.join(sandbox, "producer");
		const settingsPath = path.join(sandbox, "llm.json");
		fs.mkdirSync(targetRoot);
		fs.mkdirSync(producerRoot);
		fs.writeFileSync(settingsPath, "{}\n");

		const result = spawnSync(
			"node",
			[
				"scripts/run-project-exploration-paired-pilot.mjs",
				"--llm-settings-path",
				settingsPath,
				"--repository-root",
				targetRoot,
				"--producer-root",
				producerRoot,
				"--pair-count",
				"1",
			],
			{
				cwd: path.resolve("."),
				env: process.env,
				encoding: "utf8",
			},
		);

		expect(result.status).not.toBe(0);
		const runId = result.stdout.match(/isolated run id: (.+)/)?.[1]?.trim();
		expect(runId).toBeTruthy();
		expect(result.stdout).toContain("isolated runtime reset:");
		expect(
			fs.existsSync(
				path.join(path.resolve(".nightworkers-evaluations"), runId!),
			),
		).toBe(false);
	});
});
