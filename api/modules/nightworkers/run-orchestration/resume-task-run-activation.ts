import { AppError, NotFoundError } from "../../../lib/errors";
import { buildCodingAgentSystemContext } from "../../../services/coding-agent-context";
import { TodoMutationService } from "../../../services/todo-mutation";
import * as repo from "../nightworkers.repository";
import { readRuntimePauseSnapshot } from "./runtime-outcome-guard";

export async function activateTaskRunResume(input: {
	kind: "todo" | "runtime_pause";
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
	if (input.kind === "runtime_pause") {
		if (!readRuntimePauseSnapshot(run.contextSnapshot)) {
			throw new AppError(
				409,
				"RUN_NOT_RESUMABLE",
				"Run does not contain a resumable runtime pause",
			);
		}
		const todos = await repo.listTaskRunTodosForRun(run.id);
		const target = todos.find((todo) => todo.id === input.todoId);
		if (!target) throw new NotFoundError("Todo not found");
		if (target.status !== "running") {
			throw new AppError(409, "TODO_NOT_RESUMABLE", "Todo is not running");
		}
		if (target.revision !== input.expectedTodoRevision) {
			throw new AppError(
				409,
				"TODO_REVISION_CONFLICT",
				"Todo revision is stale; reload the latest run details",
			);
		}
		const resumedRun = await repo.updateTaskRunIfStatusAndTodoRevision({
			runId: run.id,
			expectedStatus: "needs_human",
			todoId: target.id,
			expectedTodoStatus: "running",
			expectedTodoRevision: target.revision,
			data: {
				status: "running",
				endedAt: null,
				finishedAt: null,
				contextSnapshot: clearRuntimePause(run.contextSnapshot),
				summary: null,
				finalReport: null,
				finalJudgment: null,
			},
		});
		if (!resumedRun) {
			throw new AppError(409, "RUN_NOT_RESUMABLE", "Run is not resumable");
		}
		await finishResumeActivation({
			runId: run.id,
			taskId: task.id,
			todoId: target.id,
			todoRevision: target.revision,
			message: "User context resumed a host-limited run with its current Todo.",
		});
		return resumedRun;
	}

	const systemContext = buildCodingAgentSystemContext({
		taskGoal: [task.title, task.description || task.objective]
			.filter(Boolean)
			.join("\n"),
		registeredRepositoryRoot: repository.localPath,
	});
	const mutation = await new TodoMutationService(
		systemContext,
		"human",
	).execute(run.id, {
		op: "resume",
		todoId: input.todoId,
		expectedTodoRevision: input.expectedTodoRevision,
		userContext: input.userContext,
	});
	if (!mutation.ok) {
		throw new AppError(409, mutation.error.code, mutation.error.message);
	}

	await finishResumeActivation({
		runId: run.id,
		taskId: task.id,
		todoId: input.todoId,
		todoRevision: mutation.currentTodo?.revision ?? null,
		message: "User context resumed the paused Todo and existing task run.",
	});
	const resumed = await repo.getTaskRun(run.id);
	if (!resumed) throw new NotFoundError("Run not found after resume");
	return resumed;
}

function clearRuntimePause(value: unknown) {
	const snapshot =
		value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	return { ...snapshot, runtimePause: null };
}

async function finishResumeActivation(input: {
	runId: string;
	taskId: string;
	todoId: string;
	todoRevision: number | null;
	message: string;
}) {
	await repo.updateTaskStatus(input.taskId, "running");
	await repo.createRunEvent({
		version: 1,
		runId: input.runId,
		taskId: input.taskId,
		timestamp: new Date().toISOString(),
		type: "system.info",
		severity: "info",
		actor: "human",
		message: input.message,
		data: {
			action: "run.resumed",
			todoId: input.todoId,
			todoRevision: input.todoRevision,
		},
	});
}
