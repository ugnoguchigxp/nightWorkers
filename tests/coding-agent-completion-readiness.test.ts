import { describe, expect, it } from "vitest";
import { evaluateCodingAgentCompletionReadiness } from "../api/modules/codingAgent/application/completion-readiness.service";
import type { CompletionCheckResult } from "../api/modules/nightworkers/nightworkers.verification.service";

const greenCompletion: CompletionCheckResult = {
	ok: true,
	verificationDocumentId: "verification-document",
	summary: {
		total: 1,
		complete: 1,
		failedRequired: 0,
		unknownRequired: 0,
	},
	failedRequired: [],
	unknownRequired: [],
	conditions: [
		{
			conditionId: "AC-001",
			text: "実装結果を確認する",
			required: true,
			status: "passed",
		},
	],
	qualityGate: {
		passed: true,
		sourceStateHash: "a".repeat(64),
		inventory: { status: "passed", activeCaseCount: 1 },
		testExecution: { status: "passed" },
		fullVerify: { status: "passed" },
		conditions: [{ conditionId: "AC-001", required: true, status: "passed" }],
	},
};

function dependencies() {
	return {
		getTask: async () => ({
			title: "Completion readiness",
			description: null,
			objective: null,
			acceptanceCriteria: null,
		}),
		getLatestActiveVerificationDocumentForTask: async () => ({
			id: "verification-document",
			status: "active",
		}),
		runCompletionCheck: async () => greenCompletion,
	} as Parameters<typeof evaluateCodingAgentCompletionReadiness>[1];
}

describe("Coding Agent completion readiness", () => {
	it("requires a concrete final candidate for an active verification document", async () => {
		const result = await evaluateCodingAgentCompletionReadiness(
			{
				taskId: "task-1",
				runId: "run-1",
				repositoryRoot: "/repo",
			},
			dependencies(),
		);

		expect(result.ready).toBe(false);
		expect(result.discrepancies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "final_candidate_missing" }),
			]),
		);
	});

	it("is ready when verification and the current candidate are both present", async () => {
		const result = await evaluateCodingAgentCompletionReadiness(
			{
				taskId: "task-1",
				runId: "run-1",
				repositoryRoot: "/repo",
				candidateRevision: 3,
				finalCandidate: "実装と検証が完了しました。",
			},
			dependencies(),
		);

		expect(result.ready).toBe(true);
		expect(result.candidate).toMatchObject({ revision: 3 });
	});
});
