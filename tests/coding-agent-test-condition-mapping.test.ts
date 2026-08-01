import { describe, expect, it } from "vitest";
import { nightWorkersRecordTestConditionMappingInputSchema } from "../api/mcp/nightworkers-tool-schemas";
import { workerToolDefinitions } from "../api/modules/codingAgent/runtime/native-api-runner/native-api-tool-manifest";
import {
	digestTestDefinitionInventory,
	digestTestEvidenceMappingRevision,
} from "../api/modules/codingAgent/verification/test-definition-digest";
import { TestConditionMappingFailure } from "../api/modules/codingAgent/verification/test-inventory-errors";
import { recordTestConditionMappingTool } from "../api/modules/codingAgent/verification/test-inventory-tools";
import {
	testConditionMappingSchema,
	testEvidenceSetMappingJsonSchema,
	testEvidenceSetMappingToolInputSchema,
	testEvidenceSetMappingWriteSchema,
} from "../shared/schemas/verification-checklist.schema";

const sourceDigest = "a".repeat(64);
const mappingInput = {
	verificationDocumentId: "verification-1",
	inventoryId: "inventory-1",
	caseKey: "vitest:test.ts:maps a condition",
	conditionId: "AC-001",
	source: "declared_in_test" as const,
	sourceDigest,
};
const evidenceSetInput = {
	verificationDocumentId: "verification-1",
	evidenceSet: {
		version: 1 as const,
		references: [
			{
				testName: "maps a condition",
				filePath: "test.ts",
				runner: "vitest" as const,
				conditionIds: ["AC-001"],
			},
		],
	},
};

describe("Coding Agent test condition mapping contract", () => {
	it("changes the mapping revision only when test identities or evidence references change", () => {
		const cases = [
			{
				caseKey: "vitest:test.ts:maps a condition",
				name: "maps a condition",
				filePath: "test.ts",
				runner: "vitest",
				discoveryLevel: "active",
			},
		];
		const inventoryDigest = digestTestDefinitionInventory(cases);
		const revision = digestTestEvidenceMappingRevision({
			verificationDocumentId: "verification-1",
			inventoryDigest,
			evidenceSet: evidenceSetInput.evidenceSet,
		});

		expect(digestTestDefinitionInventory([...cases])).toBe(inventoryDigest);
		expect(
			digestTestEvidenceMappingRevision({
				verificationDocumentId: "verification-1",
				inventoryDigest,
				evidenceSet: evidenceSetInput.evidenceSet,
			}),
		).toBe(revision);
		expect(
			digestTestDefinitionInventory([
				{ ...cases[0], name: "renamed condition test" },
			]),
		).not.toBe(inventoryDigest);
	});

	it("keeps the persisted mapping schema and replaces the public tool input with an evidence set", () => {
		expect(
			testConditionMappingSchema.parse({
				id: "mapping-1",
				taskId: "task-1",
				...mappingInput,
				createdAt: "2026-07-22T00:00:00.000Z",
			}),
		).toMatchObject({ id: "mapping-1", taskId: "task-1", ...mappingInput });
		expect(
			testEvidenceSetMappingToolInputSchema.parse(evidenceSetInput),
		).toEqual(evidenceSetInput);
		expect(
			testEvidenceSetMappingWriteSchema.parse({
				taskId: "task-1",
				runId: "run-1",
				repoRoot: "/tmp/repo",
				...evidenceSetInput,
			}),
		).toMatchObject({ taskId: "task-1", ...evidenceSetInput });
		expect(nightWorkersRecordTestConditionMappingInputSchema).toBe(
			testEvidenceSetMappingToolInputSchema,
		);
		expect(
			workerToolDefinitions.find(
				(tool) => tool.name === "record_test_condition_mapping",
			)?.definition.inputSchema,
		).toBe(testEvidenceSetMappingJsonSchema);
	});

	it("does not accept the removed one-mapping public contract", () => {
		expect(
			nightWorkersRecordTestConditionMappingInputSchema.safeParse(mappingInput)
				.success,
		).toBe(false);
	});

	it("returns a non-retryable typed input failure for an invalid evidence set", async () => {
		const result = await recordTestConditionMappingTool({
			taskId: "task-1",
			runId: "run-1",
			repoRoot: "/tmp/repo",
			verificationDocumentId: "verification-1",
			evidenceSet: {
				version: 1,
				references: [
					{
						testName: "maps a condition",
						conditionIds: ["AC-001", "AC-001"],
					},
				],
			},
		});

		expect(result).toMatchObject({
			ok: false,
			error: {
				code: "TEST_MAPPING_INPUT_INVALID",
				retryable: false,
				issues: [
					{
						path: ["evidenceSet", "references", 0, "conditionIds"],
						message: "conditionIds must be unique",
					},
				],
			},
		});
	});

	it("returns missing schema evidence as a typed error", async () => {
		const result = await recordTestConditionMappingTool(
			{
				taskId: "task-1",
				runId: "run-1",
				repoRoot: "/tmp/repo",
				...evidenceSetInput,
			},
			{
				recordTestEvidenceSetMappings: async () => {
					throw new TestConditionMappingFailure(
						"TEST_EVIDENCE_NOT_FOUND",
						"Schema evidence was not found.",
						"review_test_evidence_set",
						[
							{
								path: ["evidenceSet", "references", 0],
								message: "Best candidate similarity was 89%.",
							},
						],
					);
				},
			},
		);

		expect(result).toMatchObject({
			ok: false,
			error: {
				code: "TEST_EVIDENCE_NOT_FOUND",
				retryable: false,
				recoveryAction: "review_test_evidence_set",
				issues: [
					{
						path: ["evidenceSet", "references", 0],
						message: "Best candidate similarity was 89%.",
					},
				],
			},
		});
	});
});
