import { AppError, NotFoundError } from "../../../lib/errors";
import { stopIsolatedTaskRun } from "../../../services/execution/worker-process-manager";
import { resolveAgentRuntime } from "../../codingAgent";
import * as repo from "../nightworkers.repository";
import { completeImplementationQueueEntryForRun } from "./queues";
import { assertRunStatusTransition } from "./status";
import { normalizeAgentRuntimeKind } from "./utils";

export async function stopTaskRun(
	runId: string,
	precondition?: {
		expectedTaskId: string;
		expectedTaskRevision: number;
	},
) {
	const run = await repo.getTaskRun(runId);
	if (!run) {
		throw new NotFoundError("Run not found");
	}
	if (precondition) {
		if (run.taskId !== precondition.expectedTaskId)
			throw new AppError(
				403,
				"TASK_RESOURCE_OWNERSHIP_MISMATCH",
				"Run does not belong to the requested Task.",
			);
		const task = await repo.getTask(run.taskId);
		if (task?.updatedAt.getTime() !== precondition.expectedTaskRevision)
			throw new AppError(
				409,
				"TASK_REVISION_CONFLICT",
				"Task revision changed; re-read the Task Operator view.",
				{ currentTaskRevision: task?.updatedAt.getTime() ?? null },
			);
	}
	if (
		![
			"running",
			"context_compiling",
			"compiling_context",
			"finalizing",
		].includes(run.status)
	) {
		return run;
	}
	if (await stopIsolatedTaskRun(runId)) {
		return (await repo.getTaskRun(runId)) ?? run;
	}

	const runtime = resolveAgentRuntime(
		normalizeAgentRuntimeKind(run.workerKind),
	);
	await runtime.stop(runId);
	await repo.createRunEvent({
		version: 1,
		runId,
		taskId: run.taskId,
		timestamp: new Date().toISOString(),
		type: "run.stop_requested",
		severity: "warning",
		actor: "human",
		message: "User requested run stop from the composer.",
		data: {
			workerKind: run.workerKind,
			previousStatus: run.status,
		},
	});
	assertRunStatusTransition(run.status, "cancelled");
	const stoppedRun = await repo.updateTaskRun(runId, {
		status: "cancelled",
		endedAt: new Date(),
		finishedAt: new Date(),
		summary: run.summary || "Run stop requested by user.",
		finalReport: run.finalReport || "Run stop requested by user.",
	});
	await repo.updateTaskStatus(run.taskId, "ready");
	await completeImplementationQueueEntryForRun(runId, "cancelled");
	return stoppedRun ?? run;
}
