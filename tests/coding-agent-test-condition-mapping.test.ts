import { describe, expect, it } from "vitest";
import { nightWorkersRecordTestConditionMappingInputSchema } from "../api/mcp/nightworkers-tool-schemas";
import { recordTestConditionMappingTool } from "../api/modules/codingAgent/verification/test-inventory-tools";
import {
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

describe("Coding Agent test condition mapping contract", () => {
	it("builds tool, write, and persisted schemas without deriving from a refined object", () => {
		expect(testConditionMappingToolInputSchema.parse(mappingInput)).toEqual(
			mappingInput,
		);
		expect(
			testConditionMappingWriteSchema.parse({
				taskId: "task-1",
				...mappingInput,
			}),
		).toEqual({ taskId: "task-1", ...mappingInput });
		expect(
			testConditionMappingSchema.parse({
				id: "mapping-1",
				taskId: "task-1",
				...mappingInput,
				createdAt: "2026-07-22T00:00:00.000Z",
			}),
		).toMatchObject({ id: "mapping-1", taskId: "task-1", ...mappingInput });
	});

	it("uses the canonical mapping input schema for the MCP contract", () => {
		expect(nightWorkersRecordTestConditionMappingInputSchema).toBe(
			testConditionMappingToolInputSchema,
		);
	});

	it("returns a non-retryable typed input failure for a missing assessment rationale", async () => {
		const result = await recordTestConditionMappingTool({
			taskId: "task-1",
			...mappingInput,
			source: "coding_agent_assessment",
		});

		expect(result).toMatchObject({
			ok: false,
			error: {
				code: "TEST_MAPPING_INPUT_INVALID",
				retryable: false,
				issues: [
					{
						path: ["rationale"],
						message: "coding_agent_assessment requires rationale",
					},
				],
			},
		});
	});

	it("parses a valid mapping before returning a typed authority failure", async () => {
		const result = await recordTestConditionMappingTool({
			taskId: "missing-task",
			...mappingInput,
		});

		expect(result).toMatchObject({
			ok: false,
			error: {
				code: "TEST_MAPPING_AUTHORITY_MISMATCH",
				retryable: false,
			},
		});
		expect(result.error?.message).not.toContain(
			".omit() cannot be used on object schemas containing refinements",
		);
	});
});
