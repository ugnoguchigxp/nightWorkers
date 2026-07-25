import type { TestInventory } from "../../../../shared/schemas/verification-checklist.schema";
import type { db } from "../../../db/client";
import {
	codingAgentTestInventoryCases,
	codingAgentTestInventoryRuns,
} from "../../../db/verification-schema";

type VerificationTransaction = Parameters<
	Parameters<typeof db.transaction>[0]
>[0];

// Keep every SQLite statement below the conservative 999 bind-parameter limit.
// Mapping rows currently use nine parameters, so 100 rows leave safe headroom.
export const TEST_EVIDENCE_PERSISTENCE_BATCH_SIZE = 100;

export async function insertTestInventory(
	tx: VerificationTransaction,
	inventory: TestInventory,
) {
	await tx.insert(codingAgentTestInventoryRuns).values({
		id: inventory.id,
		taskId: inventory.taskId,
		runId: inventory.runId ?? null,
		cwd: inventory.cwd,
		sourceSnapshotJson: inventory.sourceSnapshot,
		warningsJson: inventory.warnings,
	});
	for (const cases of chunks(
		inventory.cases,
		TEST_EVIDENCE_PERSISTENCE_BATCH_SIZE,
	)) {
		await tx.insert(codingAgentTestInventoryCases).values(
			cases.map((testCase) => ({
				inventoryId: inventory.id,
				caseKey: testCase.caseKey,
				name: testCase.name,
				filePath: testCase.filePath,
				runner: testCase.runner,
				discoveryLevel: testCase.discoveryLevel,
				declaredConditionIdsJson: testCase.declaredConditionIds,
			})),
		);
	}
}

export function chunks<T>(values: T[], size: number) {
	const result: T[][] = [];
	for (let index = 0; index < values.length; index += size)
		result.push(values.slice(index, index + size));
	return result;
}
