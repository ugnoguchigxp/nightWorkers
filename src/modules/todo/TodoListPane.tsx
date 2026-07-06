import {
	AlertTriangle,
	CheckCircle2,
	Circle,
	LoaderCircle,
	PauseCircle,
	XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TaskRunTodo, TodoStatus } from "../nightworkers/types";

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
		? `#${currentTodo.seq} ${currentTodo.title}`
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
			<div className="px-1">
				<ol>
					{todos.map((todo) => {
						const style = todoStatusStyle(todo.status);
						const Icon = style.icon;
						return (
							<li key={todo.id} className="nightworkers-todo-item px-1 py-1">
								<div className="flex min-w-0 items-center gap-2.5">
									<Icon
										aria-hidden="true"
										className={`h-4 w-4 shrink-0 ${style.iconClass} ${
											todo.status === "running" ? "animate-spin" : ""
										}`}
									/>
									<span className="nightworkers-todo-pane-subtitle shrink-0 text-[10px]">
										#{todo.seq}
									</span>
									<span className="nightworkers-todo-pane-title min-w-0 truncate text-xs font-medium leading-5">
										{todo.title}
									</span>
								</div>
							</li>
						);
					})}
				</ol>
			</div>
		</aside>
	);
}

function todoStatusStyle(status: TodoStatus): {
	icon: typeof Circle;
	iconClass: string;
} {
	switch (status) {
		case "passed":
			return {
				icon: CheckCircle2,
				iconClass: "nightworkers-todo-status-success",
			};
		case "running":
			return {
				icon: LoaderCircle,
				iconClass: "nightworkers-todo-status-running",
			};
		case "failed":
			return {
				icon: XCircle,
				iconClass: "nightworkers-todo-status-danger",
			};
		case "skipped":
			return {
				icon: PauseCircle,
				iconClass: "nightworkers-todo-pane-muted",
			};
		case "needs_human":
			return {
				icon: AlertTriangle,
				iconClass: "nightworkers-todo-status-warning",
			};
		case "pending":
			return {
				icon: Circle,
				iconClass: "nightworkers-todo-pane-muted",
			};
	}
}
