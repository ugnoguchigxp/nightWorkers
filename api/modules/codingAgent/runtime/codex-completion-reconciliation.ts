import type { FinalizeGuardResult } from "../application/run-finalize-controller";
import type { AgentRuntimeEvent } from "./types";

export function buildCompletionAssurancePassedEvent(
	completion: FinalizeGuardResult,
	reconciliationCount: number,
): AgentRuntimeEvent {
	return {
		type: "verification_finished",
		message: "[Codex] Completion assurance passed.",
		payload: {
			code: "CODEX_COMPLETION_ASSURANCE_PASSED",
			provider: "codex",
			reconciliationCount,
			resolvedAfterReconciliation: reconciliationCount > 0,
			completion,
		},
	};
}

export function buildCompletionReconciliationTestResults(
	completion: FinalizeGuardResult,
	count: number,
	resolved: boolean,
) {
	return {
		completionReadiness: completion.snapshot,
		reconciliation: { count, resolved },
	};
}
