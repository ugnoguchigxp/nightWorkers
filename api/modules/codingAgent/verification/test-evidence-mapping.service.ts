import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import {
	type TestConditionMapping,
	type TestConditionMappingWrite,
	workspaceSourceSnapshotSchema,
} from "../../../../shared/schemas/verification-checklist.schema";
import { db } from "../../../db/client";
import {
	codingAgentTestConditionMappings,
	codingAgentTestInventoryCases,
	codingAgentTestInventoryRuns,
	verificationChecklistItems,
	verificationDocuments,
} from "../../../db/verification-schema";
import { digestTestDefinitionInventory } from "./test-definition-digest";
import { TestConditionMappingFailure } from "./test-inventory-errors";
import {
	chunks,
	TEST_EVIDENCE_PERSISTENCE_BATCH_SIZE,
} from "./test-inventory-persistence";
import { captureWorkspaceSourceSnapshot } from "./workspace-source-snapshot";

export async function recordTestConditionMappings(
	input: TestConditionMappingWrite,
) {
	const { checklist, inventory, cases } = await loadMappingAuthority(input);
	assertKnownConditions(input, checklist);
	assertSelectedCases(input, cases);

	const inventorySnapshot = workspaceSourceSnapshotSchema.safeParse(
		inventory.sourceSnapshotJson,
	);
	if (!inventorySnapshot.success) {
		throw new TestConditionMappingFailure(
			"TEST_INVENTORY_NOT_FOUND",
			"The selected test inventory has an invalid source snapshot.",
			"collect_test_inventory",
		);
	}
	const currentSnapshot = await captureWorkspaceSourceSnapshot(input.repoRoot);
	if (
		currentSnapshot.sourceStateHash !== inventorySnapshot.data.sourceStateHash
	) {
		throw new TestConditionMappingFailure(
			"TEST_MAPPING_SOURCE_STALE",
			"Repository source changed after the selected test inventory was collected.",
			"collect_test_inventory",
		);
	}

	const sourceDigest = inventorySnapshot.data.sourceStateHash;
	const definitionDigest = digestTestDefinitionInventory(cases);
	const mappings = buildMappings({ input, sourceDigest });
	await persistMappings(mappings);
	return {
		inventoryId: inventory.id,
		sourceDigest,
		definitionDigest,
		selectionCount: input.mappings.length,
		mappingCount: mappings.length,
		selections: input.mappings.map((selection, mappingIndex) => ({
			mappingIndex,
			caseKey: selection.caseKey,
		})),
	};
}

async function loadMappingAuthority(input: TestConditionMappingWrite) {
	const [document, checklist, inventory, cases] = await Promise.all([
		db
			.select({
				id: verificationDocuments.id,
				taskId: verificationDocuments.taskId,
				status: verificationDocuments.status,
			})
			.from(verificationDocuments)
			.where(eq(verificationDocuments.id, input.verificationDocumentId))
			.then((rows) => rows[0]),
		db
			.select({ conditionId: verificationChecklistItems.conditionId })
			.from(verificationChecklistItems)
			.where(
				eq(
					verificationChecklistItems.verificationDocumentId,
					input.verificationDocumentId,
				),
			),
		db
			.select()
			.from(codingAgentTestInventoryRuns)
			.where(eq(codingAgentTestInventoryRuns.id, input.inventoryId))
			.then((rows) => rows[0]),
		db
			.select()
			.from(codingAgentTestInventoryCases)
			.where(eq(codingAgentTestInventoryCases.inventoryId, input.inventoryId)),
	]);
	if (
		!document ||
		document.taskId !== input.taskId ||
		document.status !== "active"
	) {
		throw new TestConditionMappingFailure(
			"TEST_MAPPING_AUTHORITY_MISMATCH",
			"Verification document is not the active document for the request-scoped task.",
		);
	}
	if (!inventory) {
		throw new TestConditionMappingFailure(
			"TEST_INVENTORY_NOT_FOUND",
			"The selected test inventory was not found.",
			"collect_test_inventory",
		);
	}
	if (
		inventory.taskId !== input.taskId ||
		(input.runId !== undefined && inventory.runId !== input.runId)
	) {
		throw new TestConditionMappingFailure(
			"TEST_MAPPING_AUTHORITY_MISMATCH",
			"Test inventory does not belong to the request-scoped task and run.",
		);
	}
	return { document, checklist, inventory, cases };
}

function assertKnownConditions(
	input: TestConditionMappingWrite,
	checklist: Array<{ conditionId: string }>,
) {
	const knownConditionIds = new Set(checklist.map((item) => item.conditionId));
	const issues = input.mappings.flatMap((mapping, mappingIndex) =>
		mapping.conditionIds
			.filter((conditionId) => !knownConditionIds.has(conditionId))
			.map((conditionId) => ({
				path: ["mappings", mappingIndex, "conditionIds"],
				message: `Verification condition is unavailable: ${conditionId}`,
			})),
	);
	if (!issues.length) return;
	throw new TestConditionMappingFailure(
		"TEST_MAPPING_PRECONDITION_MISSING",
		"One or more selected verification conditions are unavailable.",
		undefined,
		issues,
	);
}

function assertSelectedCases(
	input: TestConditionMappingWrite,
	cases: Array<typeof codingAgentTestInventoryCases.$inferSelect>,
) {
	const casesByKey = new Map(
		cases.map((testCase) => [testCase.caseKey, testCase]),
	);
	const missing = input.mappings.flatMap((mapping, mappingIndex) =>
		casesByKey.has(mapping.caseKey)
			? []
			: [
					{
						path: ["mappings", mappingIndex, "caseKey"],
						message: `Test case is not present in inventory ${input.inventoryId}: ${mapping.caseKey}`,
					},
				],
	);
	if (missing.length) {
		throw new TestConditionMappingFailure(
			"TEST_CASE_NOT_FOUND",
			"One or more caseKey values were not found in the selected inventory.",
			"collect_test_inventory",
			missing,
		);
	}
	const inactive = input.mappings.flatMap((mapping, mappingIndex) =>
		casesByKey.get(mapping.caseKey)?.discoveryLevel === "active"
			? []
			: [
					{
						path: ["mappings", mappingIndex, "caseKey"],
						message: `Test case is not actively discovered: ${mapping.caseKey}`,
					},
				],
	);
	if (!inactive.length) return;
	throw new TestConditionMappingFailure(
		"TEST_CASE_NOT_ACTIVE",
		"Only actively discovered test cases can be mapped.",
		"collect_test_inventory",
		inactive,
	);
}

function buildMappings(input: {
	input: TestConditionMappingWrite;
	sourceDigest: string;
}) {
	const uniqueRelations = new Map<
		string,
		{ caseKey: string; conditionId: string }
	>();
	for (const selection of input.input.mappings) {
		for (const conditionId of selection.conditionIds) {
			const key = `${selection.caseKey}\u0000${conditionId}`;
			uniqueRelations.set(key, {
				caseKey: selection.caseKey,
				conditionId,
			});
		}
	}
	return [...uniqueRelations.values()].map(
		(relation): TestConditionMapping => ({
			id: crypto.randomUUID(),
			taskId: input.input.taskId,
			verificationDocumentId: input.input.verificationDocumentId,
			inventoryId: input.input.inventoryId,
			caseKey: relation.caseKey,
			conditionId: relation.conditionId,
			source: "inventory_case_selection",
			rationale: `Inventory case ${relation.caseKey} was explicitly selected for ${relation.conditionId}.`,
			sourceDigest: input.sourceDigest,
			createdAt: new Date().toISOString(),
		}),
	);
}

async function persistMappings(mappings: TestConditionMapping[]) {
	try {
		await db.transaction(async (tx) => {
			for (const mappingChunk of chunks(
				mappings,
				TEST_EVIDENCE_PERSISTENCE_BATCH_SIZE,
			)) {
				await tx
					.insert(codingAgentTestConditionMappings)
					.values(
						mappingChunk.map((mapping) => ({
							id: mapping.id,
							taskId: mapping.taskId,
							verificationDocumentId: mapping.verificationDocumentId,
							inventoryId: mapping.inventoryId,
							caseKey: mapping.caseKey,
							conditionId: mapping.conditionId,
							source: mapping.source,
							rationale: mapping.rationale ?? null,
							sourceDigest: mapping.sourceDigest,
						})),
					)
					.onConflictDoNothing();
			}
		});
	} catch (error) {
		throw new TestConditionMappingFailure(
			"TEST_MAPPING_PERSISTENCE_FAILED",
			"Test condition mappings could not be persisted.",
			undefined,
			undefined,
			{ cause: error },
		);
	}
}
