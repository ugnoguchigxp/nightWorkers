import { and, asc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { withSqliteBusyRetry } from "../../db/retry";
import { taskRuns, taskRunTodos } from "../../db/schema";
import { nightWorkersRealtimeBroker } from "../realtime/nightworkers-ws";
import {
	todoMutationErrorMessage,
	validateTodoMutationCommand,
} from "./todo-mutation-contract";
import type {
	CodingAgentSystemContextSnapshot,
	TodoCreatedBy,
	TodoMutationCommand,
	TodoMutationErrorCode,
	TodoMutationResult,
} from "./types";

type TodoRow = typeof taskRunTodos.$inferSelect;
type RunRow = typeof taskRuns.$inferSelect;

const NEW_RUNTIME_TERMINAL_STATUSES = ["passed", "skipped"] as const;
const REPLACEABLE_TODO_STATUSES = ["pending", "running"] as const;
const MUTABLE_RUN_STATUSES: Array<RunRow["status"]> = [
	"running",
	"context_compiling",
	"needs_human",
];

class TodoMutationAbort extends Error {
	constructor(readonly code: TodoMutationErrorCode) {
		super(code);
	}
}

export class TodoMutationService {
	constructor(
		private readonly systemContext: CodingAgentSystemContextSnapshot,
		private readonly createdBy: Exclude<TodoCreatedBy, "migration">,
	) {}

	async execute(
		runId: string,
		command: TodoMutationCommand,
	): Promise<TodoMutationResult<TodoRow>> {
		const normalizedRunId = runId.trim();
		if (!normalizedRunId) {
			return this.failure("RUN_NOT_FOUND", 0, []);
		}

		const inputError = validateTodoMutationCommand(command);
		if (inputError) {
			return this.loadFailure(normalizedRunId, inputError);
		}

		try {
			const result = await withSqliteBusyRetry(() =>
				db.transaction(async (tx) => {
					const [run] = await tx
						.select()
						.from(taskRuns)
						.where(eq(taskRuns.id, normalizedRunId));
					if (!run) return this.failure("RUN_NOT_FOUND", 0, []);

					if (command.op === "replace_plan") {
						return this.replacePlan(tx, run, command);
					}
					if (!(await lockMutableRun(tx, run.id))) {
						return this.failure(
							"RUN_NOT_MUTABLE",
							run.todoPlanRevision,
							await listTodos(tx, run.id),
						);
					}

					const todos = await listTodos(tx, run.id);
					const target = todos.find((todo) => todo.id === command.todoId);
					if (!target) {
						return this.failure("TODO_NOT_FOUND", run.todoPlanRevision, todos);
					}
					if (target.revision !== command.expectedTodoRevision) {
						return this.failure(
							"TODO_REVISION_CONFLICT",
							run.todoPlanRevision,
							todos,
						);
					}

					switch (command.op) {
						case "start":
							return this.start(tx, run, todos, target);
						case "resume":
							return this.resume(tx, run, todos, target, command.userContext);
						case "transition":
							return this.transition(tx, run, todos, target, command);
						case "record_failure":
							return this.recordFailure(tx, run, todos, target, command);
						case "update_context":
							return this.updateContext(tx, run, todos, target, command);
					}
				}),
			);

			if (result.ok) await publishMutation(result.todos, normalizedRunId);
			return result;
		} catch (error) {
			const code =
				error instanceof TodoMutationAbort
					? error.code
					: isUniqueConstraintError(error)
						? "CURRENT_TODO_EXISTS"
						: "TODO_MUTATION_CONFLICT";
			return this.loadFailure(normalizedRunId, code);
		}
	}

	private async replacePlan(
		tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
		run: RunRow,
		command: Extract<TodoMutationCommand, { op: "replace_plan" }>,
	): Promise<TodoMutationResult<TodoRow>> {
		const current = await listTodos(tx, run.id);
		if (run.todoPlanRevision !== command.expectedPlanRevision) {
			return this.failure(
				"TODO_PLAN_REVISION_CONFLICT",
				run.todoPlanRevision,
				current,
			);
		}

		const materialized = command.todos.map((todo) => ({
			...todo,
			id: todo.id ?? crypto.randomUUID(),
		}));
		const ids = materialized.map((todo) => todo.id);
		if (new Set(ids).size !== ids.length) {
			return this.failure("TODO_ID_DUPLICATED", run.todoPlanRevision, current);
		}

		const preservedTodos = current.filter(
			(todo) =>
				!(REPLACEABLE_TODO_STATUSES as readonly string[]).includes(todo.status),
		);
		const preservedIds = new Set(preservedTodos.map((todo) => todo.id));
		if (ids.some((id) => preservedIds.has(id))) {
			return this.failure(
				"TODO_TERMINAL_REOPEN_FORBIDDEN",
				run.todoPlanRevision,
				current,
			);
		}
		const availableIds = new Set([...preservedIds, ...ids]);
		if (
			materialized.some((todo) =>
				(todo.dependsOn ?? []).some(
					(dependencyId) => !availableIds.has(dependencyId),
				),
			)
		) {
			return this.failure(
				"TODO_DEPENDENCY_NOT_FOUND",
				run.todoPlanRevision,
				current,
			);
		}
		if (hasDependencyCycle(materialized)) {
			return this.failure(
				"TODO_DEPENDENCY_CYCLE",
				run.todoPlanRevision,
				current,
			);
		}

		const [updatedRun] = await tx
			.update(taskRuns)
			.set({
				todoPlanRevision: sql`${taskRuns.todoPlanRevision} + 1`,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(taskRuns.id, run.id),
					eq(taskRuns.todoPlanRevision, command.expectedPlanRevision),
					inArray(taskRuns.status, MUTABLE_RUN_STATUSES),
				),
			)
			.returning();
		if (!updatedRun) {
			const [latest] = await tx
				.select({ status: taskRuns.status })
				.from(taskRuns)
				.where(eq(taskRuns.id, run.id));
			throw new TodoMutationAbort(
				latest && !MUTABLE_RUN_STATUSES.includes(latest.status)
					? "RUN_NOT_MUTABLE"
					: "TODO_PLAN_REVISION_CONFLICT",
			);
		}

		const openIds = current
			.filter((todo) => !preservedIds.has(todo.id))
			.map((todo) => todo.id);
		if (openIds.length > 0) {
			await tx.delete(taskRunTodos).where(inArray(taskRunTodos.id, openIds));
		}

		const previousById = new Map(current.map((todo) => [todo.id, todo]));
		const firstSeq = preservedTodos.reduce(
			(maximum, todo) => Math.max(maximum, todo.seq),
			0,
		);
		for (const [index, todo] of materialized.entries()) {
			const previous = previousById.get(todo.id);
			await tx.insert(taskRunTodos).values({
				id: todo.id,
				runId: run.id,
				seq: firstSeq + index + 1,
				title: todo.title.trim(),
				description: todo.objective?.trim() || null,
				objective: todo.objective?.trim() || null,
				context: todo.context?.trim() || null,
				nextAction: todo.nextAction.trim(),
				acceptanceCriteriaJson: todo.acceptanceCriteria ?? [],
				taskType: "coding",
				status: "pending",
				dependsOn: todo.dependsOn ?? [],
				systemContextVersion: this.systemContext.version,
				systemContextSnapshot: this.systemContext,
				contextSnapshot: this.systemContext,
				createdBy: previous?.createdBy ?? this.createdBy,
				revision: (previous?.revision ?? -1) + 1,
				createdAt: previous?.createdAt,
			});
		}

		const todos = await listTodos(tx, run.id);
		return this.success(updatedRun.todoPlanRevision, todos);
	}

	private async start(
		tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
		run: RunRow,
		todos: TodoRow[],
		target: TodoRow,
	) {
		if (target.status !== "pending") {
			return this.failure("TODO_NOT_STARTABLE", run.todoPlanRevision, todos);
		}
		if (hasOtherCurrentTodo(todos)) {
			return this.failure("CURRENT_TODO_EXISTS", run.todoPlanRevision, todos);
		}
		if (!dependenciesAreTerminal(target, todos)) {
			return this.failure("TODO_DEPENDENCY_OPEN", run.todoPlanRevision, todos);
		}
		await updateTodoCas(tx, target, {
			status: "running",
			startedAt: new Date(),
			completedAt: null,
			statusReason: null,
		});
		return this.success(run.todoPlanRevision, await listTodos(tx, run.id));
	}

	private async resume(
		tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
		run: RunRow,
		todos: TodoRow[],
		target: TodoRow,
		userContext: string,
	) {
		if (target.status !== "needs_human") {
			return this.failure("TODO_NOT_RESUMABLE", run.todoPlanRevision, todos);
		}
		if (hasOtherCurrentTodo(todos, target.id)) {
			return this.failure("CURRENT_TODO_EXISTS", run.todoPlanRevision, todos);
		}
		const appendedContext = [
			target.context?.trim(),
			`ユーザー回答:\n${userContext.trim()}`,
		]
			.filter(Boolean)
			.join("\n\n");
		await updateTodoCas(tx, target, {
			status: "running",
			context: appendedContext,
			statusReason: null,
			completedAt: null,
			startedAt: target.startedAt ?? new Date(),
		});
		if (run.status === "needs_human") {
			const [resumedRun] = await tx
				.update(taskRuns)
				.set({
					status: "running",
					endedAt: null,
					finishedAt: null,
					summary: null,
					finalReport: null,
					finalJudgment: null,
					updatedAt: new Date(),
				})
				.where(and(eq(taskRuns.id, run.id), eq(taskRuns.status, "needs_human")))
				.returning({ id: taskRuns.id });
			if (!resumedRun) throw new TodoMutationAbort("RUN_NOT_MUTABLE");
		}
		return this.success(run.todoPlanRevision, await listTodos(tx, run.id));
	}

	private async transition(
		tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
		run: RunRow,
		todos: TodoRow[],
		target: TodoRow,
		command: Extract<TodoMutationCommand, { op: "transition" }>,
	) {
		const maySkip = command.status === "skipped" && target.status === "pending";
		if (target.status !== "running" && !maySkip) {
			const code = (
				NEW_RUNTIME_TERMINAL_STATUSES as readonly string[]
			).includes(target.status)
				? "TODO_TERMINAL_REOPEN_FORBIDDEN"
				: "TODO_NOT_RUNNING";
			return this.failure(code, run.todoPlanRevision, todos);
		}
		if (command.status === "needs_human" && command.nextTodoId) {
			return this.failure("INVALID_TODO_COMMAND", run.todoPlanRevision, todos);
		}

		const next = command.nextTodoId
			? todos.find((todo) => todo.id === command.nextTodoId)
			: null;
		if (command.nextTodoId && !next) {
			return this.failure("TODO_NOT_FOUND", run.todoPlanRevision, todos);
		}
		if (next && next.status !== "pending") {
			return this.failure("TODO_NOT_STARTABLE", run.todoPlanRevision, todos);
		}
		if (next && !dependenciesAreTerminal(next, todos, target.id)) {
			return this.failure("TODO_DEPENDENCY_OPEN", run.todoPlanRevision, todos);
		}
		if (next?.id === target.id) {
			return this.failure("INVALID_TODO_COMMAND", run.todoPlanRevision, todos);
		}
		if (next && hasOtherCurrentTodo(todos, target.id)) {
			return this.failure("CURRENT_TODO_EXISTS", run.todoPlanRevision, todos);
		}

		const now = new Date();
		await updateTodoCas(tx, target, {
			status: command.status,
			statusReason: command.reason.trim(),
			completedAt: command.status === "needs_human" ? null : now,
			startedAt: target.startedAt ?? now,
		});
		if (next) {
			await updateTodoCas(tx, next, {
				status: "running",
				startedAt: now,
				completedAt: null,
				statusReason: null,
			});
		}
		return this.success(run.todoPlanRevision, await listTodos(tx, run.id));
	}

	private async recordFailure(
		tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
		run: RunRow,
		todos: TodoRow[],
		target: TodoRow,
		command: Extract<TodoMutationCommand, { op: "record_failure" }>,
	) {
		if (target.status !== "running") {
			return this.failure("TODO_NOT_RUNNING", run.todoPlanRevision, todos);
		}
		await updateTodoCas(tx, target, {
			lastFailure: command.failureSummary.trim(),
			nextAction: command.nextAction.trim(),
			attemptCount: sql`${taskRunTodos.attemptCount} + 1`,
		});
		return this.success(run.todoPlanRevision, await listTodos(tx, run.id));
	}

	private async updateContext(
		tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
		run: RunRow,
		todos: TodoRow[],
		target: TodoRow,
		command: Extract<TodoMutationCommand, { op: "update_context" }>,
	) {
		if (target.status !== "running") {
			return this.failure("TODO_NOT_RUNNING", run.todoPlanRevision, todos);
		}
		await updateTodoCas(tx, target, {
			context: command.context.trim(),
			nextAction: command.nextAction.trim(),
		});
		return this.success(run.todoPlanRevision, await listTodos(tx, run.id));
	}

	private success(planRevision: number, todos: TodoRow[]) {
		return {
			ok: true as const,
			planRevision,
			todos,
			currentTodo: uniqueCurrentTodo(todos),
		};
	}

	private failure(
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

	private async loadFailure(runId: string, code: TodoMutationErrorCode) {
		const [run] = await db
			.select()
			.from(taskRuns)
			.where(eq(taskRuns.id, runId));
		if (!run) return this.failure("RUN_NOT_FOUND", 0, []);
		const todos = await listTodos(db, runId);
		return this.failure(code, run.todoPlanRevision, todos);
	}
}

async function listTodos(
	database: Pick<typeof db, "select">,
	runId: string,
): Promise<TodoRow[]> {
	return database
		.select()
		.from(taskRunTodos)
		.where(eq(taskRunTodos.runId, runId))
		.orderBy(asc(taskRunTodos.seq));
}

async function lockMutableRun(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	runId: string,
) {
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

async function updateTodoCas(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
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

function uniqueCurrentTodo(todos: TodoRow[]) {
	const running = todos.filter((todo) => todo.status === "running");
	return running.length === 1 ? running[0] : null;
}

function hasOtherCurrentTodo(todos: TodoRow[], excludingId?: string) {
	return todos.some(
		(todo) =>
			todo.id !== excludingId &&
			(todo.status === "running" || todo.status === "needs_human"),
	);
}

function dependenciesAreTerminal(
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

function hasDependencyCycle(
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

function isUniqueConstraintError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes("UNIQUE constraint failed");
}

async function publishMutation(todos: TodoRow[], runId: string) {
	try {
		const [run] = await db
			.select()
			.from(taskRuns)
			.where(eq(taskRuns.id, runId));
		if (!run) return;
		nightWorkersRealtimeBroker.publish(run.taskId, {
			type: "task_run_updated",
			runId,
			payload: { run, todos },
		});
	} catch {
		// 永続化済みのTodo mutationをrealtime通知失敗で失敗扱いにしない。
	}
}
