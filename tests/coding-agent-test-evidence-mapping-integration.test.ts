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
	codingAgentTestInventoryRuns,
	verificationChecklistItems,
	verificationDocuments,
} from "../api/db/verification-schema";
import { runCompletionCheck } from "../api/modules/codingAgent/application/completion-check.service";
import { recordTestConditionMappingTool } from "../api/modules/codingAgent/verification/test-inventory-tools";
import { captureWorkspaceSourceSnapshot } from "../api/modules/codingAgent/verification/workspace-source-snapshot";
import * as nightworkersRepository from "../api/modules/nightworkers/nightworkers.repository";
import {
	createVerificationDocumentFromSpec,
	recordVerificationEvidence,
} from "../api/modules/nightworkers/nightworkers.verification.service";
import { buildCommandLevelEvidence } from "../api/services/verification/normalized-evidence";

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
		JSON.stringify({ devDependencies: { vitest: "test" } }),
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
						expectedEvidence: ["unit_test"],
						expectedResult: "the mapped matcher test passes",
						failureMeaning: "the condition is not verified",
						required: true,
						status: "pending",
					},
				],
				commands: [],
			},
		});
		const mapping = await recordTestConditionMappingTool({
			taskId: task.id,
			runId: run?.id,
			verificationDocumentId: document.id,
			repoRoot,
			evidenceSet: {
				version: 1,
				references: [
					{
						testName: "accepts a name at exactly 90% similarity",
						filePath: "tests/coding-agent-test-evidence-matcher.test.ts",
						runner: "vitest",
						conditionIds: ["AC-001"],
					},
				],
			},
		});
		expect(mapping.ok).toBe(true);
		const caseKey = mapping.payload?.matches[0]?.caseKey;
		expect(caseKey).toBeTruthy();
		const sourceSnapshot = await captureWorkspaceSourceSnapshot(repoRoot);
		const testEvidence = buildCommandLevelEvidence({
			runId: run?.id ?? "",
			taskId: task.id,
			command: "vitest --reporter=json",
			cwd: repoRoot,
			startedAt: "2026-08-01T00:00:00.000Z",
			finishedAt: "2026-08-01T00:00:01.000Z",
			exitCode: 0,
			runner: "vitest",
			rawStdoutArtifactId: "test-stdout",
			rawStderrArtifactId: "test-stderr",
			evidenceKinds: ["unit_test"],
			cases: [
				{
					id: "case-result-1",
					caseKey,
					name: "accepts a name at exactly 90% similarity",
					filePath: "tests/coding-agent-test-evidence-matcher.test.ts",
					runner: "vitest",
					evidenceKind: "unit_test",
					status: "passed",
					conditionIds: [],
				},
			],
		});
		testEvidence.sourceSnapshot = sourceSnapshot;
		testEvidence.testExecutionObserved = true;
		testEvidence.sourceMutatedDuringCheck = false;
		await recordVerificationEvidence({
			taskId: task.id,
			runId: run?.id,
			verificationDocumentId: document.id,
			checkKind: "test",
			evidence: testEvidence,
		});
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
		const followupVerifyEvidence = buildCommandLevelEvidence({
			runId: run?.id ?? "",
			taskId: task.id,
			command: "bun run verify",
			cwd: repoRoot,
			startedAt: "2026-08-01T00:00:04.000Z",
			finishedAt: "2026-08-01T00:00:05.000Z",
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
		const result = await recordTestConditionMappingTool({
			...fixture,
			evidenceSet: {
				version: 1,
				references: [
					{
						testName: "accepts a name at exactly 90% similarity",
						filePath: "tests/coding-agent-test-evidence-matcher.test.ts",
						runner: "vitest",
						conditionIds: ["AC-001", "AC-002"],
					},
				],
			},
		});

		expect(result, JSON.stringify(result)).toMatchObject({
			ok: true,
			payload: {
				matchThreshold: 0.9,
				referenceCount: 1,
				mappingCount: 2,
				matches: [
					expect.objectContaining({
						caseKey: expect.stringMatching(/^static:vitest:/),
						score: 1,
					}),
				],
			},
		});
		expect(result.payload).not.toHaveProperty("mappings");
		expect(result.payload?.matches[0]).toEqual({
			referenceIndex: 0,
			caseKey: expect.stringMatching(/^static:vitest:/),
			score: 1,
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
			mappings.every((mapping) => mapping.source === "schema_evidence_set"),
		).toBe(true);
	});

	it("[AC-014] returns missing evidence and does not invent a semantic mapping", async () => {
		const fixture = await createVerificationFixture(["AC-001"]);
		const inventoriesBefore = await db
			.select({ id: codingAgentTestInventoryRuns.id })
			.from(codingAgentTestInventoryRuns)
			.where(eq(codingAgentTestInventoryRuns.taskId, fixture.taskId));
		const result = await recordTestConditionMappingTool({
			...fixture,
			evidenceSet: {
				version: 1,
				references: [
					{
						testName: "a test that does not exist anywhere",
						runner: "vitest",
						conditionIds: ["AC-001"],
					},
				],
			},
		});

		expect(result).toMatchObject({
			ok: false,
			error: {
				code: "TEST_EVIDENCE_NOT_FOUND",
				retryable: false,
				issues: [
					expect.objectContaining({
						path: ["evidenceSet", "references", 0],
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

	it("rejects a cwd outside the registered repository boundary", async () => {
		const fixture = await createVerificationFixture(["AC-001"]);
		const result = await recordTestConditionMappingTool({
			...fixture,
			cwd: "/tmp",
			evidenceSet: {
				version: 1,
				references: [
					{
						testName: "creates a todo",
						conditionIds: ["AC-001"],
					},
				],
			},
		});

		expect(result).toMatchObject({
			ok: false,
			error: {
				code: "TEST_INVENTORY_WORKSPACE_DENIED",
				retryable: false,
			},
		});
	});
});
