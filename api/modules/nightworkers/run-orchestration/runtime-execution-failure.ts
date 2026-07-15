import { logger } from "../../../lib/logger";
import { finalizeReviewRunFromRuntime } from "../../review";
import * as repo from "../nightworkers.repository";
import {
	completeImplementationQueueEntryForRun,
	runSessionQueueForRepository,
	shouldContinueSessionQueue,
} from "./queues";
import { refreshConversationContextForRuntimeLane } from "./runtime-conversation-closeout";
import type { LaunchRuntimeExecutionInput } from "./runtime-execution-types";
import { safelyCreateReviewRecommendation } from "./runtime-routing";
import { assertRunStatusTransition, runStatusTransitionTable } from "./status";
import { closeOpenTodosForFailedRun } from "./todo-closeout";
import { toErrorMessage } from "./utils";

export async function handleRuntimeExecutionFailure(input: {
	error: unknown;
	taskId: string;
	task: LaunchRuntimeExecutionInput["task"];
	run: LaunchRuntimeExecutionInput["run"];
	runtimeLaneResolution: LaunchRuntimeExecutionInput["runtimeLaneResolution"];
	runtimeContextSnapshot: LaunchRuntimeExecutionInput["runtimeContextSnapshot"];
}) {
	const { error: err, taskId, task, run, runtimeLaneResolution } = input;
	const errorMessage = toErrorMessage(err);
	logger.error(
		{ error: errorMessage, runId: run.id },
		"NativeLocalRunner execution failed",
	);
	const finalReport = `実行に失敗しました: ${errorMessage}`;
	const latestRunBeforeFailure = await repo.getTaskRun(run.id);
	const currentStatus = latestRunBeforeFailure?.status ?? "running";
	const transitions: Record<string, readonly string[]> =
		runStatusTransitionTable;
	let latestFailedRun = latestRunBeforeFailure;
	let failureTransitionApplied = false;
	if (currentStatus !== "failed") {
		if (!transitions[currentStatus]?.includes("failed")) return;
		assertRunStatusTransition(currentStatus, "failed");
		latestFailedRun =
			(await repo.updateTaskRunIfStatusWithoutPublish(run.id, currentStatus, {
				status: "failed",
				endedAt: new Date(),
				finishedAt: new Date(),
				logContent: `[System Error] ${errorMessage}`,
				finalReport,
				finalJudgment: null,
				summary: `Execution crashed: ${errorMessage}`,
			})) ?? null;
		failureTransitionApplied = Boolean(latestFailedRun);
	}
	if (latestFailedRun?.status !== "failed") return;
	const todosBeforeFailedCloseout = await repo.listTaskRunTodosForRun(run.id);
	await closeOpenTodosForFailedRun({
		runId: run.id,
		taskId,
		todos: todosBeforeFailedCloseout,
		evidence: errorMessage,
	});
	await repo.updateTaskStatus(taskId, "failed");
	await finalizeReviewRunFromRuntime({
		runId: run.id,
		taskId,
		status: "failed",
		contextSnapshot:
			latestFailedRun?.contextSnapshot ?? input.runtimeContextSnapshot,
		runtimeResult: {
			terminalState: "failed",
			summary: `Execution crashed: ${errorMessage}`,
			finalReport,
			stoppedBy: "llm_error",
			riskLevel: "high",
			logContent: `[System Error] ${errorMessage}`,
		},
	});
	await completeImplementationQueueEntryForRun(run.id, "failed");

	await repo.createTaskMessage({
		taskId,
		runId: run.id,
		role: "assistant",
		content: finalReport,
		messageType: "text",
		payloadJson: {
			finalReport,
			summary: `Execution crashed: ${errorMessage}`,
			status: "failed",
		},
	});
	await safelyCreateReviewRecommendation({ taskId, runId: run.id });
	await refreshConversationContextForRuntimeLane({
		runtimeLaneResolution,
		taskId,
		runId: run.id,
	});
	if (failureTransitionApplied)
		await repo.publishTaskRunUpdate(latestFailedRun);
	if (shouldContinueSessionQueue("failed")) {
		void runSessionQueueForRepository(task.repositoryId);
	}
}
