import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import {
	type TestConditionMapping,
	type TestConditionMappingWrite,
	type TestInventory,
	type TestInventoryCase,
	workspaceSourceSnapshotSchema,
} from "../../../../shared/schemas/verification-checklist.schema";
import { db } from "../../../db/client";
import {
	codingAgentTestConditionMappings,
	codingAgentTestInventoryCases,
	codingAgentTestInventoryRuns,
	verificationChecklistItems,
	verificationDocuments,
} from "../../../db/verification-schema";
import { runCommandTool } from "../../../services/worker-tools/run-command";
import { TestConditionMappingFailure } from "./test-inventory-errors";
import {
	captureWorkspaceSourceSnapshot,
	listWorkspaceSourceFiles,
} from "./workspace-source-snapshot";

const TEST_FILE_NAME = /(?:^|[._-])(?:test|spec)(?:[._-]|$)/i;
const TEST_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".rs",
	".go",
	".java",
	".kt",
	".py",
]);

export async function collectTestInventory(input: {
	taskId: string;
	runId?: string;
	repoRoot: string;
	cwd?: string;
	blockedCommands?: string[];
	allowedPaths?: string[];
	externalAllowedPaths?: string[];
	deniedPaths?: string[];
	maxCommandSeconds?: number;
}): Promise<TestInventory> {
	const cwd = path.resolve(input.repoRoot, input.cwd || "");
	const snapshot = await captureWorkspaceSourceSnapshot(input.repoRoot);
	const candidates = await discoverCandidateCases(cwd);
	const discoveries = await Promise.all([
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
	await db.transaction(async (tx) => {
		await tx.insert(codingAgentTestInventoryRuns).values({
			id: inventory.id,
			taskId: inventory.taskId,
			runId: inventory.runId ?? null,
			cwd: inventory.cwd,
			sourceSnapshotJson: inventory.sourceSnapshot,
			warningsJson: inventory.warnings,
		});
		if (inventory.cases.length) {
			await tx.insert(codingAgentTestInventoryCases).values(
				inventory.cases.map((testCase) => ({
					inventoryId: inventory.id,
					caseKey: testCase.caseKey,
					name: testCase.name,
					filePath: testCase.filePath,
					runner: testCase.runner,
					discoveryLevel: testCase.discoveryLevel,
					declaredConditionIdsJson: testCase.declaredConditionIds,
				})),
			);
		}
	});
	return inventory;
}

export async function recordTestConditionMapping(
	input: TestConditionMappingWrite,
): Promise<TestConditionMapping> {
	const [document, inventory, testCase, checklistItem] = await Promise.all([
		db
			.select({
				id: verificationDocuments.id,
				taskId: verificationDocuments.taskId,
			})
			.from(verificationDocuments)
			.where(eq(verificationDocuments.id, input.verificationDocumentId))
			.then((rows) => rows[0]),
		db
			.select({
				id: codingAgentTestInventoryRuns.id,
				taskId: codingAgentTestInventoryRuns.taskId,
				sourceSnapshotJson: codingAgentTestInventoryRuns.sourceSnapshotJson,
			})
			.from(codingAgentTestInventoryRuns)
			.where(eq(codingAgentTestInventoryRuns.id, input.inventoryId))
			.then((rows) => rows[0]),
		db
			.select({
				caseKey: codingAgentTestInventoryCases.caseKey,
				declaredConditionIdsJson:
					codingAgentTestInventoryCases.declaredConditionIdsJson,
			})
			.from(codingAgentTestInventoryCases)
			.where(
				and(
					eq(codingAgentTestInventoryCases.inventoryId, input.inventoryId),
					eq(codingAgentTestInventoryCases.caseKey, input.caseKey),
				),
			)
			.then((rows) => rows[0]),
		db
			.select({ conditionId: verificationChecklistItems.conditionId })
			.from(verificationChecklistItems)
			.where(
				and(
					eq(
						verificationChecklistItems.verificationDocumentId,
						input.verificationDocumentId,
					),
					eq(verificationChecklistItems.conditionId, input.conditionId),
				),
			)
			.then((rows) => rows[0]),
	]);
	if (!document || document.taskId !== input.taskId) {
		throw new TestConditionMappingFailure(
			"TEST_MAPPING_AUTHORITY_MISMATCH",
			"Verification document does not belong to the request-scoped task.",
		);
	}
	if (
		!inventory ||
		inventory.taskId !== input.taskId ||
		!testCase ||
		!checklistItem
	) {
		throw new TestConditionMappingFailure(
			"TEST_MAPPING_PRECONDITION_MISSING",
			"Test inventory, case, or verification condition is unavailable.",
			"collect_test_inventory",
		);
	}
	const snapshot = workspaceSourceSnapshotSchema.safeParse(
		inventory.sourceSnapshotJson,
	);
	if (
		!snapshot.success ||
		input.sourceDigest !== snapshot.data.sourceStateHash
	) {
		throw new TestConditionMappingFailure(
			"TEST_MAPPING_SOURCE_STALE",
			"Test condition mapping source digest does not match the inventory snapshot.",
			"collect_test_inventory",
		);
	}
	if (
		input.source === "declared_in_test" &&
		!testCase.declaredConditionIdsJson.includes(input.conditionId)
	) {
		throw new TestConditionMappingFailure(
			"TEST_MAPPING_DECLARATION_MISMATCH",
			"Declared test marker does not match the requested condition.",
		);
	}
	const mapping: TestConditionMapping = {
		id: crypto.randomUUID(),
		...input,
		createdAt: new Date().toISOString(),
	};
	try {
		await db
			.insert(codingAgentTestConditionMappings)
			.values({
				id: mapping.id,
				taskId: mapping.taskId,
				verificationDocumentId: mapping.verificationDocumentId,
				inventoryId: mapping.inventoryId,
				caseKey: mapping.caseKey,
				conditionId: mapping.conditionId,
				source: mapping.source,
				rationale: mapping.rationale ?? null,
				sourceDigest: mapping.sourceDigest,
			})
			.onConflictDoUpdate({
				target: [
					codingAgentTestConditionMappings.verificationDocumentId,
					codingAgentTestConditionMappings.inventoryId,
					codingAgentTestConditionMappings.caseKey,
					codingAgentTestConditionMappings.conditionId,
				],
				set: {
					source: mapping.source,
					rationale: mapping.rationale ?? null,
					sourceDigest: mapping.sourceDigest,
					updatedAt: new Date(),
				},
			});
	} catch (error) {
		throw new TestConditionMappingFailure(
			"TEST_MAPPING_PERSISTENCE_FAILED",
			"Test condition mapping could not be persisted.",
			undefined,
			{ cause: error },
		);
	}
	return mapping;
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
	const files = await listWorkspaceSourceFiles(cwd);
	const result: TestInventoryCase[] = [];
	for (const file of files.sort()) {
		if (
			!TEST_EXTENSIONS.has(path.extname(file)) ||
			!TEST_FILE_NAME.test(path.basename(file))
		)
			continue;
		const source = await fs.readFile(file, "utf8").catch(() => "");
		const declaredConditionIds = Array.from(
			source.matchAll(/\bAC-\d{3}\b/g),
			(match) => match[0],
		);
		const filePath = path.relative(cwd, file).split(path.sep).join("/");
		result.push({
			caseKey: `candidate:${filePath}`,
			name: path.basename(file),
			filePath,
			runner: inferRunner(filePath),
			discoveryLevel: "candidate",
			declaredConditionIds: [...new Set(declaredConditionIds)].sort(),
		});
	}
	return result;
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
	const activeFiles = new Set(active.map((item) => item.filePath));
	return [
		...active,
		...candidates.filter((item) => !activeFiles.has(item.filePath)),
	];
}

function inferRunner(filePath: string): TestInventoryCase["runner"] {
	const extension = path.extname(filePath);
	if (extension === ".rs") return "cargo-test";
	if (extension === ".go") return "go-test";
	if (extension === ".java" || extension === ".kt") return "junit";
	if (extension === ".py") return "pytest";
	return "unknown";
}
