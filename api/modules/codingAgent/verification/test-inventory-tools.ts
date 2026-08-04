import crypto from "node:crypto";
import path from "node:path";
import { z } from "zod";
import type {
	TestInventory,
	TestInventoryCase,
} from "../../../../shared/schemas/verification-checklist.schema";
import { testConditionMappingWriteSchema } from "../../../../shared/schemas/verification-checklist.schema";
import type {
	WorkerToolRecovery,
	WorkerToolResult,
} from "../../../services/worker-tools/types";
import { digestTestEvidenceMappingRevision } from "./test-definition-digest";
import { recordTestConditionMappings } from "./test-evidence-mapping.service";
import type { CollectTestInventoryInput } from "./test-inventory.service";
import {
	collectTestInventory,
	persistTestInventory,
} from "./test-inventory.service";
import {
	TestConditionMappingFailure,
	TestInventoryFailure,
} from "./test-inventory-errors";
import { captureWorkspaceSourceSnapshot } from "./workspace-source-snapshot";

export type CollectTestInventoryToolInput = CollectTestInventoryInput & {
	cursor?: string;
	limit?: number;
	filePaths?: string[];
};

export async function collectTestInventoryTool(
	input: CollectTestInventoryToolInput,
): Promise<WorkerToolResult<TestInventoryPage | null>> {
	const startedAt = new Date().toISOString();
	try {
		const normalizedInput = {
			...input,
			filePaths: normalizeInventoryFilePaths(input.filePaths),
		};
		const inventory = await collectTestInventory(normalizedInput, {
			persist: false,
		});
		const page = paginateActiveTestInventory(inventory, normalizedInput);
		await persistTestInventory(inventory);
		return {
			ok: true,
			toolName: "collect_test_inventory",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: page,
		};
	} catch (error) {
		if (error instanceof TestInventoryFailure) {
			return toolFailure("collect_test_inventory", startedAt, error, {
				code: error.code,
				retryable: error.retryable,
				recoveryAction: error.recoveryAction,
				recovery: error.recovery,
			});
		}
		return toolFailure("collect_test_inventory", startedAt, error);
	}
}

export type TestInventoryPage = Omit<TestInventory, "cases"> & {
	cases: TestInventoryCase[];
	total: number;
	cursor: string;
	nextCursor: string | null;
	sourceDigest: string;
	filePaths: string[];
};

export function paginateActiveTestInventory(
	inventory: TestInventory,
	input: Pick<CollectTestInventoryToolInput, "cursor" | "limit" | "filePaths">,
): TestInventoryPage {
	const limit = Math.min(Math.max(input.limit ?? 40, 1), 100);
	const filePaths = normalizeInventoryFilePaths(input.filePaths);
	const sourceDigest = inventory.sourceSnapshot.sourceStateHash;
	const filterDigest = digestInventoryFilePaths(filePaths);
	const cursor = readInventoryCursor(input.cursor, {
		sourceDigest,
		filterDigest,
	});
	const activeCases = inventory.cases.filter(
		(testCase) =>
			testCase.discoveryLevel === "active" &&
			(filePaths.length === 0 ||
				filePaths.some((filePath) =>
					matchesInventoryFilePath(testCase.filePath, filePath),
				)),
	);
	if (cursor > activeCases.length) {
		throw invalidInventoryCursor(
			"Test inventory cursor points beyond the filtered inventory.",
		);
	}
	const cases = activeCases.slice(cursor, cursor + limit);
	const nextOffset = cursor + cases.length;
	return {
		...inventory,
		cases,
		total: activeCases.length,
		cursor: String(cursor),
		nextCursor:
			nextOffset < activeCases.length
				? createInventoryCursor({
						offset: nextOffset,
						sourceDigest,
						filterDigest,
					})
				: null,
		sourceDigest,
		filePaths,
	};
}

function normalizeInventoryFilePath(filePath: string) {
	const raw = filePath.trim();
	const withForwardSlashes = raw.replaceAll("\\", "/");
	const normalized = path.posix.normalize(withForwardSlashes);
	if (
		!raw ||
		path.posix.isAbsolute(withForwardSlashes) ||
		path.win32.isAbsolute(raw) ||
		normalized === "." ||
		normalized === ".." ||
		normalized.startsWith("../")
	) {
		throw new TestInventoryFailure(
			"TEST_INVENTORY_FILE_SCOPE_INVALID",
			"Test inventory filePaths must be repository-relative paths.",
			"choose_repository_relative_test_scope",
			{
				recovery: inventoryRetryWithInput("USE_REPOSITORY_RELATIVE_TEST_SCOPE"),
			},
		);
	}
	return normalized.replace(/^\.\//, "");
}

function normalizeInventoryFilePaths(filePaths: string[] | undefined) {
	return Array.from(
		new Set((filePaths ?? []).map(normalizeInventoryFilePath)),
	).sort();
}

function matchesInventoryFilePath(candidate: string, filter: string) {
	const normalizedCandidate = normalizeInventoryFilePath(candidate);
	return (
		normalizedCandidate === filter ||
		normalizedCandidate.startsWith(`${filter}/`)
	);
}

type InventoryCursor = {
	version: 1;
	offset: number;
	sourceDigest: string;
	filterDigest: string;
};

function createInventoryCursor(input: Omit<InventoryCursor, "version">) {
	return Buffer.from(
		JSON.stringify({ version: 1, ...input } satisfies InventoryCursor),
		"utf8",
	).toString("base64url");
}

function readInventoryCursor(
	cursor: string | undefined,
	expected: Pick<InventoryCursor, "sourceDigest" | "filterDigest">,
) {
	if (!cursor) return 0;
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
	} catch {
		throw invalidInventoryCursor("Test inventory cursor is malformed.");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw invalidInventoryCursor("Test inventory cursor is malformed.");
	}
	const value = parsed as Record<string, unknown>;
	if (
		value.version !== 1 ||
		!Number.isInteger(value.offset) ||
		Number(value.offset) < 0 ||
		typeof value.sourceDigest !== "string" ||
		typeof value.filterDigest !== "string"
	) {
		throw invalidInventoryCursor("Test inventory cursor is malformed.");
	}
	if (
		value.sourceDigest !== expected.sourceDigest ||
		value.filterDigest !== expected.filterDigest
	) {
		throw new TestInventoryFailure(
			"TEST_INVENTORY_CURSOR_STALE",
			"Test inventory source or filePaths changed after the preceding page.",
			"restart_test_inventory_paging",
			{
				recovery: inventoryRetryWithInput("RESTART_INVENTORY_PAGING"),
			},
		);
	}
	return Number(value.offset);
}

function digestInventoryFilePaths(filePaths: string[]) {
	return crypto
		.createHash("sha256")
		.update(JSON.stringify(filePaths))
		.digest("hex");
}

function invalidInventoryCursor(message: string) {
	return new TestInventoryFailure(
		"TEST_INVENTORY_CURSOR_INVALID",
		message,
		"restart_test_inventory_paging",
		{
			recovery: inventoryRetryWithInput("RESTART_INVENTORY_PAGING"),
		},
	);
}

function inventoryRetryWithInput(actionCode: string): WorkerToolRecovery {
	return {
		disposition: "retry_with_input",
		candidates: [{ toolName: "collect_test_inventory", actionCode }],
	};
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
			recovery: error.recovery,
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
