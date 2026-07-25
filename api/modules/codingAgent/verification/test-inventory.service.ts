import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import type {
	TestInventory,
	TestInventoryCase,
} from "../../../../shared/schemas/verification-checklist.schema";
import { db } from "../../../db/client";
import { codingAgentTestInventoryRuns } from "../../../db/verification-schema";
import { runCommandTool } from "../../../services/worker-tools/run-command";
import { enforcePathPolicy } from "../../../services/worker-tools/tool-policy-enforcer";
import { extractStaticTestNames } from "./static-test-case-discovery";
import { classifyTestFile } from "./test-file-discovery";
import { TestInventoryFailure } from "./test-inventory-errors";
import { insertTestInventory } from "./test-inventory-persistence";
import { captureWorkspaceSourceSnapshot } from "./workspace-source-snapshot";

export type CollectTestInventoryInput = {
	taskId: string;
	runId?: string;
	repoRoot: string;
	cwd?: string;
	blockedCommands?: string[];
	allowedPaths?: string[];
	externalAllowedPaths?: string[];
	deniedPaths?: string[];
	maxCommandSeconds?: number;
};

export async function collectTestInventory(
	input: CollectTestInventoryInput,
	options: {
		activeDiscovery?: boolean;
		persist?: boolean;
	} = {},
): Promise<TestInventory> {
	const cwd = await resolveInventoryCwd(input);
	const snapshot = await captureWorkspaceSourceSnapshot(input.repoRoot);
	const candidates = await discoverCandidateCases(cwd);
	const discoveries =
		options.activeDiscovery === false
			? []
			: await Promise.all([
					discoverVitestCases(input, cwd),
					discoverCargoCases(input, cwd),
					discoverGoCases(input, cwd),
				]);
	const cases = mergeCases(
		candidates,
		discoveries.flatMap((discovery) => discovery.cases),
	);
	const warnings = discoveries.flatMap((discovery) =>
		discovery.warning ? [discovery.warning] : [],
	);
	const now = new Date().toISOString();
	const inventory: TestInventory = {
		id: crypto.randomUUID(),
		taskId: input.taskId,
		runId: input.runId,
		cwd,
		sourceSnapshot: snapshot,
		createdAt: now,
		cases,
		warnings,
	};
	if (options.persist !== false) await persistTestInventory(inventory);
	return inventory;
}

async function persistTestInventory(inventory: TestInventory) {
	await db.transaction(async (tx) => {
		await insertTestInventory(tx, inventory);
	});
}

export async function getLatestTestInventory(taskId: string) {
	const [inventory] = await db
		.select()
		.from(codingAgentTestInventoryRuns)
		.where(eq(codingAgentTestInventoryRuns.taskId, taskId))
		.orderBy(desc(codingAgentTestInventoryRuns.createdAt))
		.limit(1);
	return inventory ?? null;
}

async function discoverCandidateCases(
	cwd: string,
): Promise<TestInventoryCase[]> {
	const files = await listPotentialTestFiles(cwd);
	const result: TestInventoryCase[] = [];
	const javascriptRunnerCache = new Map<
		string,
		TestInventoryCase["runner"] | null
	>();
	for (const file of files.sort()) {
		const filePath = path.relative(cwd, file).split(path.sep).join("/");
		const classification = classifyTestFile(filePath);
		if (!classification) continue;
		const source = await fs.readFile(file, "utf8").catch((error: unknown) => {
			throw new TestInventoryFailure(
				"TEST_INVENTORY_FILE_READ_FAILED",
				`Test source file could not be read: ${filePath}`,
				"review_repository_permissions",
				{ cause: error },
			);
		});
		const declaredConditionIds = Array.from(
			source.matchAll(/\bAC-\d{3}\b/g),
			(match) => match[0],
		);
		const runner =
			classification.technology === "javascript-typescript"
				? inferJavaScriptRunner(
						filePath,
						await detectJavaScriptRunnerForFile(
							file,
							cwd,
							javascriptRunnerCache,
						),
					)
				: classification.runner;
		const staticNames = extractStaticTestNames({ source, classification });
		if (staticNames.length) {
			const nameTotals = countNames(staticNames);
			const nameOccurrences = new Map<string, number>();
			result.push(
				...staticNames.map((name) => {
					const occurrence = (nameOccurrences.get(name) ?? 0) + 1;
					nameOccurrences.set(name, occurrence);
					const suffix =
						(nameTotals.get(name) ?? 0) > 1 ? `:#${occurrence}` : "";
					return {
						caseKey: `static:${runner}:${filePath}:${name}${suffix}`,
						name,
						filePath,
						runner,
						discoveryLevel: "active" as const,
						declaredConditionIds: [...new Set(declaredConditionIds)].sort(),
					};
				}),
			);
		} else if (classification.testFileByConvention) {
			result.push({
				caseKey: `candidate:${filePath}`,
				name: path.basename(file),
				filePath,
				runner,
				discoveryLevel: "candidate",
				declaredConditionIds: [...new Set(declaredConditionIds)].sort(),
			});
		}
	}
	return result;
}

async function resolveInventoryCwd(input: CollectTestInventoryInput) {
	const repoRoot = path.resolve(input.repoRoot);
	const cwd = path.resolve(repoRoot, input.cwd || "");
	const decision = enforcePathPolicy(cwd, {
		repoRoot,
		allowedPaths: input.allowedPaths,
		deniedPaths: input.deniedPaths,
	});
	if (!decision.allowed) {
		throw new TestInventoryFailure(
			"TEST_INVENTORY_WORKSPACE_DENIED",
			decision.message ||
				"Test inventory working directory is outside the registered repository boundary.",
			"choose_repository_relative_cwd",
		);
	}
	const stat = await fs.stat(cwd).catch((error: unknown) => {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			throw new TestInventoryFailure(
				"TEST_INVENTORY_CWD_NOT_FOUND",
				"Test inventory working directory does not exist.",
				"choose_existing_repository_cwd",
				{ cause: error },
			);
		}
		throw error;
	});
	if (!stat.isDirectory()) {
		throw new TestInventoryFailure(
			"TEST_INVENTORY_CWD_NOT_DIRECTORY",
			"Test inventory working directory must be a directory.",
			"choose_repository_directory",
		);
	}
	return cwd;
}

async function listPotentialTestFiles(root: string) {
	const files: string[] = [];
	async function visit(directory: string) {
		const entries = await fs.readdir(directory, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isDirectory() && IGNORED_DISCOVERY_DIRECTORIES.has(entry.name))
				continue;
			const filePath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				await visit(filePath);
			} else if (
				entry.isFile() &&
				classifyTestFile(path.relative(root, filePath))
			) {
				files.push(filePath);
			}
		}
	}
	await visit(root);
	return files.sort();
}

const IGNORED_DISCOVERY_DIRECTORIES = new Set([
	".git",
	".bundle",
	".gradle",
	".mypy_cache",
	".next",
	".pytest_cache",
	".ruff_cache",
	".turbo",
	".venv",
	"__pycache__",
	"bin",
	"build",
	"coverage",
	"dist",
	"node_modules",
	"obj",
	"Pods",
	"target",
	"vendor",
	"venv",
]);

function countNames(names: string[]) {
	const counts = new Map<string, number>();
	for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
	return counts;
}

async function discoverVitestCases(
	input: Parameters<typeof collectTestInventory>[0],
	cwd: string,
): Promise<{ cases: TestInventoryCase[]; warning?: string }> {
	if (!(await hasPackage(cwd, "vitest"))) return { cases: [] };
	const result = await runCommandTool({
		command: "bunx --no-install vitest list --json --static-parse",
		repoRoot: input.repoRoot,
		cwd: path.relative(input.repoRoot, cwd),
		blockedCommands: input.blockedCommands,
		allowedPaths: input.allowedPaths,
		externalAllowedPaths: input.externalAllowedPaths,
		deniedPaths: input.deniedPaths,
		maxCommandSeconds: input.maxCommandSeconds,
		timeoutSeconds: 60,
		compressionMode: "off",
	});
	if (!result.ok || result.payload.exitCode !== 0) {
		return {
			cases: [],
			warning: "Vitest active discovery could not be completed.",
		};
	}
	try {
		const entries = JSON.parse(result.payload.stdout) as Array<{
			name?: string;
			file?: string;
		}>;
		return {
			cases: entries
				.filter((entry) => entry.name && entry.file)
				.map((entry) => {
					const absoluteFile = path.resolve(String(entry.file));
					const filePath = path
						.relative(cwd, absoluteFile)
						.split(path.sep)
						.join("/");
					return {
						caseKey: `vitest:${filePath}:${entry.name}`,
						name: String(entry.name),
						filePath,
						runner: "vitest" as const,
						discoveryLevel: "active" as const,
						declaredConditionIds: [],
					};
				}),
		};
	} catch {
		return {
			cases: [],
			warning: "Vitest active discovery returned invalid JSON.",
		};
	}
}

async function discoverCargoCases(
	input: Parameters<typeof collectTestInventory>[0],
	cwd: string,
): Promise<{ cases: TestInventoryCase[]; warning?: string }> {
	if (!(await exists(path.join(cwd, "Cargo.toml")))) return { cases: [] };
	const result = await runCommandTool({
		command: "cargo test -- --list",
		repoRoot: input.repoRoot,
		cwd: path.relative(input.repoRoot, cwd),
		blockedCommands: input.blockedCommands,
		allowedPaths: input.allowedPaths,
		externalAllowedPaths: input.externalAllowedPaths,
		deniedPaths: input.deniedPaths,
		maxCommandSeconds: input.maxCommandSeconds,
		timeoutSeconds: 60,
		compressionMode: "off",
	});
	if (!result.ok || result.payload.exitCode !== 0)
		return {
			cases: [],
			warning: "Cargo active discovery could not be completed.",
		};
	const names = Array.from(
		result.payload.stdout.matchAll(/^([\w:.-]+):\s+test$/gm),
		(match) => match[1],
	).filter((name): name is string => Boolean(name));
	return {
		cases: names.map((name) => ({
			caseKey: `cargo:${name}`,
			name,
			filePath: "Cargo.toml",
			runner: "cargo-test",
			discoveryLevel: "active",
			declaredConditionIds: [],
		})),
	};
}

async function discoverGoCases(
	input: Parameters<typeof collectTestInventory>[0],
	cwd: string,
): Promise<{ cases: TestInventoryCase[]; warning?: string }> {
	if (!(await exists(path.join(cwd, "go.mod")))) return { cases: [] };
	const result = await runCommandTool({
		command: "go test -json -list . ./...",
		repoRoot: input.repoRoot,
		cwd: path.relative(input.repoRoot, cwd),
		blockedCommands: input.blockedCommands,
		allowedPaths: input.allowedPaths,
		externalAllowedPaths: input.externalAllowedPaths,
		deniedPaths: input.deniedPaths,
		maxCommandSeconds: input.maxCommandSeconds,
		timeoutSeconds: 60,
		compressionMode: "off",
	});
	if (!result.ok || result.payload.exitCode !== 0)
		return {
			cases: [],
			warning: "Go active discovery could not be completed.",
		};
	const names = new Set<string>();
	for (const line of result.payload.stdout.split("\n")) {
		try {
			const entry = JSON.parse(line) as { Output?: string };
			for (const match of (entry.Output || "").matchAll(/^Test[\w]+$/gm))
				names.add(match[0]);
		} catch {
			/* Go may write non-JSON diagnostics; they are not inventory cases. */
		}
	}
	return {
		cases: [...names].sort().map((name) => ({
			caseKey: `go:${name}`,
			name,
			filePath: "go.mod",
			runner: "go-test",
			discoveryLevel: "active",
			declaredConditionIds: [],
		})),
	};
}

async function hasPackage(cwd: string, dependency: string) {
	try {
		const pkg = JSON.parse(
			await fs.readFile(path.join(cwd, "package.json"), "utf8"),
		) as Record<string, unknown>;
		const sections = ["dependencies", "devDependencies", "peerDependencies"];
		return sections.some((section) => {
			const dependencies = pkg[section];
			return Boolean(
				dependencies &&
					typeof dependencies === "object" &&
					dependency in dependencies,
			);
		});
	} catch {
		return false;
	}
}

async function exists(filePath: string) {
	return fs
		.access(filePath)
		.then(() => true)
		.catch(() => false);
}

function mergeCases(
	candidates: TestInventoryCase[],
	active: TestInventoryCase[],
) {
	const candidatesByFile = new Map(
		candidates.map((candidate) => [candidate.filePath, candidate]),
	);
	const mergedActive = active.map((item) => ({
		...item,
		declaredConditionIds: Array.from(
			new Set([
				...item.declaredConditionIds,
				...(candidatesByFile.get(item.filePath)?.declaredConditionIds ?? []),
			]),
		).sort(),
	}));
	const activeFiles = new Set(mergedActive.map((item) => item.filePath));
	return [
		...mergedActive,
		...candidates.filter((item) => !activeFiles.has(item.filePath)),
	];
}

async function detectJavaScriptRunnerForFile(
	file: string,
	root: string,
	cache: Map<string, TestInventoryCase["runner"] | null>,
) {
	let directory = path.dirname(file);
	while (true) {
		const detected = cache.has(directory)
			? (cache.get(directory) ?? null)
			: await detectJavaScriptRunnerInPackage(directory);
		cache.set(directory, detected);
		if (detected !== null) return detected;
		if (directory === root) break;
		const parent = path.dirname(directory);
		if (
			parent === directory ||
			path.relative(root, parent).startsWith(`..${path.sep}`)
		)
			break;
		directory = parent;
	}
	return "unknown";
}

async function detectJavaScriptRunnerInPackage(
	directory: string,
): Promise<TestInventoryCase["runner"] | null> {
	try {
		const pkg = JSON.parse(
			await fs.readFile(path.join(directory, "package.json"), "utf8"),
		) as Record<string, unknown>;
		const dependencies = ["dependencies", "devDependencies", "peerDependencies"]
			.flatMap((section) => {
				const value = pkg[section];
				return value && typeof value === "object" ? Object.keys(value) : [];
			})
			.filter(
				(dependency) =>
					dependency === "vitest" ||
					dependency === "jest" ||
					dependency === "@playwright/test",
			);
		if (dependencies.includes("vitest")) return "vitest";
		if (dependencies.includes("jest")) return "jest";
		if (dependencies.includes("@playwright/test")) return "playwright";
		return null;
	} catch {
		return null;
	}
}

function inferJavaScriptRunner(
	filePath: string,
	defaultRunner: TestInventoryCase["runner"],
): TestInventoryCase["runner"] {
	const normalized = filePath.toLocaleLowerCase("en-US");
	if (
		normalized.startsWith("e2e/") ||
		normalized.includes("/e2e/") ||
		normalized.includes(".e2e.") ||
		normalized.includes("playwright")
	) {
		return "playwright";
	}
	return defaultRunner;
}
