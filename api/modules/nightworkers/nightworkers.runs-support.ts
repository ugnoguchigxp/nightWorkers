import type { taskRuns, taskRunTodos } from "../../db/schema";

export const TERMINAL_TODO_STATUSES = [
	"passed",
	"failed",
	"needs_human",
	"skipped",
] as const;
export const OPEN_TODO_STATUSES = ["pending", "running"] as const;

export type TaskRunTodoRow = typeof taskRunTodos.$inferSelect;
export type TaskRunRow = typeof taskRuns.$inferSelect;
export type TaskRunUpdatedListener = (run: TaskRunRow) => Promise<void> | void;
const taskRunUpdatedListeners = new Set<TaskRunUpdatedListener>();

export function registerTaskRunUpdatedListener(
	listener: TaskRunUpdatedListener,
) {
	taskRunUpdatedListeners.add(listener);
	return () => taskRunUpdatedListeners.delete(listener);
}

export async function notifyTaskRunUpdatedListeners(run: TaskRunRow) {
	await Promise.allSettled(
		[...taskRunUpdatedListeners].map((listener) => listener(run)),
	);
}
export type ReplaceTaskRunTodoInput = {
	seq: number;
	title: string;
	description?: string | null;
	taskType: string;
	status?: string;
	procedureId?: string | null;
	procedureSnapshot?: unknown;
	contextSnapshot?: unknown;
	completionGateResult?: unknown;
	evidenceRequirementsJson?: unknown;
	evidenceRequirements?: unknown;
	evidenceRefsJson?: string[] | null;
	dependsOn?: Array<string | number> | null;
	statusReason?: string | null;
	startedAt?: Date | null;
	completedAt?: Date | null;
};

export function isTerminalTodoStatus(status: string) {
	return (TERMINAL_TODO_STATUSES as readonly string[]).includes(status);
}

export function isOpenTodoStatus(status: string) {
	return (OPEN_TODO_STATUSES as readonly string[]).includes(status);
}

export function shouldAutoStartReplacementTodo(todo: TaskRunTodoRow) {
	return (
		todo.status === "pending" &&
		!["knowledge_capture", "completion_report"].includes(todo.taskType)
	);
}

export function normalizeReplacementTodoInput(
	runId: string,
	todo: ReplaceTaskRunTodoInput,
) {
	return {
		runId,
		seq: todo.seq,
		title: todo.title,
		description: todo.description ?? null,
		taskType: todo.taskType,
		status: todo.status ?? "pending",
		procedureId: todo.procedureId ?? null,
		procedureSnapshot: todo.procedureSnapshot ?? null,
		contextSnapshot: todo.contextSnapshot ?? null,
		completionGateResult: todo.completionGateResult ?? null,
		evidenceRequirementsJson:
			todo.evidenceRequirementsJson ?? todo.evidenceRequirements ?? null,
		evidenceRefsJson: todo.evidenceRefsJson ?? [],
		dependsOn: todo.dependsOn ?? [],
		statusReason: todo.statusReason ?? null,
		startedAt: todo.startedAt ?? null,
		completedAt: todo.completedAt ?? null,
	};
}

export function isSqliteUniqueConstraintError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return (
		message.includes("SQLITE_CONSTRAINT") ||
		message.includes("UNIQUE constraint failed")
	);
}
