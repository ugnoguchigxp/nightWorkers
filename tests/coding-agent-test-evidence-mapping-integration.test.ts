import crypto from "node:crypto";
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
import { recordTestConditionMappingTool } from "../api/modules/codingAgent/verification/test-inventory-tools";

const repositoryIds: string[] = [];

afterEach(async () => {
	for (const repositoryId of repositoryIds.splice(0)) {
		await db.delete(repositories).where(eq(repositories.id, repositoryId));
	}
});

async function createVerificationFixture(conditionIds: string[]) {
	const repositoryId = crypto.randomUUID();
	const taskId = crypto.randomUUID();
	const verificationDocumentId = crypto.randomUUID();
	repositoryIds.push(repositoryId);
	await db.insert(repositories).values({
		id: repositoryId,
		name: "test-evidence-set-fixture",
		localPath: process.cwd(),
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
	return { taskId, verificationDocumentId };
}

describe("schema test evidence mapping integration", () => {
	it("discovers once and atomically records every condition relation", async () => {
		const fixture = await createVerificationFixture(["AC-001", "AC-002"]);
		const result = await recordTestConditionMappingTool({
			...fixture,
			repoRoot: process.cwd(),
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

	it("returns missing evidence and does not persist any mapping", async () => {
		const fixture = await createVerificationFixture(["AC-001"]);
		const inventoriesBefore = await db
			.select({ id: codingAgentTestInventoryRuns.id })
			.from(codingAgentTestInventoryRuns)
			.where(eq(codingAgentTestInventoryRuns.taskId, fixture.taskId));
		const result = await recordTestConditionMappingTool({
			...fixture,
			repoRoot: process.cwd(),
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
			repoRoot: process.cwd(),
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
