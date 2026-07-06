import { describe, expect, it } from "vitest";
import { evaluateTodoCompletionGate } from "../api/services/todo-runtime";

describe("Todo completion coverage gate evidence", () => {
	it("fails Todo completion when coverage autonomy did not pass", () => {
		const result = evaluateTodoCompletionGate({
			todo: {
				id: "todo-1",
				seq: 1,
				title: "Verify coverage",
				taskType: "verification",
				status: "running",
				procedureId: "quality_gate_verify",
			},
			outcomeStatus: "needs_human",
			runtimeResult: {
				terminalState: "completed",
				summary: "done",
				finalReport: "done",
				stoppedBy: "decision",
				riskLevel: "medium",
				testResults: {
					coverageAutonomy: {
						status: "needs_human",
						message: "Coverage gate failed.",
					},
				},
			},
		});

		expect(result.passed).toBe(false);
		expect(result.checks).toContainEqual({
			id: "coverage_autonomy",
			passed: false,
			evidence: "status=needs_human",
		});
		expect(result.evidence.coverageAutonomy).toMatchObject({
			status: "needs_human",
		});
	});
});
