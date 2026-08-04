import { logger } from "../../../lib/logger";
import {
	projectTaskRunParentStatus,
	publishTaskRunTerminal,
} from "../../agentsShare";
import { readProcessInterruptionSnapshot } from "../../codingAgent";
import * as repo from "../nightworkers.repository";
import {
	completeImplementationQueueEntryForRun,
	runSessionQueueForRepository,
	shouldContinueSessionQueue,
} from "./queues";
import { refreshConversationContextForRuntimeLane } from "./runtime-conversation-closeout";
import type { LaunchRuntimeExecutionInput } from "./runtime-execution-types";
import { assertRunStatusTransition, runStatusTransitionTable } from "./status";
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
	if (
		readProcessInterruptionSnapshot(latestRunBeforeFailure?.contextSnapshot)
	) {
		return;
	}
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
	const parentTaskProjection = await projectTaskRunParentStatus({
		taskId,
		runId: run.id,
		runStatus: "failed",
		executionMode:
			input.runtimeContextSnapshot.executionMode ?? "implementation",
	});
	if (!parentTaskProjection.handled)
		await repo.updateTaskStatus(taskId, parentTaskProjection.status);
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
	await refreshConversationContextForRuntimeLane({
		runtimeLaneResolution,
		taskId,
		runId: run.id,
	});
	if (failureTransitionApplied)
		await repo.publishTaskRunUpdate(latestFailedRun);
	if (failureTransitionApplied) {
		const publication = await publishTaskRunTerminal({
			type: "task_run.terminal",
			eventId: `task-run-terminal:${run.id}:failed`,
			taskId,
			taskRevision: task.revision,
			runId: run.id,
			status: "failed",
			sourceRef: null,
			occurredAt: new Date().toISOString(),
		});
		if (publication.failures.length > 0) {
			logger.error(
				{
					listenerFailureCount: publication.failures.length,
					runId: run.id,
				},
				"Task terminal event subscriber failed after failure closeout",
			);
			await repo
				.createRunEvent({
					version: 1,
					runId: run.id,
					taskId,
					timestamp: new Date().toISOString(),
					type: "system.warning",
					severity: "warning",
					actor: "system",
					message:
						"Task terminal failure event was persisted, but one or more subscribers failed.",
					data: {
						action: "task_run.terminal_publish",
						listenerCount: publication.listenerCount,
						listenerFailureCount: publication.failures.length,
					},
				})
				.catch(() => undefined);
		}
	}
	if (shouldContinueSessionQueue("failed")) {
		void runSessionQueueForRepository(task.repositoryId);
	}
}
