import type { TaskOperatorPrincipal } from "../../../../shared/modules/taskOperator";
import {
	archiveTask,
	restoreTaskArchive,
	reviewTaskRun,
	updateTask,
} from "../../nightworkers/nightworkers.service";

export async function updateTaskCommand(input: {
	taskId: string;
	fields: Parameters<typeof updateTask>[1];
	expectedRevision: number;
	principal: TaskOperatorPrincipal;
}) {
	return updateTask(input.taskId, input.fields, {
		expectedRevision: input.expectedRevision,
	});
}

export async function archiveTaskCommand(input: {
	taskId: string;
	expectedRevision: number;
	principal: TaskOperatorPrincipal;
	discardPendingCloseouts?: boolean;
}) {
	return archiveTask(input.taskId, input.expectedRevision, {
		discardPendingCloseouts: input.discardPendingCloseouts,
	});
}

export async function restoreTaskArchiveCommand(input: {
	taskId: string;
	expectedRevision: number;
	principal: TaskOperatorPrincipal;
}) {
	return restoreTaskArchive(input.taskId, input.expectedRevision);
}

export async function completeTaskFromRunCommand(input: {
	taskId: string;
	sourceRunId: string;
	expectedRevision: number;
	principal: TaskOperatorPrincipal;
}) {
	return reviewTaskRun(
		input.sourceRunId,
		{ action: "complete" },
		{
			expectedTaskId: input.taskId,
			expectedTaskRevision: input.expectedRevision,
		},
	);
}
