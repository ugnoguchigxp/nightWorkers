import { AppError, NotFoundError } from "../../../lib/errors";
import { stopBackgroundProcessesForRun } from "../../../services/background-processes";
import { stopIsolatedTaskRun } from "../../../services/execution/worker-process-manager";
import { resolveAgentRuntime } from "../../codingAgent";
import { applyRunOutcomeTransition } from "../../run/application/run-outcome-transition.command";
import * as repo from "../nightworkers.repository";
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
	const task = await repo.getTask(run.taskId);
	if (!task) throw new NotFoundError("Task not found");
	if (precondition) {
		if (run.taskId !== precondition.expectedTaskId)
			throw new AppError(
				403,
				"TASK_RESOURCE_OWNERSHIP_MISMATCH",
				"Run does not belong to the requested Task.",
			);
		if (task?.revision !== precondition.expectedTaskRevision)
			throw new AppError(
				409,
				"TASK_REVISION_CONFLICT",
				"Task revision changed; re-read the Task Operator view.",
				{ currentTaskRevision: task?.revision ?? null },
			);
	}
	if (
		!(["running", "context_compiling", "finalizing"] as string[]).includes(
			run.status,
		)
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
	const transition = await applyRunOutcomeTransition({
		run: {
			id: runId,
			expectedStatuses: [run.status],
			expectedUpdatedAt: run.updatedAt,
			targetStatus: "cancelled",
			patch: {
				endedAt: new Date(),
				finishedAt: new Date(),
				summary: run.summary || "Run stop requested by user.",
				finalReport: run.finalReport || "Run stop requested by user.",
			},
		},
		task: {
			id: task.id,
			expectedStatus: task.status,
			expectedUpdatedAt: task.updatedAt,
			targetStatus: "ready",
		},
	});
	const stoppedRun = transition.run;
	await repo.publishTaskRunUpdate(stoppedRun);
	await stopBackgroundProcessesForRun(runId, "run_cancelled").catch(() => {
		// Process cleanup is a post-commit best effort. It must not resurrect a
		// cancelled Run when an OS process is already gone.
	});
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
	return stoppedRun;
}
