import type { taskRunTodos } from "../../../db/schema";

type TodoRow = typeof taskRunTodos.$inferSelect;

export function uniqueCurrentTodo(todos: TodoRow[]) {
	const running = todos.filter((todo) => todo.status === "running");
	return running.length === 1 ? running[0] : null;
}

export function hasOtherCurrentTodo(todos: TodoRow[], excludingId?: string) {
	return todos.some(
		(todo) =>
			todo.id !== excludingId &&
			(todo.status === "running" || todo.status === "needs_human"),
	);
}

export function findTodoByReference(todos: TodoRow[], reference: string) {
	return todos.find(
		(todo) => todo.id === reference || todo.todoKey === reference,
	);
}

export function dependenciesAreTerminal(
	target: TodoRow,
	todos: TodoRow[],
	transitioningTodoId?: string,
) {
	const byId = new Map(todos.map((todo) => [todo.id, todo]));
	const dependencyIds = Array.isArray(target.dependsOn)
		? target.dependsOn.filter((id): id is string => typeof id === "string")
		: [];
	return dependencyIds.every((id) => {
		if (id === transitioningTodoId) return true;
		const dependency = byId.get(id);
		return dependency?.status === "passed" || dependency?.status === "skipped";
	});
}

export function hasDependencyCycle(
	todos: Array<{ id: string; dependsOn?: string[] | null }>,
) {
	const ids = new Set(todos.map((todo) => todo.id));
	const dependencies = new Map(
		todos.map((todo) => [
			todo.id,
			(todo.dependsOn ?? []).filter((id) => ids.has(id)),
		]),
	);
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (id: string): boolean => {
		if (visiting.has(id)) return true;
		if (visited.has(id)) return false;
		visiting.add(id);
		for (const dependency of dependencies.get(id) ?? []) {
			if (visit(dependency)) return true;
		}
		visiting.delete(id);
		visited.add(id);
		return false;
	};
	return todos.some((todo) => visit(todo.id));
}
