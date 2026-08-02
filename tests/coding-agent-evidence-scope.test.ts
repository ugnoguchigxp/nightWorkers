import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { repositories } from "../api/db/schema";
import {
	codingAgentTestInventoryCases,
	codingAgentTestInventoryRuns,
	verificationChecklistItems,
	verificationDocuments,
	verificationEvidenceRuns,
} from "../api/db/verification-schema";
import { runCompletionCheck } from "../api/modules/codingAgent/application/completion-check.service";
import { resolveExecutionCaseIdentities } from "../api/modules/codingAgent/verification/execution-case-identity";
import * as nightworkersRepository from "../api/modules/nightworkers/nightworkers.repository";
import {
	createVerificationDocumentFromSpec,
	recordVerificationEvidence,
} from "../api/modules/nightworkers/nightworkers.verification.service";
import { buildCommandLevelEvidence } from "../api/services/verification/normalized-evidence";

const repositoryIds: string[] = [];
const SOURCE_HASH = "a".repeat(64);

beforeAll(() => ensureNightWorkersSchema());

afterEach(async () => {
	for (const repositoryId of repositoryIds.splice(0)) {
		await db.delete(repositories).where(eq(repositories.id, repositoryId));
	}
});

describe("verification evidence scope", () => {
	it("rejects a foreign source Task and supersedes the previous active document atomically", async () => {
		const fixture = await createTaskFixture("active");
		await expect(
			createVerificationDocumentFromSpec({
				taskId: fixture.taskId,
				runId: fixture.runId,
				sourceSpecPath: "spec/foreign.md",
				document: verificationDocument(crypto.randomUUID()),
			}),
		).rejects.toMatchObject({ code: "verification_document_task_mismatch" });

		const current = await createVerificationDocumentFromSpec({
			taskId: fixture.taskId,
			runId: fixture.runId,
			sourceSpecPath: "spec/current.md",
			document: verificationDocument(fixture.taskId),
		});
		const documents = await db
			.select({
				id: verificationDocuments.id,
				status: verificationDocuments.status,
			})
			.from(verificationDocuments)
			.where(eq(verificationDocuments.taskId, fixture.taskId));
		expect(documents).toEqual(
			expect.arrayContaining([
				{ id: fixture.verificationDocumentId, status: "superseded" },
				{ id: current.id, status: "active" },
			]),
		);
		expect(
			documents.filter((document) => document.status === "active"),
		).toHaveLength(1);
	});

	it("rejects foreign Run and Verification Document references before persistence", async () => {
		const first = await createTaskFixture("active");
		const second = await createTaskFixture("active");
		const foreignDocumentEvidence = evidence(first.taskId, first.runId, "doc");

		await expect(
			recordVerificationEvidence({
				taskId: first.taskId,
				runId: first.runId,
				verificationDocumentId: second.verificationDocumentId,
				checkKind: "test",
				evidence: foreignDocumentEvidence,
			}),
		).rejects.toMatchObject({
			code: "verification_evidence_document_mismatch",
		});

		const foreignRunEvidence = evidence(first.taskId, second.runId, "run");
		await expect(
			recordVerificationEvidence({
				taskId: first.taskId,
				runId: second.runId,
				verificationDocumentId: first.verificationDocumentId,
				checkKind: "test",
				evidence: foreignRunEvidence,
			}),
		).rejects.toMatchObject({ code: "verification_evidence_run_mismatch" });

		const evidenceRows = await db
			.select()
			.from(verificationEvidenceRuns)
			.where(eq(verificationEvidenceRuns.taskId, first.taskId));
		expect(evidenceRows).toEqual([]);
		const [checklist] = await db
			.select()
			.from(verificationChecklistItems)
			.where(
				eq(
					verificationChecklistItems.verificationDocumentId,
					first.verificationDocumentId,
				),
			);
		expect(checklist?.status).toBe("pending");
	});

	it("rejects evidence for an inactive Verification Document", async () => {
		const fixture = await createTaskFixture("superseded");
		await expect(
			recordVerificationEvidence({
				taskId: fixture.taskId,
				runId: fixture.runId,
				verificationDocumentId: fixture.verificationDocumentId,
				checkKind: "test",
				evidence: evidence(fixture.taskId, fixture.runId, "inactive"),
			}),
		).rejects.toMatchObject({
			code: "verification_evidence_document_inactive",
		});
	});

	it("uses only the latest active document for completion", async () => {
		const fixture = await createTaskFixture("active");
		const supersededId = crypto.randomUUID();
		await db.insert(verificationDocuments).values({
			id: supersededId,
			taskId: fixture.taskId,
			runId: fixture.runId,
			sourceSpecPath: "spec/superseded.md",
			status: "superseded",
			documentJson: {},
			generatedAt: new Date("2026-08-02T00:00:00.000Z"),
		});

		await expect(
			runCompletionCheck({
				taskId: fixture.taskId,
				runId: fixture.runId,
			}),
		).resolves.toMatchObject({
			ok: false,
			verificationDocumentId: fixture.verificationDocumentId,
			reason: "missing_repository_context",
		});
		await expect(
			runCompletionCheck({
				taskId: fixture.taskId,
				runId: fixture.runId,
				verificationDocumentId: supersededId,
			}),
		).resolves.toMatchObject({
			ok: false,
			verificationDocumentId: null,
			reason: "missing_verification_document",
		});
	});
});

describe("execution case identity", () => {
	it("does not assign an inventory case key when the observed runner is unknown", async () => {
		const fixture = await createTaskFixture("active");
		const inventoryId = crypto.randomUUID();
		await db.insert(codingAgentTestInventoryRuns).values({
			id: inventoryId,
			taskId: fixture.taskId,
			runId: fixture.runId,
			cwd: process.cwd(),
			sourceSnapshotJson: sourceSnapshot(),
			warningsJson: [],
		});
		await db.insert(codingAgentTestInventoryCases).values({
			inventoryId,
			caseKey: "static:vitest:example",
			name: "passes safely",
			filePath: "tests/example.test.ts",
			runner: "vitest",
			discoveryLevel: "active",
			declaredConditionIdsJson: [],
		});

		const unresolved = await resolveExecutionCaseIdentities({
			taskId: fixture.taskId,
			runId: fixture.runId,
			sourceStateHash: SOURCE_HASH,
			evidenceCwd: process.cwd(),
			runner: "unknown",
			evidenceKinds: ["unit_test"],
			cases: [testCase()],
		});
		expect(unresolved[0]).not.toHaveProperty("caseKey");

		const resolved = await resolveExecutionCaseIdentities({
			taskId: fixture.taskId,
			runId: fixture.runId,
			sourceStateHash: SOURCE_HASH,
			evidenceCwd: process.cwd(),
			runner: "vitest",
			evidenceKinds: ["unit_test"],
			cases: [testCase()],
		});
		expect(resolved[0]?.caseKey).toBe("static:vitest:example");
	});
});

async function createTaskFixture(status: string) {
	const repository = await nightworkersRepository.createRepository({
		name: `TEST: evidence scope ${crypto.randomUUID()}`,
		localPath: process.cwd(),
		branch: "main",
	});
	repositoryIds.push(repository.id);
	const task = await nightworkersRepository.createTask({
		repositoryId: repository.id,
		title: "TEST: evidence scope",
	});
	const run = await nightworkersRepository.createTaskRun({
		taskId: task.id,
		repositoryId: repository.id,
	});
	if (!run) throw new Error("Failed to create fixture Run");
	const verificationDocumentId = crypto.randomUUID();
	await db.insert(verificationDocuments).values({
		id: verificationDocumentId,
		taskId: task.id,
		runId: run.id,
		sourceSpecPath: "spec/evidence-scope.md",
		status,
		documentJson: {},
		generatedAt: new Date("2026-08-01T00:00:00.000Z"),
	});
	await db.insert(verificationChecklistItems).values({
		verificationDocumentId,
		taskId: task.id,
		conditionId: "AC-001",
		text: "Passes safely",
		required: true,
		verificationKind: "automated_test",
		expectedEvidenceJson: ["unit_test"],
		status: "pending",
		evidenceIdsJson: [],
	});
	return {
		taskId: task.id,
		runId: run.id,
		verificationDocumentId,
	};
}

function evidence(taskId: string, runId: string, suffix: string) {
	return buildCommandLevelEvidence({
		taskId,
		runId,
		command: `vitest --reporter=json ${suffix}`,
		cwd: process.cwd(),
		startedAt: "2026-08-01T00:00:00.000Z",
		finishedAt: "2026-08-01T00:00:01.000Z",
		exitCode: 0,
		runner: "vitest",
		rawStdoutArtifactId: `${suffix}-stdout`,
		rawStderrArtifactId: `${suffix}-stderr`,
		evidenceKinds: ["unit_test"],
	});
}

function testCase() {
	return {
		id: "case-result",
		name: "passes safely",
		filePath: "tests/example.test.ts",
		status: "passed" as const,
		conditionIds: [],
	};
}

function sourceSnapshot() {
	return {
		sourceStateHash: SOURCE_HASH,
		gitHead: null,
		fileCount: 1,
		capturedAt: "2026-08-01T00:00:00.000Z",
	};
}

function verificationDocument(taskId: string) {
	return {
		version: 2 as const,
		specId: "evidence-scope",
		specPath: "spec/evidence-scope.md",
		generatedAt: new Date().toISOString(),
		source: {
			taskId,
			sourceMessageIds: [],
			workspaceArtifactIds: [],
		},
		conditions: [],
		commands: [],
	};
}
