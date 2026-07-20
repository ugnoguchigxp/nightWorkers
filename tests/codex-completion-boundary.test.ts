import { describe, expect, it, vi } from "vitest";
import { reconcileCodexCompletionBoundary } from "../api/modules/codingAgent/application/codex-completion-boundary.service";

const completedResult = {
	terminalState: "completed" as const,
	summary: "done",
	finalReport: "実装完了",
	stoppedBy: "decision" as const,
	riskLevel: "medium" as const,
};

function input() {
	return {
		result: completedResult,
		taskId: "task-1",
		runId: "run-1",
		repositoryRoot: "/repo",
		sink: { emit: vi.fn(async () => {}) },
	};
}

describe("Codex completion boundary", () => {
	it("requires review when any structured verification command fails", async () => {
		const result = await reconcileCodexCompletionBoundary(input(), {
			executeVerificationCloseout: async () => ({
				applicability: "active",
				verificationDocumentId: "verification-1",
				inventoryId: "inventory-1",
				activeCaseCount: 1,
				requiresAutomatedTests: true,
				requiredConditionIds: ["AC-001"],
				successfulConditionIds: [],
				missingRequiredConditionIds: ["AC-001"],
				sourceStateHashBefore: "before",
				sourceStateHashAfter: "after",
				sourceMutatedDuringCloseout: false,
				commands: [
					{
						id: "verify",
						label: "Verify",
						conditionIds: ["AC-001"],
						exitCode: 1,
						ok: false,
						managedEvidence: true,
						llmSummary: "failed",
					},
				],
			}),
		});

		expect(result.terminalState).toBe("needs_review");
		expect(result.testResults).toMatchObject({
			verificationCommandsPassed: false,
		});
	});

	it("keeps completion when verification is not configured", async () => {
		const result = await reconcileCodexCompletionBoundary(input(), {
			executeVerificationCloseout: async () => ({
				applicability: "not_configured",
				commands: [],
			}),
		});

		expect(result.terminalState).toBe("completed");
		expect(result.testResults).toMatchObject({
			verificationCommandsPassed: true,
		});
	});

	it("keeps completion when structured commands cover every required condition", async () => {
		const result = await reconcileCodexCompletionBoundary(input(), {
			executeVerificationCloseout: async () => ({
				applicability: "active",
				verificationDocumentId: "verification-1",
				inventoryId: "inventory-1",
				activeCaseCount: 1,
				requiresAutomatedTests: true,
				requiredConditionIds: ["AC-001"],
				successfulConditionIds: ["AC-001"],
				missingRequiredConditionIds: [],
				sourceStateHashBefore: "stable",
				sourceStateHashAfter: "stable",
				sourceMutatedDuringCloseout: false,
				commands: [
					{
						id: "verify",
						label: "Verify",
						conditionIds: ["AC-001"],
						exitCode: 0,
						ok: true,
						managedEvidence: true,
						llmSummary: "passed",
					},
				],
			}),
		});

		expect(result.terminalState).toBe("completed");
		expect(result.testResults).toMatchObject({
			verificationCommandsPassed: true,
			conditionsCovered: true,
			testInventoryReady: true,
			sourceStable: true,
		});
	});
});
