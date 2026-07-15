import type { taskRuns } from "../../db/schema";

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
export function isSqliteUniqueConstraintError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return (
		message.includes("SQLITE_CONSTRAINT") ||
		message.includes("UNIQUE constraint failed")
	);
}
