import crypto from "node:crypto";
import type { TestInventoryCaseSelection } from "../../../../shared/schemas/verification-checklist.schema";

export function digestTestDefinitionInventory(
	cases: Array<{
		caseKey: string;
		name: string;
		filePath: string;
		runner: string;
		discoveryLevel: string;
	}>,
) {
	return digest(
		cases
			.map((testCase) => ({
				caseKey: testCase.caseKey,
				name: testCase.name,
				filePath: testCase.filePath,
				runner: testCase.runner,
				discoveryLevel: testCase.discoveryLevel,
			}))
			.sort((left, right) =>
				JSON.stringify(left).localeCompare(JSON.stringify(right)),
			),
	);
}

export function digestTestEvidenceMappingRevision(input: {
	verificationDocumentId: string;
	inventoryId: string;
	currentSourceStateHash: string;
	mappings: TestInventoryCaseSelection[];
}) {
	return digest({
		verificationDocumentId: input.verificationDocumentId,
		inventoryId: input.inventoryId,
		currentSourceStateHash: input.currentSourceStateHash,
		mappings: input.mappings
			.map((mapping) => ({
				caseKey: mapping.caseKey,
				conditionIds: [...mapping.conditionIds].sort(),
			}))
			.sort((left, right) =>
				JSON.stringify(left).localeCompare(JSON.stringify(right)),
			),
	});
}

function digest(value: unknown) {
	return crypto
		.createHash("sha256")
		.update(JSON.stringify(value))
		.digest("hex");
}
