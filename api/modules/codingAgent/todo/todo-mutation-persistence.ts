import { and, asc, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { DbTransaction, db } from "../../../db/client";
import { taskRuns, taskRunTodos } from "../../../db/schema";
import type { TodoMutationErrorCode } from "./types";

export type TodoRow = typeof taskRunTodos.$inferSelect;
export type RunRow = typeof taskRuns.$inferSelect;

export const MUTABLE_RUN_STATUSES: Array<RunRow["status"]> = [
	"running",
	"context_compiling",
	"needs_human",
];

export class TodoMutationAbort extends Error {
	constructor(readonly code: TodoMutationErrorCode) {
		super(code);
	}
}

export async function listTodos(
	database: Pick<typeof db, "select">,
	runId: string,
): Promise<TodoRow[]> {
	return database
		.select()
		.from(taskRunTodos)
		.where(eq(taskRunTodos.runId, runId))
		.orderBy(asc(taskRunTodos.seq));
}

export async function lockMutableRun(tx: DbTransaction, runId: string) {
	const [run] = await tx
		.update(taskRuns)
		.set({ updatedAt: new Date() })
		.where(
			and(
				eq(taskRuns.id, runId),
				inArray(taskRuns.status, MUTABLE_RUN_STATUSES),
			),
		)
		.returning({ id: taskRuns.id });
	return Boolean(run);
}

export async function updateTodoCas(
	tx: DbTransaction,
	todo: TodoRow,
	data: Omit<Partial<typeof taskRunTodos.$inferInsert>, "attemptCount"> & {
		attemptCount?: number | SQL;
	},
) {
	const [updated] = await tx
		.update(taskRunTodos)
		.set({
			...data,
			revision: sql`${taskRunTodos.revision} + 1`,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(taskRunTodos.id, todo.id),
				eq(taskRunTodos.runId, todo.runId),
				eq(taskRunTodos.revision, todo.revision),
			),
		)
		.returning();
	if (!updated) throw new TodoMutationAbort("TODO_REVISION_CONFLICT");
	return updated;
}
