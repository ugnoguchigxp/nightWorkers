import type * as repo from "../nightworkers.repository";

export function listIncompleteTodos<TTodo extends { status: string }>(
	todos: TTodo[],
) {
	return todos.filter(
		(todo) =>
			todo.status === "pending" ||
			todo.status === "running" ||
			todo.status === "needs_human",
	);
}

export function toAgentRuntimeTodoContext(
	todo: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>[number],
) {
	return {
		id: todo.id,
		seq: todo.seq,
		title: todo.title,
		description: todo.description,
		objective: todo.objective,
		systemContext: todo.context,
		context: todo.context,
		nextAction: todo.nextAction,
		acceptanceCriteria: readStringArray(todo.acceptanceCriteriaJson),
		lastFailure: todo.lastFailure,
		attemptCount: todo.attemptCount,
		revision: todo.revision,
		systemContextVersion: todo.systemContextVersion,
		taskType: todo.taskType,
		status: todo.status,
		procedureId: todo.procedureId,
	};
}

function readStringArray(value: unknown) {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}
