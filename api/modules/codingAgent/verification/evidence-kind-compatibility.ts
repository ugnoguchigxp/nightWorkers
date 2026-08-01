import type { ExpectedEvidence } from "../../../../shared/schemas/verification-checklist.schema";

export function isCompatibleEvidenceKind(
	expected: ExpectedEvidence,
	actual: ExpectedEvidence,
) {
	if (expected === "automated_test") {
		return (
			actual === "automated_test" ||
			actual === "unit_test" ||
			actual === "integration_test" ||
			actual === "e2e_test"
		);
	}
	return expected === actual;
}

export function isAutomatedEvidenceKind(
	value: ExpectedEvidence,
): value is "automated_test" | "unit_test" | "integration_test" | "e2e_test" {
	return (
		value === "automated_test" ||
		value === "unit_test" ||
		value === "integration_test" ||
		value === "e2e_test"
	);
}
