import { z } from "zod";
import { testConditionMappingWriteSchema } from "../../../../shared/schemas/verification-checklist.schema";
import type { WorkerToolResult } from "../../../services/worker-tools/types";
import { digestTestEvidenceMappingRevision } from "./test-definition-digest";
import { recordTestConditionMappings } from "./test-evidence-mapping.service";
import { collectTestInventory } from "./test-inventory.service";
import {
	TestConditionMappingFailure,
	TestInventoryFailure,
} from "./test-inventory-errors";
import { captureWorkspaceSourceSnapshot } from "./workspace-source-snapshot";

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
		if (error instanceof TestInventoryFailure) {
			return toolFailure("collect_test_inventory", startedAt, error, {
				code: error.code,
				retryable: error.retryable,
				recoveryAction: error.recoveryAction,
			});
		}
		return toolFailure("collect_test_inventory", startedAt, error);
	}
}

export async function recordTestConditionMappingTool(
	input: Parameters<typeof recordTestConditionMappings>[0],
	dependencies: {
		recordTestConditionMappings: typeof recordTestConditionMappings;
	} = { recordTestConditionMappings },
): Promise<
	WorkerToolResult<Awaited<
		ReturnType<typeof recordTestConditionMappings>
	> | null>
> {
	const startedAt = new Date().toISOString();
	try {
		const parsed = testConditionMappingWriteSchema.parse(input);
		const mapping = await dependencies.recordTestConditionMappings(parsed);
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

export async function resolveTestConditionMappingRevision(input: {
	taskId: string;
	runId?: string;
	repoRoot: string;
	verificationDocumentId: string;
	inventoryId: string;
	mappings: Parameters<typeof digestTestEvidenceMappingRevision>[0]["mappings"];
}) {
	const currentSourceStateHash = (
		await captureWorkspaceSourceSnapshot(input.repoRoot)
	).sourceStateHash;
	return digestTestEvidenceMappingRevision({
		verificationDocumentId: input.verificationDocumentId,
		inventoryId: input.inventoryId,
		currentSourceStateHash,
		mappings: input.mappings,
	});
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
			issues: error.issues,
		});
	}
	if (error instanceof TestInventoryFailure) {
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
