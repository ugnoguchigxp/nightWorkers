import { testConditionMappingSchema } from "../../../../shared/schemas/verification-checklist.schema";
import type { WorkerToolResult } from "../../../services/worker-tools/types";
import {
	collectTestInventory,
	recordTestConditionMapping,
} from "./test-inventory.service";

export async function collectTestInventoryTool(
	input: Parameters<typeof collectTestInventory>[0],
): Promise<
	WorkerToolResult<Awaited<ReturnType<typeof collectTestInventory>> | null>
> {
	const startedAt = new Date().toISOString();
	try {
		const inventory = await collectTestInventory(input);
		return {
			ok: true,
			toolName: "collect_test_inventory",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: inventory,
		};
	} catch (error) {
		return toolFailure("collect_test_inventory", startedAt, error);
	}
}

export async function recordTestConditionMappingTool(
	input: Omit<Parameters<typeof recordTestConditionMapping>[0], "taskId"> & {
		taskId: string;
	},
): Promise<
	WorkerToolResult<Awaited<
		ReturnType<typeof recordTestConditionMapping>
	> | null>
> {
	const startedAt = new Date().toISOString();
	try {
		const parsed = testConditionMappingSchema
			.omit({ id: true, createdAt: true })
			.parse(input);
		const mapping = await recordTestConditionMapping(parsed);
		return {
			ok: true,
			toolName: "record_test_condition_mapping",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: mapping,
		};
	} catch (error) {
		return toolFailure("record_test_condition_mapping", startedAt, error);
	}
}

function toolFailure(
	toolName: string,
	startedAt: string,
	error: unknown,
): WorkerToolResult<null> {
	return {
		ok: false,
		toolName,
		startedAt,
		finishedAt: new Date().toISOString(),
		payload: null,
		error: {
			code: "TEST_EVIDENCE_FAILED",
			message: error instanceof Error ? error.message : String(error),
		},
	};
}
