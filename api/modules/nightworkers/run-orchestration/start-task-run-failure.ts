import { projectTaskRunParentStatus } from "../../agentsShare";
import * as repo from "../nightworkers.repository";
import { toErrorMessage } from "./utils";

export async function failPreparedRunBeforeLaunch(input: {
	runId: string;
	taskId: string;
	executionMode: string;
	error: unknown;
}) {
	const message = toErrorMessage(input.error);
	const failedRun = await repo.updateTaskRunIfStatus(input.runId, "running", {
		status: "failed",
		endedAt: new Date(),
		finishedAt: new Date(),
		summary: "Runtime preparation failed before launch.",
		finalReport: `Runtime preparation failed before launch: ${message}`,
		finalJudgment: null,
	});
	if (!failedRun) return;
	await repo.createRunEvent({
		version: 1,
		runId: input.runId,
		taskId: input.taskId,
		timestamp: new Date().toISOString(),
		type: "system.error",
		severity: "error",
		actor: "system",
		message: "Task run preparation failed before runtime launch.",
		data: {
			action: "task_run.preparation_failed",
			executionMode: input.executionMode,
			error: message,
		},
	});
	const parentTaskProjection = await projectTaskRunParentStatus({
		taskId: input.taskId,
		runId: input.runId,
		runStatus: "failed",
		executionMode: input.executionMode,
	});
	if (!parentTaskProjection.handled)
		await repo.updateTaskStatus(input.taskId, parentTaskProjection.status);
}
