import { describe, expect, it } from "vitest";
import { outcomeFromRuntimeResult } from "../api/modules/codingAgent/runtime/outcome";

describe("Coding Agent runtime outcome", () => {
	it("preserves a failed tool execution instead of converting it to blocked", () => {
		expect(
			outcomeFromRuntimeResult({
				terminalState: "failed",
				summary: "The workspace tool failed.",
				finalReport: "The workspace tool failed.",
				stoppedBy: "tool_failure",
				riskLevel: "medium",
			}),
		).toMatchObject({ status: "failed", reason: "tool_failure_limit" });
	});

	it("keeps a recoverable needs_human tool failure blocked", () => {
		expect(
			outcomeFromRuntimeResult({
				terminalState: "needs_human",
				summary: "Retry with different tool input.",
				finalReport: "Retry with different tool input.",
				stoppedBy: "tool_failure",
				riskLevel: "medium",
			}),
		).toMatchObject({ status: "blocked", reason: "tool_failure_limit" });
	});
});
