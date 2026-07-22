import { AppError, NotFoundError } from "../../../lib/errors";
import { shouldUseIsolatedTaskExecutor } from "../../../services/execution/executor-mode";
import { startTaskRunInWorker } from "../../../services/execution/worker-process-manager";
import { prepareImplementationQueueRepository } from "../../queue/queue-repository-readiness.service";
import * as repo from "../nightworkers.repository";
import { startTaskRunInProcess } from "./start-task-run";

export async function startTaskRun(
	taskId: string,
	options: import("./start-task-run-types").StartTaskRunOptions = {},
) {
	const codingAgentOptions: import("./start-task-run-types").StartTaskRunOptions =
		{
			...options,
			executionMode: "implementation",
			executionModeSource: options.executionModeSource ?? "explicit",
		};
	await prepareImplementationWorkspaceForStart(taskId, codingAgentOptions);
	if (shouldUseIsolatedTaskExecutor()) {
		return startTaskRunInWorker<
			Awaited<ReturnType<typeof startTaskRunInProcess>>
		>(taskId, codingAgentOptions);
	}
	return startTaskRunInProcess(taskId, codingAgentOptions);
}

async function prepareImplementationWorkspaceForStart(
	taskId: string,
	options: import("./start-task-run-types").StartTaskRunOptions,
) {
	if (options.allowUnassignedWorkspace || options.resumeRunId) return;
	const task = await repo.getTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	if (task.worktreePath) return;
	if (!task.repositoryId) {
		throw new AppError(
			422,
			"IMPLEMENTATION_REPOSITORY_REQUIRED",
			"Implementation requires a registered Project.",
		);
	}
	const previousRuns = await repo.listTaskRunsForTask(taskId);
	// A legacy run may have uncommitted work in the registered repository root.
	// Moving a continuation to a newly-created worktree would silently lose it.
	if (previousRuns.length > 0) return;
	await prepareImplementationQueueRepository({
		task: { id: task.id, repositoryId: task.repositoryId },
		messages: await repo.listTaskMessages(taskId),
	});
}

export async function prepareStartableTask(taskId: string) {
	const task = await repo.getTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	const activeRuns = await repo.listActiveTaskRunsForTask(taskId);
	if (activeRuns.length > 0) {
		throw new AppError(
			409,
			"RUN_ALREADY_ACTIVE",
			"Another run is already active for this task",
		);
	}
	await repo.updateTaskStatus(taskId, "running");
	return task;
}

export async function prepareResumableTaskRun(taskId: string, runId: string) {
	const task = await repo.getTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	const run = await repo.getTaskRun(runId);
	if (!run || run.taskId !== taskId) throw new NotFoundError("Run not found");
	if (run.status !== "needs_human") {
		throw new AppError(
			409,
			"RUN_NOT_RESUMABLE",
			"Only a needs_human run can be resumed",
		);
	}
	const activeRuns = await repo.listActiveTaskRunsForTask(taskId);
	if (activeRuns.length > 0) {
		throw new AppError(
			409,
			"RUN_ALREADY_ACTIVE",
			"Another run is already active for this task",
		);
	}
	return { task, run };
}
