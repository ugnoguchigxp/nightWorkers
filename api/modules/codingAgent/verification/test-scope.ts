import type { CompletionVerificationScope } from "../../../../shared/schemas/verification-checklist.schema";

export type EvidenceTestScope =
	| CompletionVerificationScope
	| "unspecified"
	| undefined;

export function isTestRunnerInScope(
	runner: string,
	testScope: EvidenceTestScope,
) {
	if (testScope === "none") return false;
	const isE2e = runner === "playwright";
	if (testScope === "unit") return !isE2e;
	if (testScope === "e2e_if_ui") return isE2e;
	return true;
}
