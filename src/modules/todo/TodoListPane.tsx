import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TaskRunTodo } from "../nightworkers/types";
import { TodoRailList } from "./TodoRailList";

type TodoListPaneProps = {
	todos: TaskRunTodo[];
	isResuming?: boolean;
	onResume?: (
		todoId: string,
		expectedTodoRevision: number,
		userContext: string,
	) => Promise<void>;
};

export function TodoListPane({
	todos,
	isResuming = false,
	onResume,
}: TodoListPaneProps) {
	const { t } = useTranslation();
	const [userContext, setUserContext] = useState("");
	const [resumeError, setResumeError] = useState<string | null>(null);
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
	const canResume = Boolean(
		blockedTodo && onResume && userContext.trim() && !isResuming,
	);
	const submitResume = async () => {
		if (!blockedTodo || !onResume || !canResume) return;
		setResumeError(null);
		try {
			await onResume(blockedTodo.id, blockedTodo.revision, userContext.trim());
			setUserContext("");
		} catch (error) {
			setResumeError(error instanceof Error ? error.message : String(error));
		}
	};

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
				{blockedTodo && onResume ? (
					<div className="mt-3 rounded border border-amber-500/40 bg-amber-950/20 p-2">
						<label
							htmlFor={`todo-resume-${blockedTodo.id}`}
							className="block text-xs font-medium text-amber-100"
						>
							{t("todoPane.resumeLabel")}
						</label>
						<p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-amber-200/80">
							{blockedTodo.statusReason || t("todoPane.resumeDescription")}
						</p>
						<textarea
							id={`todo-resume-${blockedTodo.id}`}
							value={userContext}
							onChange={(event) => setUserContext(event.target.value)}
							maxLength={20_000}
							rows={4}
							placeholder={t("todoPane.resumePlaceholder")}
							className="mt-2 w-full resize-y rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-500"
						/>
						{resumeError ? (
							<p className="mt-1 break-words text-xs text-red-300">
								{resumeError}
							</p>
						) : null}
						<button
							type="button"
							disabled={!canResume}
							onClick={() => void submitResume()}
							className="nightworkers-primary-action-button mt-2 inline-flex h-8 items-center justify-center rounded px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
						>
							{isResuming ? t("todoPane.resuming") : t("todoPane.resumeAction")}
						</button>
					</div>
				) : null}
			</div>
		</aside>
	);
}

function todoInstructionPreview(todo: TaskRunTodo) {
	const candidates = [todo.statusReason, todo.description].map((value) =>
		typeof value === "string" ? value.trim() : "",
	);
	const source = candidates.find(Boolean);
	if (!source) return null;
	return source.replace(/\s+/g, " ");
}
