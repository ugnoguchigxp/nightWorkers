import { AppError, NotFoundError } from "../../../lib/errors";
import { shouldUseIsolatedTaskExecutor } from "../../../services/execution/executor-mode";
import { startTaskRunInWorker } from "../../../services/execution/worker-process-manager";
import { parseMissionPilotReworkPacket } from "../../missionPilot/mission-pilot-rework";
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
			executionModeSource: "explicit",
			missionPilotPhase:
				options.missionPilotPhase === "repository_bootstrap"
					? "repository_bootstrap"
					: "implementation",
		};
	if (shouldUseIsolatedTaskExecutor()) {
		return startTaskRunInWorker<
			Awaited<ReturnType<typeof startTaskRunInProcess>>
		>(taskId, codingAgentOptions);
	}
	return startTaskRunInProcess(taskId, codingAgentOptions);
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
	const hasReworkPacket = Object.hasOwn(candidate, "reworkPacket");
	const reworkPacket = parseMissionPilotReworkPacket(candidate.reworkPacket);
	if (hasReworkPacket && !reworkPacket) return null;
	return {
		sessionId: candidate.sessionId,
		cycle: candidate.cycle,
		contextRevision: candidate.contextRevision,
		contextDigest: candidate.contextDigest,
		...(reworkPacket ? { reworkPacket } : {}),
	};
}
