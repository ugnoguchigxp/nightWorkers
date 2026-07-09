import { createReviewerEvaluation } from "../../modules/nightworkers/nightworkers.review-files.service";
import type { WorkerToolResult } from "./types";

export type ReviewerEvaluationToolOutput = Awaited<
	ReturnType<typeof createReviewerEvaluation>
>;

export async function reviewerEvaluationTool(input: {
	runId: string;
	rubricId?: string;
	mode?: "deterministic_only" | "llm_assisted";
	persist?: boolean;
}): Promise<WorkerToolResult<ReviewerEvaluationToolOutput | null>> {
	const startedAt = new Date().toISOString();
	if (!input.runId) {
		return {
			ok: false,
			toolName: "reviewer_evaluation",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: null,
			error: {
				code: "RUN_ID_REQUIRED",
				message: "reviewer_evaluation requires a NightWorkers run id.",
			},
		};
	}
	try {
		const evaluation = await createReviewerEvaluation(input.runId, {
			rubricId: input.rubricId,
			mode: input.mode || "llm_assisted",
			persist: input.persist,
		});
		const hasActionableReviewResult = Boolean(
			evaluation.reviewResult &&
				evaluation.finalReviewerVerdict === "changes_requested",
		);
		const ok = evaluation.status === "completed" || hasActionableReviewResult;
		return {
			ok,
			toolName: "reviewer_evaluation",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: evaluation,
			error: ok
				? undefined
				: {
						code:
							evaluation.status === "degraded"
								? "REVIEWER_EVALUATION_DEGRADED"
								: "REVIEWER_EVALUATION_FAILED",
						message: `Reviewer evaluation ${evaluation.status}.`,
					},
		};
	} catch (error) {
		return {
			ok: false,
			toolName: "reviewer_evaluation",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: null,
			error: {
				code: "REVIEWER_EVALUATION_FAILED",
				message: error instanceof Error ? error.message : String(error),
			},
		};
	}
}
