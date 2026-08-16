import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "../api/db/client";
import { repositories, tasks } from "../api/db/schema";
import {
	codingAgentTestConditionMappings,
	codingAgentTestInventoryCases,
	codingAgentTestInventoryRuns,
	verificationChecklistItems,
	verificationDocuments,
	verificationEvidenceRuns,
} from "../api/db/verification-schema";
import { runCompletionCheck } from "../api/modules/codingAgent/application/completion-check.service";
import { resolveRunCheckEvidenceScope } from "../api/modules/codingAgent/verification/run-check-evidence-scope.service";
import { collectTestInventory } from "../api/modules/codingAgent/verification/test-inventory.service";
import {
	collectTestInventoryTool,
	recordTestConditionMappingTool,
} from "../api/modules/codingAgent/verification/test-inventory-tools";
import { captureWorkspaceSourceSnapshot } from "../api/modules/codingAgent/verification/workspace-source-snapshot";
import * as nightworkersRepository from "../api/modules/nightworkers/nightworkers.repository";
import {
	createVerificationDocumentFromSpec,
	recordVerificationEvidence,
} from "../api/modules/nightworkers/nightworkers.verification.service";
import { buildCommandLevelEvidence } from "../api/services/verification/normalized-evidence";
import { runCheckTool } from "../api/services/worker-tools/run-check";

const repositoryIds: string[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
	for (const repositoryId of repositoryIds.splice(0)) {
		await db.delete(repositories).where(eq(repositories.id, repositoryId));
	}
	for (const directory of temporaryDirectories.splice(0)) {
		await fs.rm(directory, { recursive: true, force: true });
	}
});

async function createVerificationFixture(conditionIds: string[]) {
	const repoRoot = await createTestRepository();
	const repositoryId = crypto.randomUUID();
	const taskId = crypto.randomUUID();
	const verificationDocumentId = crypto.randomUUID();
	repositoryIds.push(repositoryId);
	await db.insert(repositories).values({
		id: repositoryId,
		name: "test-evidence-set-fixture",
		localPath: repoRoot,
		branch: "main",
	});
	await db.insert(tasks).values({
		id: taskId,
		repositoryId,
		title: "Resolve schema test evidence",
		status: "verifying",
	});
	await db.insert(verificationDocuments).values({
		id: verificationDocumentId,
		taskId,
		sourceSpecPath: "spec/test-evidence-set.md",
		documentJson: {},
		generatedAt: new Date(),
	});
	await db.insert(verificationChecklistItems).values(
		conditionIds.map((conditionId) => ({
			id: crypto.randomUUID(),
			verificationDocumentId,
			taskId,
			conditionId,
			text: `Verify ${conditionId}`,
			required: true,
			verificationKind: "automated_test",
			expectedEvidenceJson: ["unit_test"],
			status: "pending",
			evidenceIdsJson: [],
		})),
	);
	return { taskId, verificationDocumentId, repoRoot };
}

async function createTestRepository() {
	const repoRoot = await fs.mkdtemp(
		path.join(os.tmpdir(), "nightworkers-evidence-mapping-"),
	);
	temporaryDirectories.push(repoRoot);
	await fs.mkdir(path.join(repoRoot, "tests"), { recursive: true });
	await fs.writeFile(
		path.join(repoRoot, "package.json"),
		JSON.stringify({
			scripts: {
				test: "./node_modules/.bin/vitest run tests/coding-agent-test-evidence-matcher.test.ts",
			},
			devDependencies: { vitest: "^4.1.10" },
		}),
	);
	await fs.symlink(
		path.join(process.cwd(), "node_modules"),
		path.join(repoRoot, "node_modules"),
		process.platform === "win32" ? "junction" : "dir",
	);
	await fs.writeFile(
		path.join(repoRoot, "tests/coding-agent-test-evidence-matcher.test.ts"),
		[
			'import { expect, it } from "vitest";',
			'it("accepts a name at exactly 90% similarity", () => {',
			"  expect(true).toBe(true);",
			"});",
		].join("\n"),
	);
	return repoRoot;
}

describe("schema test evidence mapping integration", () => {
	it("pages active inventory cases and preserves a source digest for refetch", async () => {
		const { taskId, repoRoot } = await createVerificationFixture(["AC-001"]);
		await fs.appendFile(
			path.join(repoRoot, "tests/coding-agent-test-evidence-matcher.test.ts"),
			[
				"",
				'it("exposes the second inventory page", () => {',
				"  expect(true).toBe(true);",
				"});",
			].join("\n"),
		);
		const invalidScope = await collectTestInventoryTool({
			taskId,
			repoRoot,
			filePaths: ["../tests"],
		});
		expect(invalidScope).toMatchObject({
			ok: false,
			error: {
				code: "TEST_INVENTORY_FILE_SCOPE_INVALID",
				recovery: {
					disposition: "retry_with_input",
					candidates: [
						{
							toolName: "collect_test_inventory",
							actionCode: "USE_REPOSITORY_RELATIVE_TEST_SCOPE",
						},
					],
				},
			},
		});

		const first = await collectTestInventoryTool({
			taskId,
			repoRoot,
			limit: 1,
			filePaths: ["tests"],
		});
		expect(first.ok).toBe(true);
		if (!first.ok || !first.payload) return;
		expect(first.payload).toMatchObject({
			total: 2,
			cursor: "0",
			filePaths: ["tests"],
		});
		expect(first.payload.nextCursor).toEqual(expect.any(String));
		expect(first.payload.cases).toHaveLength(1);

		const changedFilter = await collectTestInventoryTool({
			taskId,
			repoRoot,
			cursor: first.payload.nextCursor ?? undefined,
			limit: 1,
			filePaths: ["src"],
		});
		expect(changedFilter).toMatchObject({
			ok: false,
			error: {
				code: "TEST_INVENTORY_CURSOR_STALE",
				recovery: { disposition: "retry_with_input" },
			},
		});

		const second = await collectTestInventoryTool({
			taskId,
			repoRoot,
			cursor: first.payload.nextCursor ?? undefined,
			limit: 1,
			filePaths: ["tests"],
		});
		expect(second.ok).toBe(true);
		if (!second.ok || !second.payload) return;
		expect(second.payload).toMatchObject({
			total: 2,
			cursor: "1",
			nextCursor: null,
			sourceDigest: first.payload.sourceDigest,
			filePaths: ["tests"],
		});
		expect(second.payload.cases[0]?.caseKey).not.toBe(
			first.payload.cases[0]?.caseKey,
		);
		const latestInventoryCases = await db
			.select({ caseKey: codingAgentTestInventoryCases.caseKey })
			.from(codingAgentTestInventoryCases)
			.where(eq(codingAgentTestInventoryCases.inventoryId, second.payload.id));
		expect(latestInventoryCases.map(({ caseKey }) => caseKey)).toEqual(
			expect.arrayContaining([
				first.payload.cases[0]?.caseKey,
				second.payload.cases[0]?.caseKey,
			]),
		);

		await fs.appendFile(
			path.join(repoRoot, "tests/coding-agent-test-evidence-matcher.test.ts"),
			"\n// source changed after the first page\n",
		);
		const changedSource = await collectTestInventoryTool({
			taskId,
			repoRoot,
			cursor: first.payload.nextCursor ?? undefined,
			limit: 1,
			filePaths: ["tests"],
		});
		expect(changedSource).toMatchObject({
			ok: false,
			error: { code: "TEST_INVENTORY_CURSOR_STALE" },
		});
	});

	it("prefers one complete inventory and resolves a nested Vitest scope from the Project package root", async () => {
		const repoRoot = await createTestRepository();
		const repository = await nightworkersRepository.createRepository({
			name: `TEST: complete inventory selection ${crypto.randomUUID()}`,
			localPath: repoRoot,
			branch: "main",
		});
		repositoryIds.push(repository.id);
		const task = await nightworkersRepository.createTask({
			repositoryId: repository.id,
			title: "TEST: complete inventory selection",
		});
		const revision =
			await nightworkersRepository.getCurrentTaskRevisionSnapshot(task.id);
		const run = await nightworkersRepository.createTaskRun({
			taskId: task.id,
			repositoryId: repository.id,
			taskRevisionSnapshotId: revision?.id,
			taskRevision: revision?.revision,
			taskDigest: revision?.digest,
		});
		const conditions = [
			...["AC-001", "AC-002"].map((conditionId) => ({
				id: conditionId,
				text: `Verify ${conditionId}`,
				category: "validation" as const,
				verificationKind: "automated_test" as const,
				expectedEvidence: ["unit_test" as const],
				expectedResult: `${conditionId} passes`,
				failureMeaning: `${conditionId} is unverified`,
				required: true,
				status: "pending" as const,
			})),
			{
				id: "AC-003",
				text: "Optional diagnostic condition",
				category: "validation" as const,
				verificationKind: "automated_test" as const,
				expectedEvidence: ["unit_test" as const],
				expectedResult: "optional diagnostic passes",
				failureMeaning: "optional diagnostic is unverified",
				required: false,
				status: "pending" as const,
			},
		];
		const document = await createVerificationDocumentFromSpec({
			taskId: task.id,
			runId: run?.id,
			sourceSpecPath: "spec/complete-inventory.md",
			document: {
				version: 2,
				specId: "complete-inventory",
				specPath: "spec/complete-inventory.md",
				generatedAt: new Date().toISOString(),
				source: {
					taskId: task.id,
					sourceMessageIds: [],
					workspaceArtifactIds: [],
				},
				testScope: "unit",
				conditions,
				commands: [],
			},
		});
		const rootInventory = await collectTestInventory(
			{ taskId: task.id, runId: run?.id, repoRoot },
			{ activeDiscovery: false },
		);
		const rootCase = rootInventory.cases.find(
			(testCase) => testCase.discoveryLevel === "active",
		);
		expect(rootCase?.runner).toBe("vitest");
		await expect(
			resolveRunCheckEvidenceScope({
				taskId: task.id,
				runId: run?.id,
				verificationDocumentId: document.id,
				repoRoot,
				command: "test",
				checkKind: "test",
				sourceStateHash: rootInventory.sourceSnapshot.sourceStateHash,
			}),
		).rejects.toMatchObject({
			code: "CONDITION_MAPPING_MISSING",
			details: {
				retryable: true,
				suggestedAction: "record_test_condition_mapping",
			},
		});
		expect(
			await recordTestConditionMappingTool({
				taskId: task.id,
				runId: run?.id,
				verificationDocumentId: document.id,
				repoRoot,
				inventoryId: rootInventory.id,
				mappings: [
					{
						caseKey: rootCase?.caseKey ?? "",
						conditionIds: ["AC-001", "AC-002"],
					},
				],
			}),
		).toMatchObject({ ok: true });

		const nestedInventory = await collectTestInventory({
			taskId: task.id,
			runId: run?.id,
			repoRoot,
			cwd: "tests",
		});
		const nestedCase = nestedInventory.cases.find(
			(testCase) => testCase.discoveryLevel === "active",
		);
		expect(nestedCase?.runner).toBe("vitest");
		expect(
			await recordTestConditionMappingTool({
				taskId: task.id,
				runId: run?.id,
				verificationDocumentId: document.id,
				repoRoot,
				inventoryId: nestedInventory.id,
				mappings: [
					{
						caseKey: nestedCase?.caseKey ?? "",
						conditionIds: ["AC-001"],
					},
				],
			}),
		).toMatchObject({ ok: true });
		const unresolvedInventory = await collectTestInventory(
			{ taskId: task.id, runId: run?.id, repoRoot },
			{ activeDiscovery: false },
		);
		const unresolvedCase = unresolvedInventory.cases.find(
			(testCase) => testCase.discoveryLevel === "active",
		);
		expect(
			await recordTestConditionMappingTool({
				taskId: task.id,
				runId: run?.id,
				verificationDocumentId: document.id,
				repoRoot,
				inventoryId: unresolvedInventory.id,
				mappings: [
					{
						caseKey: unresolvedCase?.caseKey ?? "",
						conditionIds: ["AC-001", "AC-002"],
					},
				],
			}),
		).toMatchObject({ ok: true });
		await db
			.update(codingAgentTestInventoryCases)
			.set({ runner: "unknown" })
			.where(
				eq(codingAgentTestInventoryCases.inventoryId, unresolvedInventory.id),
			);

		await expect(
			resolveRunCheckEvidenceScope({
				taskId: task.id,
				runId: run?.id,
				verificationDocumentId: document.id,
				repoRoot,
				command: "test",
				checkKind: "test",
				sourceStateHash: nestedInventory.sourceSnapshot.sourceStateHash,
			}),
		).resolves.toMatchObject({
			inventoryId: rootInventory.id,
			runner: "vitest",
			conditionIds: ["AC-001", "AC-002"],
		});
		await expect(
			runCheckTool({
				taskId: task.id,
				runId: run?.id,
				verificationDocumentId: document.id,
				repoRoot,
				command: "test",
				checkKind: "test",
			}),
		).resolves.toMatchObject({
			ok: true,
			payload: {
				status: "passed",
				resolvedCaseCount: 1,
			},
		});

		await db
			.update(codingAgentTestInventoryCases)
			.set({ runner: "unknown" })
			.where(eq(codingAgentTestInventoryCases.inventoryId, rootInventory.id));
		await expect(
			resolveRunCheckEvidenceScope({
				taskId: task.id,
				runId: run?.id,
				verificationDocumentId: document.id,
				repoRoot,
				command: "test",
				checkKind: "test",
				sourceStateHash: nestedInventory.sourceSnapshot.sourceStateHash,
			}),
		).rejects.toMatchObject({
			code: "TEST_INVENTORY_RUNNER_UNRESOLVED",
			details: {
				retryable: true,
				suggestedAction: "collect_test_inventory",
			},
		});
	});

	it("[AC-001][AC-013] records mapped current evidence without changing Run status", async () => {
		const repoRoot = await createTestRepository();
		const repository = await nightworkersRepository.createRepository({
			name: `TEST: strict acceptance evidence ${crypto.randomUUID()}`,
			localPath: repoRoot,
			branch: "main",
		});
		repositoryIds.push(repository.id);
		const task = await nightworkersRepository.createTask({
			repositoryId: repository.id,
			title: "TEST: strict acceptance evidence",
		});
		const revision =
			await nightworkersRepository.getCurrentTaskRevisionSnapshot(task.id);
		expect(revision).toBeTruthy();
		const run = await nightworkersRepository.createTaskRun({
			taskId: task.id,
			repositoryId: repository.id,
			taskRevisionSnapshotId: revision?.id,
			taskRevision: revision?.revision,
			taskDigest: revision?.digest,
		});
		const document = await createVerificationDocumentFromSpec({
			taskId: task.id,
			runId: run?.id,
			sourceSpecPath: "spec/strict-acceptance-evidence.md",
			document: {
				version: 2,
				specId: "strict-acceptance-evidence",
				specPath: "spec/strict-acceptance-evidence.md",
				generatedAt: new Date().toISOString(),
				source: {
					taskId: task.id,
					sourceMessageIds: [],
					workspaceArtifactIds: [],
				},
				conditions: [
					{
						id: "AC-001",
						text: "accepts a name at exactly 90% similarity",
						category: "validation",
						verificationKind: "automated_test",
						expectedEvidence: ["automated_test", "unit_test"],
						expectedResult: "the mapped matcher test passes",
						failureMeaning: "the condition is not verified",
						required: true,
						status: "pending",
					},
				],
				commands: [],
			},
		});
		const inventory = await collectTestInventoryTool({
			taskId: task.id,
			runId: run?.id,
			repoRoot,
		});
		expect(inventory.ok).toBe(true);
		const selectedCase = inventory.payload?.cases.find(
			(testCase) =>
				testCase.name === "accepts a name at exactly 90% similarity",
		);
		expect(selectedCase).toBeTruthy();
		const mapping = await recordTestConditionMappingTool({
			taskId: task.id,
			runId: run?.id,
			verificationDocumentId: document.id,
			repoRoot,
			inventoryId: inventory.payload?.id ?? "",
			mappings: [
				{
					caseKey: selectedCase?.caseKey ?? "",
					conditionIds: ["AC-001"],
				},
			],
		});
		expect(mapping.ok).toBe(true);
		const caseKey = mapping.payload?.selections[0]?.caseKey;
		expect(caseKey).toBeTruthy();
		const repeatedInventory = await collectTestInventoryTool({
			taskId: task.id,
			runId: run?.id,
			repoRoot,
		});
		expect(repeatedInventory).toMatchObject({ ok: true });
		expect(repeatedInventory.payload?.id).not.toBe(inventory.payload?.id);
		const testResult = await runCheckTool({
			taskId: task.id,
			runId: run?.id,
			verificationDocumentId: document.id,
			repoRoot,
			command: "test",
			checkKind: "test",
		});
		expect(testResult, JSON.stringify(testResult)).toMatchObject({
			ok: true,
			payload: {
				status: "passed",
				evidenceKinds: ["unit_test"],
				structuredCaseCount: 1,
				resolvedCaseCount: 1,
			},
		});
		expect(testResult.payload.command).toContain("--reporter=json");
		const [storedTestEvidence] = await db
			.select()
			.from(verificationEvidenceRuns)
			.where(
				eq(verificationEvidenceRuns.id, testResult.payload.evidenceRunId ?? ""),
			);
		expect(storedTestEvidence).toMatchObject({
			parsedArtifactId: expect.stringMatching(/^sha256:/),
			testExecutionObserved: true,
			evidenceKindsJson: ["unit_test"],
		});
		const sourceSnapshot = await captureWorkspaceSourceSnapshot(repoRoot);
		const verifyEvidence = buildCommandLevelEvidence({
			runId: run?.id ?? "",
			taskId: task.id,
			command: "bun run verify",
			cwd: repoRoot,
			startedAt: "2026-08-01T00:00:02.000Z",
			finishedAt: "2026-08-01T00:00:03.000Z",
			exitCode: 0,
			runner: "unknown",
			rawStdoutArtifactId: "verify-stdout",
			rawStderrArtifactId: "verify-stderr",
		});
		verifyEvidence.sourceSnapshot = sourceSnapshot;
		verifyEvidence.sourceMutatedDuringCheck = false;
		await recordVerificationEvidence({
			taskId: task.id,
			runId: run?.id,
			verificationDocumentId: document.id,
			checkKind: "verify",
			evidence: verifyEvidence,
		});

		const confirmation = await runCompletionCheck({
			taskId: task.id,
			runId: run?.id ?? "",
			verificationDocumentId: document.id,
			repoRoot,
			confirmEvidenceCheck: true,
		});
		expect(confirmation).toMatchObject({
			ok: false,
			mapping: { status: "matched" },
			confirmation: { status: "confirmed" },
			suggestedAction: "run_verify",
		});
		const confirmedAt = confirmation.confirmation.confirmedAt;
		if (!confirmedAt) throw new Error("confirmation timestamp is missing");
		const followupVerifyEvidence = buildCommandLevelEvidence({
			runId: run?.id ?? "",
			taskId: task.id,
			command: "bun run verify",
			cwd: repoRoot,
			startedAt: new Date(Date.parse(confirmedAt) + 1_000).toISOString(),
			finishedAt: new Date(Date.parse(confirmedAt) + 2_000).toISOString(),
			exitCode: 0,
			runner: "unknown",
			rawStdoutArtifactId: "followup-verify-stdout",
			rawStderrArtifactId: "followup-verify-stderr",
		});
		followupVerifyEvidence.sourceSnapshot = sourceSnapshot;
		followupVerifyEvidence.sourceMutatedDuringCheck = false;
		await recordVerificationEvidence({
			taskId: task.id,
			runId: run?.id,
			verificationDocumentId: document.id,
			checkKind: "verify",
			evidence: followupVerifyEvidence,
		});
		const completion = await runCompletionCheck({
			taskId: task.id,
			runId: run?.id ?? "",
			verificationDocumentId: document.id,
			repoRoot,
		});
		expect(completion).toMatchObject({
			ok: true,
			mapping: { status: "matched" },
			verify: { status: "passed" },
			confirmation: { status: "settled" },
			suggestedAction: "write_final_report",
		});
		expect(
			await nightworkersRepository.getTaskRun(run?.id ?? ""),
		).toMatchObject({
			status: run?.status,
		});
	}, 15_000);

	it("discovers once and atomically records every condition relation", async () => {
		const fixture = await createVerificationFixture(["AC-001", "AC-002"]);
		const inventory = await collectTestInventoryTool({
			taskId: fixture.taskId,
			repoRoot: fixture.repoRoot,
		});
		expect(inventory.ok).toBe(true);
		const selectedCase = inventory.payload?.cases.find(
			(testCase) =>
				testCase.name === "accepts a name at exactly 90% similarity",
		);
		expect(selectedCase).toBeTruthy();
		const result = await recordTestConditionMappingTool({
			...fixture,
			inventoryId: inventory.payload?.id ?? "",
			mappings: [
				{
					caseKey: selectedCase?.caseKey ?? "",
					conditionIds: ["AC-001", "AC-002"],
				},
			],
		});

		expect(result, JSON.stringify(result)).toMatchObject({
			ok: true,
			payload: {
				selectionCount: 1,
				mappingCount: 2,
				selections: [
					expect.objectContaining({
						caseKey: selectedCase?.caseKey,
					}),
				],
			},
		});
		expect(result.payload).not.toHaveProperty("mappings");
		expect(result.payload?.selections[0]).toEqual({
			mappingIndex: 0,
			caseKey: selectedCase?.caseKey,
		});
		const mappings = await db
			.select()
			.from(codingAgentTestConditionMappings)
			.where(
				eq(
					codingAgentTestConditionMappings.verificationDocumentId,
					fixture.verificationDocumentId,
				),
			);
		expect(mappings).toHaveLength(2);
		expect(
			mappings.every(
				(mapping) => mapping.source === "inventory_case_selection",
			),
		).toBe(true);
	});

	it("[AC-014] rejects an unknown caseKey without inventing a semantic mapping", async () => {
		const fixture = await createVerificationFixture(["AC-001"]);
		const inventory = await collectTestInventoryTool({
			taskId: fixture.taskId,
			repoRoot: fixture.repoRoot,
		});
		expect(inventory.ok).toBe(true);
		const inventoriesBefore = await db
			.select({ id: codingAgentTestInventoryRuns.id })
			.from(codingAgentTestInventoryRuns)
			.where(eq(codingAgentTestInventoryRuns.taskId, fixture.taskId));
		const result = await recordTestConditionMappingTool({
			...fixture,
			inventoryId: inventory.payload?.id ?? "",
			mappings: [
				{
					caseKey: "vitest:tests/missing.test.ts:not present",
					conditionIds: ["AC-001"],
				},
			],
		});

		expect(result).toMatchObject({
			ok: false,
			error: {
				code: "TEST_CASE_NOT_FOUND",
				retryable: true,
				recoveryAction: "collect_test_inventory",
				issues: [
					expect.objectContaining({
						path: ["mappings", 0, "caseKey"],
					}),
				],
			},
		});
		const mappings = await db
			.select()
			.from(codingAgentTestConditionMappings)
			.where(
				eq(
					codingAgentTestConditionMappings.verificationDocumentId,
					fixture.verificationDocumentId,
				),
			);
		expect(mappings).toEqual([]);
		const inventoriesAfter = await db
			.select({ id: codingAgentTestInventoryRuns.id })
			.from(codingAgentTestInventoryRuns)
			.where(eq(codingAgentTestInventoryRuns.taskId, fixture.taskId));
		expect(inventoriesAfter).toHaveLength(inventoriesBefore.length);
	});

	it("rejects candidate case keys from exact mapping", async () => {
		const fixture = await createVerificationFixture(["AC-001"]);
		const inventory = await collectTestInventoryTool({
			taskId: fixture.taskId,
			repoRoot: fixture.repoRoot,
		});
		expect(inventory.ok).toBe(true);
		await db.insert(codingAgentTestInventoryCases).values({
			id: crypto.randomUUID(),
			inventoryId: inventory.payload?.id ?? "",
			caseKey: "T999",
			name: "candidate only",
			filePath: "tests/candidate.test.ts",
			runner: "unknown",
			discoveryLevel: "candidate",
			declaredConditionIdsJson: [],
		});

		const result = await recordTestConditionMappingTool({
			...fixture,
			inventoryId: inventory.payload?.id ?? "",
			mappings: [{ caseKey: "T999", conditionIds: ["AC-001"] }],
		});

		expect(result).toMatchObject({
			ok: false,
			error: {
				code: "TEST_CASE_NOT_ACTIVE",
				retryable: true,
				recoveryAction: "collect_test_inventory",
			},
		});

		const legacyCaseKey =
			"static:vitest:tests/legacy.test.ts:legacy opaque key";
		await db.insert(codingAgentTestInventoryCases).values({
			id: crypto.randomUUID(),
			inventoryId: inventory.payload?.id ?? "",
			caseKey: legacyCaseKey,
			name: "legacy opaque key",
			filePath: "tests/legacy.test.ts",
			runner: "vitest",
			discoveryLevel: "active",
			declaredConditionIdsJson: [],
		});
		await expect(
			recordTestConditionMappingTool({
				...fixture,
				inventoryId: inventory.payload?.id ?? "",
				mappings: [{ caseKey: legacyCaseKey, conditionIds: ["AC-001"] }],
			}),
		).resolves.toMatchObject({ ok: true });
	});

	it("rejects mappings against a superseded Verification Document", async () => {
		const fixture = await createVerificationFixture(["AC-001"]);
		const inventory = await collectTestInventoryTool({
			taskId: fixture.taskId,
			repoRoot: fixture.repoRoot,
		});
		const selectedCase = inventory.payload?.cases.find(
			(testCase) => testCase.discoveryLevel === "active",
		);
		expect(selectedCase).toBeTruthy();
		await db
			.update(verificationDocuments)
			.set({ status: "superseded" })
			.where(eq(verificationDocuments.id, fixture.verificationDocumentId));

		const result = await recordTestConditionMappingTool({
			...fixture,
			inventoryId: inventory.payload?.id ?? "",
			mappings: [
				{
					caseKey: selectedCase?.caseKey ?? "",
					conditionIds: ["AC-001"],
				},
			],
		});

		expect(result).toMatchObject({
			ok: false,
			error: { code: "TEST_MAPPING_AUTHORITY_MISMATCH", retryable: false },
		});
	});

	it("rejects an inventory after repository source changes", async () => {
		const fixture = await createVerificationFixture(["AC-001"]);
		const inventory = await collectTestInventoryTool({
			taskId: fixture.taskId,
			repoRoot: fixture.repoRoot,
		});
		const selectedCase = inventory.payload?.cases.find(
			(testCase) =>
				testCase.name === "accepts a name at exactly 90% similarity",
		);
		expect(selectedCase).toBeTruthy();
		await fs.appendFile(
			path.join(
				fixture.repoRoot,
				"tests/coding-agent-test-evidence-matcher.test.ts",
			),
			"\n// source changed after inventory collection\n",
		);

		const result = await recordTestConditionMappingTool({
			...fixture,
			inventoryId: inventory.payload?.id ?? "",
			mappings: [
				{
					caseKey: selectedCase?.caseKey ?? "",
					conditionIds: ["AC-001"],
				},
			],
		});

		expect(result).toMatchObject({
			ok: false,
			error: {
				code: "TEST_MAPPING_SOURCE_STALE",
				retryable: true,
				recoveryAction: "collect_test_inventory",
			},
		});
	});

	it("rejects a cwd outside the registered repository boundary", async () => {
		const fixture = await createVerificationFixture(["AC-001"]);
		const result = await collectTestInventoryTool({
			taskId: fixture.taskId,
			repoRoot: fixture.repoRoot,
			cwd: "/tmp",
		});

		expect(result).toMatchObject({
			ok: false,
			error: {
				code: "TEST_INVENTORY_WORKSPACE_DENIED",
				retryable: false,
			},
		});
	});

	it("returns a typed failure when supported active discovery fails", async () => {
		const repoRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "nightworkers-evidence-discovery-failure-"),
		);
		temporaryDirectories.push(repoRoot);
		await fs.writeFile(
			path.join(repoRoot, "package.json"),
			JSON.stringify({ devDependencies: { vitest: "test" } }),
		);
		await fs.writeFile(
			path.join(repoRoot, "broken.test.ts"),
			'it("broken", () => {\n',
		);

		const result = await collectTestInventoryTool({
			taskId: crypto.randomUUID(),
			repoRoot,
		});

		expect(result).toMatchObject({
			ok: false,
			error: {
				code: "TEST_INVENTORY_ACTIVE_DISCOVERY_FAILED",
				retryable: true,
				recoveryAction: "fix_test_inventory_discovery",
			},
		});
	});
});
