import { AppError } from "../../lib/errors";
import { shouldUseIsolatedTaskExecutor } from "../../services/execution/executor-mode";
import { startTaskRunInWorker } from "../../services/execution/worker-process-manager";
import type { StructuredLlmModelTarget } from "../../services/structured-llm/settings";
import * as repo from "../nightworkers/nightworkers.repository";
import { startTaskRunInProcess } from "../nightworkers/run-orchestration/start-task-run";
import type { StartTaskRunOptions } from "../nightworkers/run-orchestration/start-task-run-types";

export type StartInteractiveReviewPromptInput = {
	taskId: string;
	prompt: string;
	reviewedRunId?: string | null;
	routeOverride?: StructuredLlmModelTarget | null;
};

/**
 * Interactive Review ModeのPromptを、Review roleのCodex threadへ接続する。
 * Task解釈、Plan Mode、Coding Agent SystemContext、NightWorkers Todoは扱わない。
 */
export async function startInteractiveReviewPrompt(
	input: StartInteractiveReviewPromptInput,
) {
	const reviewedRunId = await resolveReviewedImplementationRunId({
		taskId: input.taskId,
		reviewedRunId: input.reviewedRunId ?? null,
	});
	const options: StartTaskRunOptions = {
		executionMode: "review",
		executionModeSource: "workbench_review_prompt",
		latestUserMessageOverride: input.prompt,
		interactiveReview: {
			kind: "interactive_review",
			reviewedRunId,
		},
		routeOverride: input.routeOverride ?? null,
	};
	if (shouldUseIsolatedTaskExecutor()) {
		return startTaskRunInWorker<
			Awaited<ReturnType<typeof startTaskRunInProcess>>
		>(input.taskId, options);
	}
	return startTaskRunInProcess(input.taskId, options);
}

async function resolveReviewedImplementationRunId(input: {
	taskId: string;
	reviewedRunId: string | null;
}) {
	if (!input.reviewedRunId) return null;
	const run = await repo.getTaskRun(input.reviewedRunId);
	const context =
		run?.contextSnapshot &&
		typeof run.contextSnapshot === "object" &&
		!Array.isArray(run.contextSnapshot)
			? (run.contextSnapshot as Record<string, unknown>)
			: null;
	if (
		run?.taskId !== input.taskId ||
		context?.executionMode !== "implementation"
	) {
		throw new AppError(
			409,
			"review_target_invalid",
			"Review対象には同じTaskのImplementation Runを指定してください",
		);
	}
	return run.id;
}
