import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const latestRows: unknown[] = [];
	const limit = vi.fn(async () => latestRows);
	const orderBy = vi.fn(() => ({ limit }));
	const where = vi.fn(() => ({ orderBy }));
	const from = vi.fn(() => ({ where }));
	const select = vi.fn(() => ({ from }));
	const transaction = vi.fn(async (callback: (tx: object) => unknown) =>
		callback({ kind: "transaction" }),
	);
	return {
		captureWorkspaceSourceSnapshot: vi.fn(async () => ({
			sourceStateHash: "snapshot-hash",
			gitHead: null,
			fileCount: 3,
			capturedAt: "2026-08-09T00:00:00.000Z",
		})),
		db: { select, transaction },
		enforcePathPolicy: vi.fn(() => ({ allowed: true })),
		insertTestInventory: vi.fn(async () => undefined),
		latestRows,
		runCommandTool: vi.fn(),
	};
});

vi.mock("../api/db/client", () => ({ db: mocks.db }));
vi.mock("../api/services/worker-tools/run-command", () => ({
	runCommandTool: mocks.runCommandTool,
}));
vi.mock("../api/services/worker-tools/tool-policy-enforcer", () => ({
	enforcePathPolicy: mocks.enforcePathPolicy,
}));
vi.mock(
	"../api/modules/codingAgent/verification/test-inventory-persistence",
	() => ({ insertTestInventory: mocks.insertTestInventory }),
);
vi.mock(
	"../api/modules/codingAgent/verification/workspace-source-snapshot",
	() => ({
		captureWorkspaceSourceSnapshot: mocks.captureWorkspaceSourceSnapshot,
	}),
);

import {
	collectTestInventory,
	getLatestTestInventory,
	persistTestInventory,
} from "../api/modules/codingAgent/verification/test-inventory.service";

const temporaryDirectories: string[] = [];

async function makeRepository() {
	const repoRoot = await fs.mkdtemp(
		path.join(os.tmpdir(), "nightworkers-test-inventory-extra-"),
	);
	temporaryDirectories.push(repoRoot);
	return repoRoot;
}

async function writeFixture(
	repoRoot: string,
	relativePath: string,
	contents = "",
) {
	const filePath = path.join(repoRoot, relativePath);
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, contents);
	return filePath;
}

function commandResult(stdout: string, exitCode = 0, ok = true) {
	return {
		ok,
		payload: {
			exitCode,
			stdout,
			stderr: "",
		},
	};
}

function baseInput(repoRoot: string) {
	return {
		taskId: "task-inventory",
		runId: "run-inventory",
		repoRoot,
		blockedCommands: ["blocked"],
		allowedPaths: [repoRoot],
		externalAllowedPaths: ["/external"],
		deniedPaths: ["secret"],
		maxCommandSeconds: 15,
		confinementRequired: true,
	};
}

describe("test inventory service extra coverage", () => {
	beforeEach(() => {
		mocks.latestRows.length = 0;
		mocks.runCommandTool.mockReset();
		mocks.enforcePathPolicy.mockReset();
		mocks.enforcePathPolicy.mockReturnValue({ allowed: true });
		mocks.insertTestInventory.mockClear();
		mocks.db.transaction.mockClear();
		mocks.db.select.mockClear();
		mocks.captureWorkspaceSourceSnapshot.mockClear();
	});

	afterEach(async () => {
		await Promise.all(
			temporaryDirectories
				.splice(0)
				.map((directory) => fs.rm(directory, { recursive: true, force: true })),
		);
	});

	it("reports denied, missing, and non-directory working directories", async () => {
		const repoRoot = await makeRepository();
		mocks.enforcePathPolicy.mockReturnValueOnce({
			allowed: false,
			message: "custom policy denial",
		});
		await expect(
			collectTestInventory(baseInput(repoRoot), { persist: false }),
		).rejects.toMatchObject({
			code: "TEST_INVENTORY_WORKSPACE_DENIED",
			message: "custom policy denial",
		});

		mocks.enforcePathPolicy.mockReturnValueOnce({
			allowed: false,
			message: "",
		});
		await expect(
			collectTestInventory(baseInput(repoRoot), { persist: false }),
		).rejects.toMatchObject({
			code: "TEST_INVENTORY_WORKSPACE_DENIED",
			message:
				"Test inventory working directory is outside the registered repository boundary.",
		});

		await expect(
			collectTestInventory(
				{ ...baseInput(repoRoot), cwd: "does-not-exist" },
				{ persist: false },
			),
		).rejects.toMatchObject({ code: "TEST_INVENTORY_CWD_NOT_FOUND" });

		await writeFixture(repoRoot, "not-a-directory", "plain file");
		await expect(
			collectTestInventory(
				{ ...baseInput(repoRoot), cwd: "not-a-directory" },
				{ persist: false },
			),
		).rejects.toMatchObject({ code: "TEST_INVENTORY_CWD_NOT_DIRECTORY" });
	});

	it("returns an empty non-persisted inventory when no tests or frameworks exist", async () => {
		const repoRoot = await makeRepository();
		await writeFixture(repoRoot, "README.md", "not a test");
		const inventory = await collectTestInventory(baseInput(repoRoot), {
			activeDiscovery: false,
			persist: false,
		});

		expect(inventory).toMatchObject({
			taskId: "task-inventory",
			runId: "run-inventory",
			cwd: repoRoot,
			cases: [],
			warnings: [],
			sourceSnapshot: { sourceStateHash: "snapshot-hash" },
		});
		expect(inventory.id).toEqual(expect.any(String));
		expect(inventory.createdAt).toEqual(expect.any(String));
		expect(mocks.runCommandTool).not.toHaveBeenCalled();
		expect(mocks.db.transaction).not.toHaveBeenCalled();
	});

	it("discovers static and conventional tests with package and path runner inference", async () => {
		const repoRoot = await makeRepository();
		await writeFixture(
			repoRoot,
			"package.json",
			JSON.stringify({ dependencies: { vitest: "1" } }),
		);
		await writeFixture(
			repoRoot,
			"src/unit.test.ts",
			[
				"// AC-002 AC-001 AC-002",
				'it("same name", () => {});',
				'it("same name", () => {});',
			].join("\n"),
		);
		await writeFixture(repoRoot, "src/conventional.spec.ts", "// no cases");
		await writeFixture(
			repoRoot,
			"e2e/browser.test.ts",
			'test("browser case", () => {});',
		);
		await writeFixture(
			repoRoot,
			"nested/jest/package.json",
			JSON.stringify({ peerDependencies: { jest: "1" } }),
		);
		await writeFixture(
			repoRoot,
			"nested/jest/one.test.ts",
			'test("jest one", () => {});',
		);
		await writeFixture(
			repoRoot,
			"nested/jest/two.test.ts",
			'test("jest two", () => {});',
		);
		await writeFixture(
			repoRoot,
			"nested/playwright/package.json",
			JSON.stringify({ devDependencies: { "@playwright/test": "1" } }),
		);
		await writeFixture(
			repoRoot,
			"nested/playwright/ui.spec.ts",
			'test("playwright package", () => {});',
		);
		await writeFixture(repoRoot, "unknown/package.json", "{not-json");
		await writeFixture(
			repoRoot,
			"unknown/odd.test.ts",
			'test("inherits root", () => {});',
		);
		await writeFixture(
			repoRoot,
			"tests/test_sample.py",
			"def test_python_case():\n    pass\n",
		);
		await writeFixture(
			repoRoot,
			"node_modules/ignored.test.ts",
			'test("ignored", () => {});',
		);
		await writeFixture(
			repoRoot,
			"target/ignored_test.go",
			"func TestIgnored(t *testing.T) {}",
		);

		const inventory = await collectTestInventory(baseInput(repoRoot), {
			activeDiscovery: false,
			persist: false,
		});

		expect(inventory.cases).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "same name",
					runner: "vitest",
					declaredConditionIds: ["AC-001", "AC-002"],
				}),
				expect.objectContaining({
					name: "conventional.spec.ts",
					discoveryLevel: "candidate",
				}),
				expect.objectContaining({
					name: "browser case",
					runner: "playwright",
				}),
				expect.objectContaining({ name: "jest one", runner: "jest" }),
				expect.objectContaining({
					name: "playwright package",
					runner: "playwright",
				}),
				expect.objectContaining({ name: "inherits root", runner: "vitest" }),
				expect.objectContaining({ name: "test_python_case", runner: "pytest" }),
			]),
		);
		const duplicateKeys = inventory.cases
			.filter((testCase) => testCase.name === "same name")
			.map((testCase) => testCase.caseKey);
		expect(duplicateKeys).toHaveLength(2);
		expect(new Set(duplicateKeys).size).toBe(2);
		expect(
			inventory.cases.some((testCase) => testCase.name === "ignored"),
		).toBe(false);
	});

	it("merges successful Vitest, Cargo, and Go discovery and persists it", async () => {
		const repoRoot = await makeRepository();
		const activeFile = await writeFixture(
			repoRoot,
			"tests/active.test.ts",
			'// AC-003\ntest("static fallback", () => {});',
		);
		await writeFixture(
			repoRoot,
			"tests/candidate.test.ts",
			"// candidate only AC-004",
		);
		await writeFixture(
			repoRoot,
			"package.json",
			JSON.stringify({
				dependencies: "not-an-object",
				devDependencies: { vitest: "1" },
			}),
		);
		await writeFixture(repoRoot, "Cargo.toml", "[package]\nname='fixture'");
		await writeFixture(repoRoot, "go.mod", "module example.test/fixture");
		const outside = await writeFixture(
			path.dirname(repoRoot),
			`${path.basename(repoRoot)}-outside/outside.test.ts`,
			"",
		);
		temporaryDirectories.push(path.dirname(outside));

		mocks.runCommandTool.mockImplementation(
			async ({ command }: { command: string }) => {
				if (command.startsWith("bunx")) {
					return commandResult(
						JSON.stringify([
							{ name: "vitest active", file: "tests/active.test.ts" },
							{ name: "absolute active", file: activeFile },
							{ name: "nonexistent", file: "tests/missing.test.ts" },
							{ name: "outside", file: outside },
							{ name: "missing file" },
							{ file: "tests/active.test.ts" },
						]),
					);
				}
				if (command.startsWith("cargo")) {
					return commandResult(
						"suite::passes: test\nnot a test\nother.test: test\n",
					);
				}
				return commandResult(
					[
						JSON.stringify({ Output: "TestZulu\nTestAlpha\n" }),
						JSON.stringify({ Output: "TestAlpha\n" }),
						JSON.stringify({}),
						"not json diagnostics",
					].join("\n"),
				);
			},
		);

		const inventory = await collectTestInventory(baseInput(repoRoot));

		expect(inventory.cases).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "vitest active",
					filePath: "tests/active.test.ts",
					declaredConditionIds: ["AC-003"],
				}),
				expect.objectContaining({ name: "absolute active", runner: "vitest" }),
				expect.objectContaining({ name: "nonexistent", runner: "vitest" }),
				expect.objectContaining({
					name: "suite::passes",
					runner: "cargo-test",
				}),
				expect.objectContaining({ name: "other.test", runner: "cargo-test" }),
				expect.objectContaining({ name: "TestAlpha", runner: "go-test" }),
				expect.objectContaining({ name: "TestZulu", runner: "go-test" }),
				expect.objectContaining({
					name: "candidate.test.ts",
					discoveryLevel: "candidate",
				}),
			]),
		);
		expect(
			inventory.cases.some((testCase) => testCase.name === "outside"),
		).toBe(false);
		expect(mocks.runCommandTool).toHaveBeenCalledTimes(3);
		expect(mocks.runCommandTool).toHaveBeenCalledWith(
			expect.objectContaining({
				repoRoot,
				cwd: "",
				blockedCommands: ["blocked"],
				externalAllowedPaths: ["/external"],
				maxCommandSeconds: 15,
				timeoutSeconds: 60,
				compressionMode: "off",
				confinementRequired: true,
			}),
		);
		expect(mocks.db.transaction).toHaveBeenCalledOnce();
		expect(mocks.insertTestInventory).toHaveBeenCalledWith(
			{ kind: "transaction" },
			inventory,
		);
	});

	it.each([
		{
			manifest: "package.json",
			manifestContents: JSON.stringify({ peerDependencies: { vitest: "1" } }),
			command: "bunx",
			result: commandResult("not json"),
			message: "Vitest active discovery returned invalid JSON.",
		},
		{
			manifest: "package.json",
			manifestContents: JSON.stringify({ dependencies: { vitest: "1" } }),
			command: "bunx",
			result: commandResult("[]", 1),
			message: "Vitest active discovery could not be completed.",
		},
		{
			manifest: "Cargo.toml",
			manifestContents: "[package]",
			command: "cargo",
			result: commandResult("", 0, false),
			message: "Cargo active discovery could not be completed.",
		},
		{
			manifest: "go.mod",
			manifestContents: "module fixture",
			command: "go test",
			result: commandResult("", 2),
			message: "Go active discovery could not be completed.",
		},
	])("turns $command discovery failures into typed retryable failures", async ({
		manifest,
		manifestContents,
		command,
		result,
		message,
	}) => {
		const repoRoot = await makeRepository();
		await writeFixture(repoRoot, manifest, manifestContents);
		mocks.runCommandTool.mockResolvedValue(result);

		await expect(
			collectTestInventory(baseInput(repoRoot), { persist: false }),
		).rejects.toMatchObject({
			code: "TEST_INVENTORY_ACTIVE_DISCOVERY_FAILED",
			message,
			retryable: true,
			recoveryAction: "fix_test_inventory_discovery",
		});
		expect(mocks.runCommandTool).toHaveBeenCalledWith(
			expect.objectContaining({ command: expect.stringContaining(command) }),
		);
	});

	it("finds Vitest from a parent package when inventory cwd is nested", async () => {
		const repoRoot = await makeRepository();
		await writeFixture(
			repoRoot,
			"package.json",
			JSON.stringify({ devDependencies: { vitest: "1" } }),
		);
		await writeFixture(
			repoRoot,
			"packages/child/child.test.ts",
			'test("child static", () => {});',
		);
		mocks.runCommandTool.mockResolvedValue(
			commandResult(
				JSON.stringify([
					{ name: "outside nested scope", file: "root.test.ts" },
					{ name: "child active", file: "packages/child/child.test.ts" },
				]),
			),
		);

		const inventory = await collectTestInventory(
			{ ...baseInput(repoRoot), cwd: "packages/child" },
			{ persist: false },
		);

		expect(inventory.cwd).toBe(path.join(repoRoot, "packages/child"));
		expect(inventory.cases).toEqual([
			expect.objectContaining({
				name: "child active",
				filePath: "child.test.ts",
			}),
		]);
		expect(mocks.runCommandTool).toHaveBeenCalledWith(
			expect.objectContaining({ cwd: "" }),
		);
	});

	it("persists directly and returns latest or null inventory rows", async () => {
		const inventory = {
			id: "inventory-id",
			taskId: "task-inventory",
			runId: undefined,
			cwd: "/repo",
			sourceSnapshot: {
				sourceStateHash: "hash",
				gitHead: null,
				fileCount: 0,
				capturedAt: "2026-08-09T00:00:00.000Z",
			},
			createdAt: "2026-08-09T00:00:00.000Z",
			cases: [],
			warnings: [],
		};
		await persistTestInventory(inventory);
		expect(mocks.insertTestInventory).toHaveBeenCalledWith(
			{ kind: "transaction" },
			inventory,
		);

		mocks.latestRows.push({ id: "latest-inventory", taskId: "task-inventory" });
		await expect(getLatestTestInventory("task-inventory")).resolves.toEqual({
			id: "latest-inventory",
			taskId: "task-inventory",
		});
		mocks.latestRows.length = 0;
		await expect(getLatestTestInventory("empty-task")).resolves.toBeNull();
		expect(mocks.db.select).toHaveBeenCalledTimes(2);
	});
});
