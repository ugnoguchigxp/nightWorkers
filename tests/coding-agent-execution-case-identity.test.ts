import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "../api/db/client";
import { repositories } from "../api/db/schema";
import {
	codingAgentTestInventoryCases,
	codingAgentTestInventoryRuns,
} from "../api/db/verification-schema";
import { resolveExecutionCaseIdentityDetails } from "../api/modules/codingAgent/verification/execution-case-identity";
import * as nightworkersRepository from "../api/modules/nightworkers/nightworkers.repository";

const repositoryIds: string[] = [];

afterEach(async () => {
	for (const repositoryId of repositoryIds.splice(0)) {
		await db.delete(repositories).where(eq(repositories.id, repositoryId));
	}
});

describe("execution testcase identity", () => {
	it("fails duplicate identities closed, requires a file, and keeps legacy suffix reads", async () => {
		const repository = await nightworkersRepository.createRepository({
			name: `TEST: execution identity ${crypto.randomUUID()}`,
			localPath: process.cwd(),
			branch: "main",
		});
		repositoryIds.push(repository.id);
		const task = await nightworkersRepository.createTask({
			repositoryId: repository.id,
			title: "TEST: execution identity",
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
		const sourceStateHash = "a".repeat(64);
		const inventoryId = crypto.randomUUID();
		await db.insert(codingAgentTestInventoryRuns).values({
			id: inventoryId,
			taskId: task.id,
			runId: run?.id,
			cwd: process.cwd(),
			sourceSnapshotJson: {
				sourceStateHash,
				gitHead: null,
				fileCount: 3,
				capturedAt: "2026-08-02T00:00:00.000Z",
			},
			warningsJson: [],
		});
		await db
			.insert(codingAgentTestInventoryCases)
			.values([
				inventoryCase(
					inventoryId,
					"T1",
					"Suite > duplicate",
					"tests/dup.test.ts",
				),
				inventoryCase(
					inventoryId,
					"T2",
					"Suite duplicate",
					"tests/dup.test.ts",
				),
				inventoryCase(
					inventoryId,
					"T3",
					"requires a file",
					"tests/file.test.ts",
				),
				inventoryCase(
					inventoryId,
					"static:vitest:tests/legacy.test.ts:legacy case",
					"legacy case",
					"tests/legacy.test.ts",
				),
				inventoryCase(inventoryId, "T4", "shared name", "tests/exact.test.ts"),
				inventoryCase(
					inventoryId,
					"T5",
					"case-sensitive path",
					"tests/Foo.test.ts",
				),
				inventoryCase(
					inventoryId,
					"static:junit:tests/legacy-junit.test.ts:legacy junit",
					"legacy junit",
					"tests/legacy-junit.test.ts",
					"junit",
				),
			]);

		const result = await resolveExecutionCaseIdentityDetails({
			taskId: task.id,
			runId: run?.id ?? "",
			sourceStateHash,
			evidenceCwd: process.cwd(),
			runner: "vitest",
			evidenceKinds: ["unit_test"],
			caseScopes: {
				T1: { conditionIds: ["AC-001"], evidenceKind: "unit_test" },
				T2: { conditionIds: ["AC-002"], evidenceKind: "unit_test" },
				T3: { conditionIds: ["AC-003"], evidenceKind: "unit_test" },
				T4: { conditionIds: ["AC-004"], evidenceKind: "unit_test" },
				T5: { conditionIds: ["AC-005"], evidenceKind: "unit_test" },
				"static:junit:tests/legacy-junit.test.ts:legacy junit": {
					conditionIds: ["AC-006"],
					evidenceKind: "unit_test",
				},
			},
			cases: [
				evidenceCase("Suite duplicate", "tests/dup.test.ts"),
				evidenceCase("requires a file"),
				evidenceCase("Parent legacy case", "tests/legacy.test.ts"),
				evidenceCase("shared name", "tests/exact.test.ts"),
				evidenceCase("shared name", "tests/unrelated.test.ts"),
				evidenceCase("case-sensitive path", "tests/foo.test.ts"),
				evidenceCase("Parent legacy junit", "tests/legacy-junit.test.ts"),
			],
		});

		expect(result.ambiguousMappedCaseKeys).toEqual(["T1", "T2"]);
		expect(result.mismatchedMappedCaseKeys).toEqual(["T3", "T5"]);
		expect(result.cases[0]).toMatchObject({
			conditionIds: ["AC-001", "AC-002"],
			failureMessage: "TEST_IDENTITY_AMBIGUOUS",
		});
		expect(result.cases[0]).not.toHaveProperty("caseKey");
		expect(result.cases[1]).not.toHaveProperty("caseKey");
		expect(result.cases[2]).toMatchObject({
			caseKey: "static:vitest:tests/legacy.test.ts:legacy case",
		});
		expect(result.cases[3]).toMatchObject({ caseKey: "T4" });
		expect(result.cases[4]).not.toHaveProperty("caseKey");
		expect(result.cases[4]).toMatchObject({ conditionIds: [] });
		expect(result.cases[4]).not.toHaveProperty("failureMessage");
		expect(result.cases[5]).not.toHaveProperty("caseKey");
		expect(result.cases[6]).toMatchObject({
			caseKey: "static:junit:tests/legacy-junit.test.ts:legacy junit",
			runner: "vitest",
		});
	});
});

function inventoryCase(
	inventoryId: string,
	caseKey: string,
	name: string,
	filePath: string,
	runner: "vitest" | "junit" = "vitest",
) {
	return {
		id: crypto.randomUUID(),
		inventoryId,
		caseKey,
		name,
		filePath,
		runner,
		discoveryLevel: "active",
		declaredConditionIdsJson: [],
	};
}

function evidenceCase(name: string, filePath?: string) {
	return {
		id: crypto.randomUUID(),
		name,
		...(filePath ? { filePath } : {}),
		runner: "vitest" as const,
		status: "passed" as const,
		conditionIds: [],
	};
}
