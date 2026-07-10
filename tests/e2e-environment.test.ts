import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
	assertIsolatedE2eEnvironment,
	cleanupIsolatedE2eEnvironment,
	createIsolatedE2eEnvironment,
} from "../scripts/e2e-environment.mjs";

const sandboxes: string[] = [];

afterEach(() => {
	for (const sandbox of sandboxes.splice(0)) {
		fs.rmSync(sandbox, { recursive: true, force: true });
	}
});

function createRepositorySandbox() {
	const sandbox = fs.mkdtempSync(
		path.join(os.tmpdir(), "nightworkers-e2e-isolation-test-"),
	);
	sandboxes.push(sandbox);
	const repositoryRoot = path.join(sandbox, "repository");
	fs.mkdirSync(repositoryRoot, { recursive: true });
	return repositoryRoot;
}

describe("isolated E2E environment", () => {
	it("keeps the working database unchanged and resets the dedicated database", async () => {
		const repositoryRoot = createRepositorySandbox();
		const workingDatabase = path.join(repositoryRoot, "sqlite.db");
		fs.writeFileSync(workingDatabase, "working-database-sentinel");
		const environment = await createIsolatedE2eEnvironment({
			repositoryRoot,
			runId: "isolated-run",
			webPort: 41001,
			apiPort: 41002,
			env: {
				DATABASE_URL: pathToFileURL(workingDatabase).href,
				OPENAI_API_KEY: "must-not-leak",
			},
		});

		expect(environment.databasePath).not.toBe(workingDatabase);
		expect(environment.databasePath.startsWith(environment.runRoot)).toBe(true);
		expect(environment.env.OPENAI_API_KEY).toBe("");
		expect(environment.env.NIGHTWORKERS_E2E_RUNTIME_FIXTURE).toBe("1");
		for (const suffix of ["", "-wal", "-shm"]) {
			fs.writeFileSync(`${environment.databasePath}${suffix}`, "e2e-data");
		}

		cleanupIsolatedE2eEnvironment(environment);

		expect(fs.readFileSync(workingDatabase, "utf8")).toBe(
			"working-database-sentinel",
		);
		expect(fs.existsSync(environment.runRoot)).toBe(false);
		for (const suffix of ["", "-wal", "-shm"]) {
			expect(fs.existsSync(`${environment.databasePath}${suffix}`)).toBe(false);
		}
	});

	it("preserves credentials only for an explicitly enabled live E2E run", async () => {
		const environment = await createIsolatedE2eEnvironment({
			repositoryRoot: createRepositorySandbox(),
			runId: "live-run",
			webPort: 41003,
			apiPort: 41004,
			env: {
				NIGHTWORKERS_LIVE_LLM_E2E: "1",
				OPENAI_API_KEY: "live-key",
			},
		});
		try {
			expect(environment.env.OPENAI_API_KEY).toBe("live-key");
			expect(environment.env.NIGHTWORKERS_E2E_RUNTIME_FIXTURE).toBe("0");
		} finally {
			cleanupIsolatedE2eEnvironment(environment);
		}
	});

	it("rejects a database outside the isolated run root", () => {
		const repositoryRoot = createRepositorySandbox();
		const runRoot = path.join(repositoryRoot, ".nightworkers-e2e", "run");
		const outsideDatabase = path.join(repositoryRoot, "sqlite.db");
		expect(() =>
			assertIsolatedE2eEnvironment({
				NIGHTWORKERS_E2E_ISOLATED: "1",
				NIGHTWORKERS_E2E_RUN_ROOT: runRoot,
				NIGHTWORKERS_E2E_DATABASE_PATH: outsideDatabase,
				NIGHTWORKERS_E2E_WORKSPACE_ROOT: path.join(runRoot, "workspaces"),
				NIGHTWORKERS_RUNTIME_DIR: path.join(runRoot, "runtime"),
				DATABASE_URL: pathToFileURL(outsideDatabase).href,
			}),
		).toThrow("E2E database path must stay inside");
	});

	it("routes every package E2E command through the isolation wrapper", () => {
		const packageJson = JSON.parse(
			fs.readFileSync(path.resolve("package.json"), "utf8"),
		) as { scripts: Record<string, string> };
		for (const [name, command] of Object.entries(packageJson.scripts).filter(
			([name]) => name.startsWith("test:e2e"),
		)) {
			const wrapperPath = command.match(/scripts\/[\w-]+\.mjs/)?.[0];
			const wrapperSource = wrapperPath
				? fs.readFileSync(path.resolve(wrapperPath), "utf8")
				: "";
			expect(
				command.includes("scripts/run-playwright.mjs") ||
					wrapperSource.includes("scripts/run-playwright.mjs"),
				name,
			).toBe(true);
		}
		const playwrightConfig = fs.readFileSync(
			path.resolve("playwright.config.ts"),
			"utf8",
		);
		expect(playwrightConfig).toContain("reuseExistingServer: false");
		expect(fs.readFileSync(path.resolve(".gitignore"), "utf8")).toContain(
			".nightworkers-e2e/",
		);
	});
});
