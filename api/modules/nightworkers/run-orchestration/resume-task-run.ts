import { AppError, NotFoundError } from "../../../lib/errors";
import {
	readCodingAgentPlanModeRequested,
	resolveCodingAgentInvocationSource,
} from "../../codingAgent";
import * as repo from "../nightworkers.repository";
import { readRuntimePauseSnapshot } from "./runtime-outcome-guard";
import { startTaskRun } from "./start-task-run";

export async function resumeTaskRunTodo(input: {
	runId: string;
	todoId: string;
	expectedTodoRevision: number;
	userContext: string;
}) {
	const run = await repo.getTaskRun(input.runId);
	if (!run) throw new NotFoundError("Run not found");
	const task = await repo.getTask(run.taskId);
	if (!task) throw new NotFoundError("Task not found");
	const repository = await repo.getRepository(task.repositoryId);
	if (!repository) throw new NotFoundError("Repository not found");
	const todos = await repo.listTaskRunTodosForRun(run.id);
	const target = todos.find((todo) => todo.id === input.todoId);
	if (!target) throw new NotFoundError("Todo not found");
	const runtimePause = readRuntimePauseSnapshot(run.contextSnapshot);
	const resumeKind =
		target.status === "needs_human"
			? "todo"
			: target.status === "running" && runtimePause?.resumableRunningTodo
				? "runtime_pause"
				: null;
	if (!resumeKind) {
		throw new AppError(
			409,
			"TODO_NOT_RESUMABLE",
			"Todo is not waiting for a human response",
		);
	}
	if (target.revision !== input.expectedTodoRevision) {
		throw new AppError(
			409,
			"TODO_REVISION_CONFLICT",
			"Todo revision is stale; reload the latest run details",
		);
	}

	return startTaskRun(task.id, {
		executionMode: "implementation",
		executionModeSource: "explicit",
		codingAgentInvocationSource: resolveCodingAgentInvocationSource(
			run.contextSnapshot,
		),
		planModeRequested: readCodingAgentPlanModeRequested(run.contextSnapshot),
		resumeRunId: run.id,
		latestUserMessageOverride: input.userContext,
		resumeCommand: {
			kind: resumeKind,
			todoId: input.todoId,
			expectedTodoRevision: input.expectedTodoRevision,
			userContext: input.userContext,
		},
	});
}
