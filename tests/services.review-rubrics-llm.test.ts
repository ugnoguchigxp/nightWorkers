import { describe, expect, it } from "vitest";
import { callLlmReviewer } from "../api/services/review-rubrics/llm-reviewer";
import { loadRubric } from "../api/services/review-rubrics/loader";
import { runReviewerEvaluationFromPack } from "../api/services/review-rubrics/replay-evaluation";
import type {
	ReviewEvidencePack,
	ReviewerDraft,
} from "../api/services/review-rubrics/types";

const pack: ReviewEvidencePack = {
	version: 1,
	runId: "11111111-1111-4111-8111-111111111111",
	taskId: "22222222-2222-4222-8222-222222222222",
	status: "needs_review",
	finalReport: "Finished",
	diff: { hasChanges: true, bytes: 42, changedFiles: ["src/a.ts"] },
	verification: [
		{ eventId: "33333333-3333-4333-8333-333333333333", passed: true },
	],
	policy: [],
	reviewResults: [],
	selectedEvents: [],
	eventTypes: ["verification.finished"],
	diagnostics: [],
};

const draft: ReviewerDraft = {
	version: 1,
	verdict: "approved",
	summary: "approved",
	findings: [],
	humanCallouts: [],
	agentFollowUps: [],
	suggestedNextTasks: [],
};

describe("LLM reviewer adapter", () => {
	it("returns degraded when no provider is configured", async () => {
		const result = await callLlmReviewer({
			rubric: loadRubric("basic-coding-run").rubric,
			evidencePack: pack,
		});

		expect(result.status).toBe("degraded");
		expect(result.degradedReasons).toContain(
			"llm_reviewer_provider_not_configured",
		);
	});

	it("passes mocked ReviewerDraft output through the adapter metadata", async () => {
		const result = await callLlmReviewer({
			rubric: loadRubric("basic-coding-run").rubric,
			evidencePack: pack,
			mockDraft: draft,
		});

		expect(result.status).toBe("completed");
		expect(result.draft).toEqual(draft);
		expect(result.rawOutput).toEqual(draft);
		expect(result.outputDigest).toBeTruthy();
	});

	it("sends invalid mocked LLM output through the firewall", async () => {
		const result = await runReviewerEvaluationFromPack({
			pack,
			rubricId: "basic-coding-run",
			mode: "llm_assisted",
			run: {
				id: pack.runId,
				taskId: pack.taskId,
				status: pack.status,
				summary: "Finished",
			},
			mockLlmOutput: "not-json",
		});

		expect(result.status).toBe("degraded");
		expect(result.degradedReasons).toEqual(
			expect.arrayContaining([
				"llm_reviewer_provider_not_configured",
				"llm_output_schema_mismatch",
			]),
		);
		expect(
			result.reviewResult.findings.map((finding) => finding.title),
		).toContain("LLM reviewer output schema mismatch");
	});
});
