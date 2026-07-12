import { AppError, NotFoundError } from "../../../lib/errors";
import { shouldUseIsolatedTaskExecutor } from "../../../services/execution/executor-mode";
import { startTaskRunInWorker } from "../../../services/execution/worker-process-manager";
import * as repo from "../nightworkers.repository";
import { startTaskRunInProcess } from "./start-task-run";

export async function startTaskRun(
	taskId: string,
	options: import("./start-task-run-types").StartTaskRunOptions = {},
) {
	if (shouldUseIsolatedTaskExecutor()) {
		return startTaskRunInWorker<
			Awaited<ReturnType<typeof startTaskRunInProcess>>
		>(taskId, options);
	}
	return startTaskRunInProcess(taskId, options);
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

export function readMissionPilotEnvelope(value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Record<string, unknown>;
	if (
		typeof candidate.sessionId !== "string" ||
		typeof candidate.cycle !== "number" ||
		typeof candidate.contextRevision !== "number" ||
		typeof candidate.contextDigest !== "string"
	)
		return null;
	return {
		sessionId: candidate.sessionId,
		cycle: candidate.cycle,
		contextRevision: candidate.contextRevision,
		contextDigest: candidate.contextDigest,
	};
}
