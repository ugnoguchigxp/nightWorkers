import { describe, expect, it } from "vitest";
import type { CompletionCheckResult } from "../api/modules/codingAgent/application/completion-check.service";
import { evaluateCodingAgentCompletionReadiness } from "../api/modules/codingAgent/application/completion-readiness.service";

const greenCompletion: CompletionCheckResult = {
	ok: true,
	verificationDocumentId: "verification-document",
	runId: "run-1",
	sourceStateHash: "a".repeat(64),
	mapping: {
		status: "missing",
		definitionDigest: "b".repeat(64),
		total: 1,
		matched: 0,
		items: [],
	},
	verify: {
		status: "passed",
		command: "bun run verify",
		cwd: "/repo",
		exitCode: 0,
		sourceStateHash: "a".repeat(64),
		finishedAt: "2026-08-01T00:00:00.000Z",
		logRefs: [],
	},
	confirmation: {
		status: "settled",
		initialEvidenceRunId: "evidence-run-1",
		confirmedAt: "2026-08-01T00:00:00.000Z",
	},
	assurance: {
		policyVersion: "strict_v1",
		status: "passed",
		verificationDocumentDigest: "document-digest",
		receiptDigest: "receipt-digest",
		conditions: [],
		reasonCodes: [],
	},
	suggestedAction: "write_final_report",
	readinessDigest: "sha256:ready",
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
		runCompletionCheck: async (input) => {
			expect(input.runId).toBe("run-1");
			return greenCompletion;
		},
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

	it("is ready when Evidence Check is settled and the current candidate is present even without mapping", async () => {
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

	it("reports capture failures without suggesting a structured-test retry", async () => {
		const captureFailure: CompletionCheckResult = {
			...greenCompletion,
			ok: false,
			reason: "TEST_EVIDENCE_CAPTURE_FAILED",
			suggestedAction: "report_test_evidence_failure",
			assurance: {
				...greenCompletion.assurance,
				status: "failed",
				receiptDigest: null,
				reasonCodes: ["TEST_EVIDENCE_CAPTURE_FAILED"],
			},
		};
		const result = await evaluateCodingAgentCompletionReadiness(
			{
				taskId: "task-1",
				runId: "run-1",
				repositoryRoot: "/repo",
				candidateRevision: 4,
				finalCandidate: "capture failureを報告します。",
			},
			{
				...dependencies(),
				runCompletionCheck: async () => captureFailure,
			},
		);

		expect(result.ready).toBe(false);
		expect(result.satisfactionConditions).toEqual([
			"test evidenceのcaptureまたはidentityに関するnon-retryableなhost障害を、typed reasonとともに報告する。",
		]);
		expect(result.satisfactionConditions.join(" ")).not.toContain(
			"structured result",
		);
	});
});
