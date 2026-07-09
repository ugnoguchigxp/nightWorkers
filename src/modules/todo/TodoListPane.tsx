import { useTranslation } from "react-i18next";
import type { TaskRunTodo } from "../nightworkers/types";
import { TodoRailList } from "./TodoRailList";

type TodoListPaneProps = {
	todos: TaskRunTodo[];
};

export function TodoListPane({ todos }: TodoListPaneProps) {
	const { t } = useTranslation();
	const completedCount = todos.filter(
		(todo) => todo.status === "passed",
	).length;
	const currentTodo = todos.find((todo) => todo.status === "running");
	const nextTodo = todos.find((todo) => todo.status === "pending");
	const blockedTodo = todos.find((todo) => todo.status === "needs_human");
	const headerSubtitle = currentTodo
		? `running #${currentTodo.seq} ${currentTodo.title}`
		: blockedTodo
			? `blocked: #${blockedTodo.seq} ${blockedTodo.title}`
			: nextTodo
				? `next: #${nextTodo.seq} ${nextTodo.title}`
				: t("todoPane.noActiveTodo");

	return (
		<aside className="nightworkers-todo-pane flex flex-col">
			<div className="nightworkers-todo-pane-header shrink-0 px-2 py-2">
				<div className="flex items-center justify-between gap-3">
					<div className="min-w-0">
						<h2 className="nightworkers-todo-pane-title truncate text-sm font-semibold">
							{t("timeline.todoProgress")}
						</h2>
						<p className="nightworkers-todo-pane-subtitle mt-1 truncate text-xs">
							{headerSubtitle}
						</p>
					</div>
					<span className="nightworkers-todo-pane-count shrink-0 px-1 py-0.5 font-mono text-xs">
						{completedCount}/{todos.length}
					</span>
				</div>
			</div>
			<div className="nightworkers-todo-list-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
				<TodoRailList
					items={todos.map((todo) => ({
						id: todo.id,
						seq: todo.seq,
						title: todo.title,
						status: todo.status,
						instruction: todoInstructionPreview(todo),
						activeLabel: todo.status === "running" ? "running" : null,
					}))}
				/>
			</div>
		</aside>
	);
}

function todoInstructionPreview(todo: TaskRunTodo) {
	const candidates = [todo.description, todo.statusReason].map((value) =>
		typeof value === "string" ? value.trim() : "",
	);
	const source = candidates.find(Boolean);
	if (!source) return null;
	return source.replace(/\s+/g, " ");
}
