import { z } from "zod";
import { testConditionMappingWriteSchema } from "../../../../shared/schemas/verification-checklist.schema";
import type { WorkerToolResult } from "../../../services/worker-tools/types";
import {
	collectTestInventory,
	recordTestConditionMapping,
} from "./test-inventory.service";
import { TestConditionMappingFailure } from "./test-inventory-errors";

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
		const parsed = testConditionMappingWriteSchema.parse(input);
		const mapping = await recordTestConditionMapping(parsed);
		return {
			ok: true,
			toolName: "record_test_condition_mapping",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: mapping,
		};
	} catch (error) {
		return mappingToolFailure(startedAt, error);
	}
}

function mappingToolFailure(
	startedAt: string,
	error: unknown,
): WorkerToolResult<null> {
	if (error instanceof z.ZodError) {
		return toolFailure("record_test_condition_mapping", startedAt, error, {
			code: "TEST_MAPPING_INPUT_INVALID",
			retryable: false,
			issues: error.issues.map((issue) => ({
				path: issue.path.map((part) =>
					typeof part === "number" ? part : String(part),
				),
				message: issue.message,
			})),
		});
	}
	if (error instanceof TestConditionMappingFailure) {
		return toolFailure("record_test_condition_mapping", startedAt, error, {
			code: error.code,
			retryable: error.retryable,
			recoveryAction: error.recoveryAction,
		});
	}
	return toolFailure("record_test_condition_mapping", startedAt, error, {
		code: "TEST_MAPPING_INTERNAL_CONTRACT",
		retryable: false,
	});
}

function toolFailure(
	toolName: string,
	startedAt: string,
	error: unknown,
	details: Omit<NonNullable<WorkerToolResult<null>["error"]>, "message"> = {
		code: "TEST_INVENTORY_FAILED",
		retryable: false,
	},
): WorkerToolResult<null> {
	return {
		ok: false,
		toolName,
		startedAt,
		finishedAt: new Date().toISOString(),
		payload: null,
		error: {
			...details,
			message: error instanceof Error ? error.message : String(error),
		},
	};
}
