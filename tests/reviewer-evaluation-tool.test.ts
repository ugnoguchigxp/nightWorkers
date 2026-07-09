import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createReviewerEvaluation: vi.fn(),
}));

vi.mock(
	"../api/modules/nightworkers/nightworkers.review-files.service",
	() => ({
		createReviewerEvaluation: mocks.createReviewerEvaluation,
	}),
);

import { executeWorkerTool } from "../api/services/worker-tools/dispatcher";
import { reviewerEvaluationTool } from "../api/services/worker-tools/reviewer-evaluation";

describe("reviewer_evaluation worker tool", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("dispatches the current run id and defaults to llm_assisted mode", async () => {
		mocks.createReviewerEvaluation.mockResolvedValueOnce({
			status: "completed",
			reviewResult: { verdict: "approved" },
			events: [],
		});

		const dispatch = await executeWorkerTool({
			toolName: "reviewer_evaluation",
			args: {},
			repoRoot: "/tmp/repo",
			taskId: "task-1",
			runId: "run-1",
			readFiles: [],
		});

		expect(dispatch.result).toMatchObject({
			ok: true,
			toolName: "reviewer_evaluation",
			payload: { status: "completed" },
		});
		expect(mocks.createReviewerEvaluation).toHaveBeenCalledWith("run-1", {
			rubricId: undefined,
			mode: "llm_assisted",
			persist: undefined,
		});
	});

	it("treats degraded LLM review as an unsuccessful final check", async () => {
		mocks.createReviewerEvaluation.mockResolvedValueOnce({
			status: "degraded",
			reviewResult: { verdict: "approved" },
			events: [],
			degradedReasons: ["llm_reviewer_provider_not_configured"],
		});

		const result = await reviewerEvaluationTool({
			runId: "run-2",
			mode: "llm_assisted",
		});

		expect(result).toMatchObject({
			ok: false,
			toolName: "reviewer_evaluation",
			payload: { status: "degraded" },
			error: {
				code: "REVIEWER_EVALUATION_DEGRADED",
			},
		});
	});

	it("fails clearly when no run id is available", async () => {
		const result = await reviewerEvaluationTool({ runId: "" });

		expect(result).toMatchObject({
			ok: false,
			toolName: "reviewer_evaluation",
			error: {
				code: "RUN_ID_REQUIRED",
			},
		});
		expect(mocks.createReviewerEvaluation).not.toHaveBeenCalled();
	});
});
