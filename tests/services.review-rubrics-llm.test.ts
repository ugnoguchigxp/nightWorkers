import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	callStructuredJsonLLM: vi.fn(),
}));

vi.mock("../api/services/structured-llm", () => ({
	callStructuredJsonLLM: mocks.callStructuredJsonLLM,
}));

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
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("calls the structured LLM through the review role", async () => {
		mocks.callStructuredJsonLLM.mockImplementationOnce(
			async (
				_systemPrompt: string,
				_userPrompt: string,
				options: {
					emitEvent?: (event: {
						type: "model.request_started";
						severity: "info";
						message: string;
						data: Record<string, unknown>;
					}) => void | Promise<void>;
				},
			) => {
				await options.emitEvent?.({
					type: "model.request_started",
					severity: "info",
					message: "started",
					data: { provider: "codex", model: "gpt-5.4-mini" },
				});
				return JSON.stringify(draft);
			},
		);

		const result = await callLlmReviewer({
			rubric: loadRubric("basic-coding-run").rubric,
			evidencePack: pack,
		});

		expect(result.status).toBe("completed");
		expect(result.provider).toBe("codex");
		expect(result.model).toBe("gpt-5.4-mini");
		expect(result.rawOutput).toBe(JSON.stringify(draft));
		expect(mocks.callStructuredJsonLLM).toHaveBeenCalledWith(
			"コードレビューをしてください。改善するべき点が無くなるまで改善してください",
			expect.stringContaining("ReviewerDraft JSON"),
			expect.objectContaining({
				role: "review",
				schemaName: "reviewer_draft",
				taskId: pack.taskId,
				runId: pack.runId,
			}),
		);
	});

	it("returns degraded only when the review route is actually unavailable", async () => {
		mocks.callStructuredJsonLLM.mockRejectedValueOnce(
			new Error("No structured LLM route candidates were available."),
		);

		const result = await callLlmReviewer({
			rubric: loadRubric("basic-coding-run").rubric,
			evidencePack: pack,
		});

		expect(result.status).toBe("degraded");
		expect(result.errorCode).toBe("LLM_REVIEWER_PROVIDER_NOT_CONFIGURED");
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
			expect.arrayContaining(["llm_output_schema_mismatch"]),
		);
		expect(result.degradedReasons).not.toContain(
			"llm_reviewer_provider_not_configured",
		);
		expect(
			result.reviewResult.findings.map((finding) => finding.title),
		).toContain("LLM reviewer output schema mismatch");
	});
});
