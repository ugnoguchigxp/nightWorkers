import { useTranslation } from "react-i18next";
import type { CodexTodoTraceItem } from "../nightworkers/codexTodoTrace";
import { TodoRailList } from "./TodoRailList";

export function CodexTodoTracePane(props: {
	items: CodexTodoTraceItem[];
	runActive: boolean;
}) {
	const { t } = useTranslation();
	const completedCount = props.items.filter((item) => item.completed).length;
	const firstOpenIndex = props.items.findIndex((item) => !item.completed);
	const current = firstOpenIndex >= 0 ? props.items[firstOpenIndex] : null;
	return (
		<aside className="nightworkers-todo-pane flex flex-col">
			<div className="nightworkers-todo-pane-header shrink-0 px-2 py-2">
				<div className="flex items-center justify-between gap-3">
					<div className="min-w-0">
						<h2 className="nightworkers-todo-pane-title truncate text-sm font-semibold">
							{t("timeline.todoProgress")}
						</h2>
						<p className="nightworkers-todo-pane-subtitle mt-1 truncate text-xs">
							{current
								? t(
										props.runActive
											? "todoPane.codexCurrentTodo"
											: "todoPane.codexOpenTodo",
										{ seq: current.seq, title: current.title },
									)
								: t("todoPane.noActiveTodo")}
						</p>
					</div>
					<span className="nightworkers-todo-pane-count shrink-0 px-1 py-0.5 font-mono text-xs">
						{completedCount}/{props.items.length}
					</span>
				</div>
			</div>
			<div className="nightworkers-todo-list-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
				<TodoRailList
					items={props.items.map((item, index) => ({
						id: item.id,
						seq: item.seq,
						title: item.title,
						status: item.completed
							? "passed"
							: props.runActive && index === firstOpenIndex
								? "running"
								: "pending",
						activeLabel:
							props.runActive && index === firstOpenIndex ? "Codex" : null,
					}))}
				/>
			</div>
		</aside>
	);
}
