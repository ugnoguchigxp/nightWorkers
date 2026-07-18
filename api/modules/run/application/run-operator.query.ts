import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../../db/client";
import { taskRuns } from "../../../db/schema";
import { taskRunTodos } from "../../../db/schema-task-execution";
import { digestText } from "../../../services/text-digest";

const activeStatuses = ["running", "context_compiling", "finalizing"] as const;
const terminalStatuses = [
	"completed",
	"failed",
	"cancelled",
	"needs_review",
	"blocked",
	"timed_out",
	"needs_human",
] as const;

export async function readRunOperatorState(taskId: string) {
	const [activeRows, terminalRows] = await Promise.all([
		db
			.select()
			.from(taskRuns)
			.where(
				and(
					eq(taskRuns.taskId, taskId),
					inArray(taskRuns.status, [...activeStatuses]),
				),
			)
			.orderBy(desc(taskRuns.startedAt))
			.limit(1),
		db
			.select()
			.from(taskRuns)
			.where(
				and(
					eq(taskRuns.taskId, taskId),
					inArray(taskRuns.status, [...terminalStatuses]),
				),
			)
			.orderBy(desc(taskRuns.startedAt))
			.limit(1),
	]);
	const active = activeRows[0] ?? null;
	const currentTodo = active
		? await db
				.select()
				.from(taskRunTodos)
				.where(
					and(
						eq(taskRunTodos.runId, active.id),
						inArray(taskRunTodos.status, ["running", "needs_human"]),
					),
				)
				.orderBy(desc(taskRunTodos.updatedAt))
				.limit(1)
				.then((rows) => rows[0] ?? null)
		: null;
	const terminal = terminalRows[0] ?? null;
	return {
		active: active
			? {
					id: active.id,
					revision: active.updatedAt.getTime(),
					status: active.status,
					currentTodo: currentTodo
						? {
								id: currentTodo.id,
								revision: currentTodo.revision,
								status: currentTodo.status,
								blockerDigest: currentTodo.lastFailure
									? digestText(currentTodo.lastFailure)
									: null,
							}
						: null,
				}
			: null,
		terminal: terminal
			? {
					id: terminal.id,
					revision: terminal.updatedAt.getTime(),
					status: terminal.status,
					outcomeDigest: digestText(
						terminal.finalReport ?? terminal.summary ?? terminal.status,
					),
				}
			: null,
	};
}

export async function readRunOperatorOutcome(input: {
	taskId: string;
	runId: string;
}) {
	const [run] = await db
		.select({
			id: taskRuns.id,
			taskId: taskRuns.taskId,
			status: taskRuns.status,
			updatedAt: taskRuns.updatedAt,
			summary: taskRuns.summary,
			finalReport: taskRuns.finalReport,
		})
		.from(taskRuns)
		.where(and(eq(taskRuns.id, input.runId), eq(taskRuns.taskId, input.taskId)))
		.limit(1);
	return run
		? {
				id: run.id,
				revision: run.updatedAt.getTime(),
				status: run.status,
				summary: run.summary,
				finalReport: run.finalReport,
			}
		: null;
}
