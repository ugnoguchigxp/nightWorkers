import { and, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "../../../db/client";
import { taskRuns, taskRunTodos } from "../../../db/schema";
import { buildCanonicalTodoId } from "./todo-identity";
import { todoMutationErrorMessage } from "./todo-mutation-contract";
import {
	listTodos,
	lockMutableRun,
	MUTABLE_RUN_STATUSES,
	type RunRow,
	TodoMutationAbort,
	type TodoRow,
	updateTodoCas,
} from "./todo-mutation-persistence";
import { uniqueCurrentTodo } from "./todo-state";
import type {
	CodingAgentSystemContextSnapshot,
	TodoCreatedBy,
	TodoMutationErrorCode,
	TodoMutationResult,
} from "./types";

type MinimalStep = { title: string; systemContext: string };
type MutationContext = {
	systemContext: CodingAgentSystemContextSnapshot;
	createdBy: Exclude<TodoCreatedBy, "migration">;
};

export async function createInitialPlan(
	tx: DbTransaction,
	run: RunRow,
	steps: MinimalStep[],
	context: MutationContext,
): Promise<TodoMutationResult<TodoRow>> {
	const current = await listTodos(tx, run.id);
	if (current.length > 0 || run.todoPlanRevision !== 0) {
		return failure(
			"TODO_PLAN_REVISION_CONFLICT",
			run.todoPlanRevision,
			current,
		);
	}
	const [updatedRun] = await tx
		.update(taskRuns)
		.set({ todoPlanRevision: 1, updatedAt: new Date() })
		.where(
			and(
				eq(taskRuns.id, run.id),
				eq(taskRuns.todoPlanRevision, 0),
				inArray(taskRuns.status, MUTABLE_RUN_STATUSES),
			),
		)
		.returning();
	if (!updatedRun) throw new TodoMutationAbort("TODO_PLAN_REVISION_CONFLICT");
	const now = new Date();
	for (const [index, step] of steps.entries()) {
		await insertStep(tx, {
			runId: run.id,
			todoKey: `step-${index + 1}`,
			seq: index + 1,
			step,
			status: index === 0 ? "running" : "pending",
			startedAt: index === 0 ? now : null,
			context,
		});
	}
	return success(1, await listTodos(tx, run.id));
}

export async function replaceRemainingPlan(
	tx: DbTransaction,
	run: RunRow,
	steps: MinimalStep[],
	context: MutationContext,
): Promise<TodoMutationResult<TodoRow>> {
	if (!(await lockMutableRun(tx, run.id))) {
		return failure(
			"RUN_NOT_MUTABLE",
			run.todoPlanRevision,
			await listTodos(tx, run.id),
		);
	}
	const current = await listTodos(tx, run.id);
	const pendingIds = current
		.filter((todo) => todo.status === "pending")
		.map((todo) => todo.id);
	if (pendingIds.length > 0) {
		await tx.delete(taskRunTodos).where(inArray(taskRunTodos.id, pendingIds));
	}
	const preserved = current.filter((todo) => todo.status !== "pending");
	const hasOpenTodo = preserved.some(
		(todo) => todo.status === "running" || todo.status === "needs_human",
	);
	const nextRevision = run.todoPlanRevision + 1;
	const [updatedRun] = await tx
		.update(taskRuns)
		.set({ todoPlanRevision: nextRevision, updatedAt: new Date() })
		.where(
			and(
				eq(taskRuns.id, run.id),
				eq(taskRuns.todoPlanRevision, run.todoPlanRevision),
				inArray(taskRuns.status, MUTABLE_RUN_STATUSES),
			),
		)
		.returning();
	if (!updatedRun) throw new TodoMutationAbort("TODO_PLAN_REVISION_CONFLICT");
	const firstSeq = preserved.reduce(
		(maximum, todo) => Math.max(maximum, todo.seq),
		0,
	);
	const now = new Date();
	for (const [index, step] of steps.entries()) {
		const startsNow = !hasOpenTodo && index === 0;
		await insertStep(tx, {
			runId: run.id,
			todoKey: `plan-${nextRevision}-step-${index + 1}`,
			seq: firstSeq + index + 1,
			step,
			status: startsNow ? "running" : "pending",
			startedAt: startsNow ? now : null,
			context,
		});
	}
	return success(nextRevision, await listTodos(tx, run.id));
}

export async function completeCurrent(
	tx: DbTransaction,
	run: RunRow,
	todos: TodoRow[],
	note?: string,
): Promise<TodoMutationResult<TodoRow>> {
	const current = uniqueCurrentTodo(todos);
	if (current?.status !== "running") {
		return failure("TODO_NOT_RUNNING", run.todoPlanRevision, todos);
	}
	const next = todos.find((todo) => todo.status === "pending") ?? null;
	const now = new Date();
	await updateTodoCas(tx, current, {
		status: "passed",
		statusReason: note?.trim() || null,
		completedAt: now,
	});
	if (next) {
		await updateTodoCas(tx, next, {
			status: "running",
			statusReason: null,
			startedAt: now,
		});
	}
	return success(run.todoPlanRevision, await listTodos(tx, run.id));
}

export async function blockCurrent(
	tx: DbTransaction,
	run: RunRow,
	todos: TodoRow[],
	reason: string,
): Promise<TodoMutationResult<TodoRow>> {
	const current = uniqueCurrentTodo(todos);
	if (current?.status !== "running") {
		return failure("TODO_NOT_RUNNING", run.todoPlanRevision, todos);
	}
	await updateTodoCas(tx, current, {
		status: "needs_human",
		statusReason: reason.trim(),
		completedAt: null,
	});
	return success(run.todoPlanRevision, await listTodos(tx, run.id));
}

async function insertStep(
	tx: DbTransaction,
	input: {
		runId: string;
		todoKey: string;
		seq: number;
		step: MinimalStep;
		status: "pending" | "running";
		startedAt: Date | null;
		context: MutationContext;
	},
) {
	await tx.insert(taskRunTodos).values({
		id: buildCanonicalTodoId(input.runId, input.todoKey),
		runId: input.runId,
		todoKey: input.todoKey,
		seq: input.seq,
		title: input.step.title.trim(),
		description: null,
		objective: null,
		context: input.step.systemContext.trim(),
		nextAction: input.step.systemContext.trim(),
		acceptanceCriteriaJson: [],
		taskType: "coding",
		status: input.status,
		dependsOn: [],
		systemContextVersion: input.context.systemContext.version,
		systemContextSnapshot: input.context.systemContext,
		contextSnapshot: input.context.systemContext,
		createdBy: input.context.createdBy,
		revision: 0,
		startedAt: input.startedAt,
	});
}

function success(
	planRevision: number,
	todos: TodoRow[],
): TodoMutationResult<TodoRow> {
	return {
		ok: true,
		planRevision,
		todos,
		currentTodo: uniqueCurrentTodo(todos),
	};
}

function failure(
	code: TodoMutationErrorCode,
	planRevision: number,
	todos: TodoRow[],
): TodoMutationResult<TodoRow> {
	return {
		ok: false,
		error: { code, message: todoMutationErrorMessage(code) },
		planRevision,
		todos,
		currentTodo: uniqueCurrentTodo(todos),
	};
}
