import type { AgentRuntimeResult } from "./types";

export function outcomeFromRuntimeResult(runtimeResult: AgentRuntimeResult): {
	status: AgentRuntimeResult["terminalState"];
	reason: string;
	summary: string;
} {
	const status = runtimeResult.terminalState;
	const reason =
		runtimeResult.stoppedBy === "policy"
			? "policy_violation"
			: runtimeResult.stoppedBy === "budget"
				? "budget_exceeded"
				: runtimeResult.stoppedBy === "tool_failure"
					? "tool_failure_limit"
					: runtimeResult.stoppedBy;
	return {
		status,
		reason,
		summary:
			runtimeResult.finalReport ||
			runtimeResult.summary ||
			`Runtime finished: ${status}`,
	};
}
