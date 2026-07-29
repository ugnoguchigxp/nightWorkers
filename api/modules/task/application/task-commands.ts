import type { TaskOperatorPrincipal } from "../../../../shared/modules/taskOperator";
import { AppError } from "../../../lib/errors";
import { getTask } from "../../nightworkers/nightworkers.repository";
import { runSessionQueueForRepository } from "../../nightworkers/nightworkers.run-orchestration.service";
import { updateTask } from "../../nightworkers/nightworkers.task.repository";
import {
	archiveCompletedTask,
	restoreArchivedTask,
} from "../../nightworkers/task-archive.service";
import { reviewTaskRunCommand } from "../../run/application/run-review.command";

export async function updateTaskCommand(input: {
	taskId: string;
	fields: Parameters<typeof updateTask>[1];
	expectedRevision: number;
	principal: TaskOperatorPrincipal;
}) {
	const updated = await updateTask(input.taskId, input.fields, {
		expectedRevision: input.expectedRevision,
	});
	if (!updated) {
		const current = await getTask(input.taskId);
		throw new AppError(
			409,
			"TASK_REVISION_CONFLICT",
			"Task revision changed; re-read the Task workspace.",
			{ currentTaskRevision: current?.revision ?? null },
		);
	}
	if (updated.status === "ready")
		void runSessionQueueForRepository(updated.repositoryId);
	return updated;
}

export async function archiveTaskCommand(input: {
	taskId: string;
	expectedRevision: number;
	principal: TaskOperatorPrincipal;
	discardPendingCloseouts?: boolean;
}) {
	return (
		await archiveCompletedTask({
			taskId: input.taskId,
			reason: "manual",
			expectedTaskRevision: input.expectedRevision,
			discardPendingCloseouts: input.discardPendingCloseouts,
		})
	).task;
}

export async function restoreTaskArchiveCommand(input: {
	taskId: string;
	expectedRevision: number;
	principal: TaskOperatorPrincipal;
}) {
	return restoreArchivedTask(input.taskId, "user", input.expectedRevision);
}

export async function completeTaskFromRunCommand(input: {
	taskId: string;
	sourceRunId: string;
	expectedRevision: number;
	principal: TaskOperatorPrincipal;
}) {
	return reviewTaskRunCommand(
		input.sourceRunId,
		{ action: "complete" },
		{
			expectedTaskId: input.taskId,
			expectedTaskRevision: input.expectedRevision,
		},
	);
}
