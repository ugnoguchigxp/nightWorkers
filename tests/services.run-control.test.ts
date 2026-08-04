import { describe, expect, it } from "vitest";
import { decideRunOutcome } from "../api/services/run-control/run-outcome-gate";

describe("RunControl", () => {
	describe("RunOutcomeGate", () => {
		it("keeps needs_human and never upgrades to completed automatically", () => {
			const outcome = decideRunOutcome({
				runtime: {
					finalReport: "Need help",
					terminalState: "needs_human",
					summary: "manual step required",
					stoppedBy: "decision",
					riskLevel: "high",
					humanActionRequired: true,
				},
			});
			expect(outcome.status).toBe("needs_human");
		});

		it("does not accept needs_human without a structured human blocker", () => {
			const outcome = decideRunOutcome({
				runtime: {
					finalReport: "Need help",
					terminalState: "needs_human",
					summary: "tool input can be changed",
					stoppedBy: "decision",
					riskLevel: "medium",
				},
			});
			expect(outcome.status).toBe("blocked");
		});

		it("maps tool and verification failures to blocked", () => {
			const runtime = {
				finalReport: "Tool failed",
				terminalState: "needs_human" as const,
				summary: "recoverable tool failure",
				stoppedBy: "tool_failure" as const,
				riskLevel: "medium" as const,
			};
			expect(decideRunOutcome({ runtime }).status).toBe("blocked");
			expect(
				decideRunOutcome({
					runtime: {
						...runtime,
						terminalState: "completed",
						stoppedBy: "decision",
					},
					verificationPassed: false,
				}).status,
			).toBe("blocked");
		});

		it("maps completed supervisor result to needs_review by default", () => {
			const outcome = decideRunOutcome({
				runtime: {
					finalReport: "Done",
					terminalState: "completed",
					summary: "completed",
					stoppedBy: "decision",
					riskLevel: "low",
				},
			});
			expect(outcome.status).toBe("needs_review");
		});

		it("accepts explicit human complete action", () => {
			const outcome = decideRunOutcome({
				runtime: {
					finalReport: "Done",
					terminalState: "needs_review",
					summary: "waiting for review",
					stoppedBy: "decision",
					riskLevel: "low",
				},
				humanAction: "complete",
			});
			expect(outcome.status).toBe("completed");
		});

		it("maps policy-stopped supervisor result to policy violation", () => {
			const outcome = decideRunOutcome({
				runtime: {
					finalReport: "Blocked",
					terminalState: "needs_human",
					summary: "Stopped by policy block",
					stoppedBy: "policy",
					riskLevel: "high",
				},
			});
			expect(outcome.status).toBe("needs_human");
			expect(outcome.reason).toBe("policy_violation");
		});

		it("maps hook-stopped supervisor result to hook_blocked", () => {
			const outcome = decideRunOutcome({
				runtime: {
					finalReport: "Blocked",
					terminalState: "blocked",
					summary: "Stopped by agent hook",
					stoppedBy: "hook",
					riskLevel: "medium",
				},
			});
			expect(outcome.status).toBe("blocked");
			expect(outcome.reason).toBe("hook_blocked");
		});

		it("maps budget-stopped supervisor result to budget_exceeded", () => {
			const outcome = decideRunOutcome({
				runtime: {
					finalReport: "Stopped by budget",
					terminalState: "needs_human",
					summary: "Repeated schema fallback",
					stoppedBy: "budget",
					riskLevel: "high",
				},
				budgetStopped: true,
			});
			expect(outcome.status).toBe("blocked");
			expect(outcome.reason).toBe("budget_exceeded");
		});
	});
});
