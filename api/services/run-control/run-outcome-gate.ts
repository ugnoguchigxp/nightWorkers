import type { OutcomeGateInput, OutcomeGateResult } from "./types";

export function decideRunOutcome(input: OutcomeGateInput): OutcomeGateResult {
	const {
		runtime,
		humanAction,
		safetyViolation,
		verificationPassed,
		budgetStopped,
	} = input;

	if (humanAction) {
		if (humanAction === "cancel") {
			return {
				status: "cancelled",
				reason: "human_review",
				summary: "Human review cancelled run.",
			};
		}
		return {
			status: "completed",
			reason: "human_review",
			summary: "Human review marked run complete.",
		};
	}

	if (safetyViolation) {
		return {
			status: "needs_human",
			reason: "policy_violation",
			summary: "Stopped by policy violation.",
		};
	}

	if (runtime.stoppedBy === "policy") {
		return {
			status: "needs_human",
			reason: "policy_violation",
			summary: runtime.summary || "Stopped by policy.",
		};
	}

	if (runtime.stoppedBy === "hook") {
		return {
			status:
				runtime.terminalState === "needs_human" ? "needs_human" : "blocked",
			reason: "hook_blocked",
			summary: runtime.summary || "Stopped by agent hook.",
		};
	}

	if (budgetStopped) {
		if (runtime.terminalState === "timed_out") {
			return {
				status: "timed_out",
				reason: "budget_exceeded",
				summary: runtime.summary,
			};
		}
		return {
			status: "blocked",
			reason: "budget_exceeded",
			summary: runtime.summary,
		};
	}

	if (runtime.stoppedBy === "tool_failure") {
		return {
			status: "blocked",
			reason: "tool_failure_limit",
			summary: runtime.summary,
		};
	}

	if (runtime.terminalState === "needs_human") {
		if (runtime.humanActionRequired !== true) {
			return {
				status: "blocked",
				reason: "supervisor_needs_human",
				summary:
					runtime.summary ||
					"Runtime requested needs_human without a structured human blocker.",
			};
		}
		return {
			status: "needs_human",
			reason: "supervisor_needs_human",
			summary: runtime.summary,
		};
	}

	if (runtime.terminalState === "failed") {
		return {
			status: "failed",
			reason: "runner_crashed",
			summary: runtime.summary,
		};
	}

	if (runtime.terminalState === "timed_out") {
		return {
			status: "timed_out",
			reason: "budget_exceeded",
			summary: runtime.summary,
		};
	}

	if (verificationPassed === false) {
		return {
			status: "blocked",
			reason: "verification_failed",
			summary: "Verification failed.",
		};
	}

	if (runtime.terminalState === "completed") {
		return {
			status: "needs_review",
			reason: "supervisor_completed",
			summary: runtime.summary || "Run completed and is waiting for review.",
		};
	}

	return {
		status: "needs_review",
		reason: "supervisor_completed",
		summary: runtime.summary,
	};
}
