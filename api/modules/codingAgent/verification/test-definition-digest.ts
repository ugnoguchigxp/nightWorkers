import crypto from "node:crypto";
import type { TestEvidenceSet } from "../../../../shared/schemas/verification-checklist.schema";

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
	inventoryDigest: string;
	evidenceSet: TestEvidenceSet;
}) {
	return digest({
		verificationDocumentId: input.verificationDocumentId,
		inventoryDigest: input.inventoryDigest,
		evidenceSet: input.evidenceSet,
	});
}

function digest(value: unknown) {
	return crypto
		.createHash("sha256")
		.update(JSON.stringify(value))
		.digest("hex");
}
