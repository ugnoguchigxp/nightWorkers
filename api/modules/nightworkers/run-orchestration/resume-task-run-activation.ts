import { AppError, NotFoundError } from "../../../lib/errors";
import { buildCodingAgentSystemContext } from "../../../services/coding-agent-context";
import { TodoMutationService } from "../../../services/todo-mutation";
import * as repo from "../nightworkers.repository";

export async function activateTaskRunResume(input: {
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

	await repo.updateTaskStatus(task.id, "running");
	await repo.createRunEvent({
		version: 1,
		runId: run.id,
		taskId: task.id,
		timestamp: new Date().toISOString(),
		type: "system.info",
		severity: "info",
		actor: "human",
		message: "User context resumed the paused Todo and existing task run.",
		data: {
			action: "run.resumed",
			todoId: input.todoId,
			todoRevision: mutation.currentTodo?.revision ?? null,
		},
	});
	const resumed = await repo.getTaskRun(run.id);
	if (!resumed) throw new NotFoundError("Run not found after resume");
	return resumed;
}
