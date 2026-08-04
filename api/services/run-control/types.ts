export type RunOutcomeStatus =
	| "needs_review"
	| "completed"
	| "needs_human"
	| "failed"
	| "blocked"
	| "timed_out"
	| "cancelled";

export type RunOutcomeReason =
	| "supervisor_completed"
	| "supervisor_needs_human"
	| "budget_exceeded"
	| "tool_failure_limit"
	| "policy_violation"
	| "hook_blocked"
	| "verification_failed"
	| "runner_crashed"
	| "human_review";

export type RuntimeExecutionResult = {
	finalReport: string;
	terminalState:
		| "completed"
		| "needs_review"
		| "needs_human"
		| "failed"
		| "timed_out"
		| "blocked"
		| "cancelled";
	summary: string;
	stoppedBy:
		| "decision"
		| "budget"
		| "tool_failure"
		| "llm_error"
		| "missing_tool_call"
		| "policy"
		| "hook"
		| "cancelled";
	riskLevel: "low" | "medium" | "high";
	humanActionRequired?: boolean;
};

export type OutcomeGateInput = {
	runtime: RuntimeExecutionResult;
	hasDiff?: boolean;
	verificationPassed?: boolean;
	safetyViolation?: boolean;
	budgetStopped?: boolean;
	humanAction?: "complete" | "cancel";
};

export type OutcomeGateResult = {
	status: RunOutcomeStatus;
	reason: RunOutcomeReason;
	summary: string;
};
