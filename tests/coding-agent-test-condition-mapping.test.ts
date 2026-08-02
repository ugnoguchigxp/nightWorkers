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
	testConditionMappingJsonSchema,
	testConditionMappingSchema,
	testConditionMappingToolInputSchema,
	testConditionMappingWriteSchema,
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
const selectionInput = {
	verificationDocumentId: "verification-1",
	inventoryId: "inventory-1",
	mappings: [
		{
			caseKey: "vitest:test.ts:maps a condition",
			conditionIds: ["AC-001"],
		},
	],
};

describe("Coding Agent test condition mapping contract", () => {
	it("changes the mapping revision only when source or exact selections change", () => {
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
			inventoryId: "inventory-1",
			currentSourceStateHash: "a".repeat(64),
			mappings: selectionInput.mappings,
		});

		expect(digestTestDefinitionInventory([...cases])).toBe(inventoryDigest);
		expect(
			digestTestEvidenceMappingRevision({
				verificationDocumentId: "verification-1",
				inventoryId: "inventory-1",
				currentSourceStateHash: "a".repeat(64),
				mappings: selectionInput.mappings,
			}),
		).toBe(revision);
		expect(
			digestTestEvidenceMappingRevision({
				verificationDocumentId: "verification-1",
				inventoryId: "inventory-1",
				currentSourceStateHash: "b".repeat(64),
				mappings: selectionInput.mappings,
			}),
		).not.toBe(revision);
		expect(
			digestTestDefinitionInventory([
				{ ...cases[0], name: "renamed condition test" },
			]),
		).not.toBe(inventoryDigest);
	});

	it("keeps the persisted schema and accepts exact inventory case selections", () => {
		expect(
			testConditionMappingSchema.parse({
				id: "mapping-1",
				taskId: "task-1",
				...mappingInput,
				createdAt: "2026-07-22T00:00:00.000Z",
			}),
		).toMatchObject({ id: "mapping-1", taskId: "task-1", ...mappingInput });
		expect(testConditionMappingToolInputSchema.parse(selectionInput)).toEqual(
			selectionInput,
		);
		expect(
			testConditionMappingWriteSchema.parse({
				taskId: "task-1",
				runId: "run-1",
				repoRoot: "/tmp/repo",
				...selectionInput,
			}),
		).toMatchObject({ taskId: "task-1", ...selectionInput });
		expect(nightWorkersRecordTestConditionMappingInputSchema).toBe(
			testConditionMappingToolInputSchema,
		);
		expect(
			workerToolDefinitions.find(
				(tool) => tool.name === "record_test_condition_mapping",
			)?.definition.inputSchema,
		).toBe(testConditionMappingJsonSchema);
	});

	it("does not accept the removed one-mapping public contract", () => {
		expect(
			nightWorkersRecordTestConditionMappingInputSchema.safeParse(mappingInput)
				.success,
		).toBe(false);
	});

	it("returns a non-retryable typed input failure for duplicate conditions", async () => {
		const result = await recordTestConditionMappingTool({
			taskId: "task-1",
			runId: "run-1",
			repoRoot: "/tmp/repo",
			verificationDocumentId: "verification-1",
			inventoryId: "inventory-1",
			mappings: [
				{
					caseKey: "vitest:test.ts:maps a condition",
					conditionIds: ["AC-001", "AC-001"],
				},
			],
		});

		expect(result).toMatchObject({
			ok: false,
			error: {
				code: "TEST_MAPPING_INPUT_INVALID",
				retryable: false,
				issues: [
					{
						path: ["mappings", 0, "conditionIds"],
						message: "conditionIds must be unique",
					},
				],
			},
		});
	});

	it("returns a missing exact caseKey as a typed error", async () => {
		const result = await recordTestConditionMappingTool(
			{
				taskId: "task-1",
				runId: "run-1",
				repoRoot: "/tmp/repo",
				...selectionInput,
			},
			{
				recordTestConditionMappings: async () => {
					throw new TestConditionMappingFailure(
						"TEST_CASE_NOT_FOUND",
						"Inventory case was not found.",
						"collect_test_inventory",
						[
							{
								path: ["mappings", 0, "caseKey"],
								message: "caseKey is absent from this inventory.",
							},
						],
					);
				},
			},
		);

		expect(result).toMatchObject({
			ok: false,
			error: {
				code: "TEST_CASE_NOT_FOUND",
				retryable: true,
				recoveryAction: "collect_test_inventory",
				issues: [
					{
						path: ["mappings", 0, "caseKey"],
						message: "caseKey is absent from this inventory.",
					},
				],
			},
		});
	});

	it("marks only repository-repairable mapping preconditions as retryable", () => {
		for (const code of [
			"TEST_MAPPING_PRECONDITION_MISSING",
			"TEST_MAPPING_SOURCE_STALE",
			"TEST_INVENTORY_NOT_FOUND",
			"TEST_CASE_NOT_FOUND",
			"TEST_CASE_NOT_ACTIVE",
		] as const) {
			expect(new TestConditionMappingFailure(code, code).retryable).toBe(true);
		}
		for (const code of [
			"TEST_MAPPING_AUTHORITY_MISMATCH",
			"TEST_MAPPING_PERSISTENCE_FAILED",
			"TEST_EVIDENCE_NOT_FOUND",
			"TEST_EVIDENCE_AMBIGUOUS",
		] as const) {
			expect(new TestConditionMappingFailure(code, code).retryable).toBe(false);
		}
	});
});
