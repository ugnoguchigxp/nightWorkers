import type * as repo from "../../modules/nightworkers/nightworkers.repository";
import type {
	TodoActionPayload,
	TodoActionTransition,
	TodoListOperation,
	TodoListPayloadTodo,
	TodoListReplaceReason,
	TodoMutationContext,
	TodoToolName,
} from "./todo-list";
import type { WorkerToolResult } from "./types";

export function okTodoAction(
	action: TodoToolName,
	operation: TodoListOperation,
	runId: string,
	taskId: string,
	todos: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>,
	options: {
		transition?: TodoActionTransition;
	} = {},
): WorkerToolResult<TodoActionPayload> {
	const currentTodo = todos.find((todo) => todo.status === "running") ?? null;
	const nextTodo = todos.find((todo) => todo.status === "pending") ?? null;
	return {
		ok: true,
		toolName: action,
		startedAt: new Date().toISOString(),
		finishedAt: new Date().toISOString(),
		payload: {
			runId,
			taskId,
			action,
			operation,
			todos: todos.map(toPayloadTodo),
			currentTodo: currentTodo ? toPayloadTodo(currentTodo) : null,
			nextTodo: nextTodo ? toPayloadTodo(nextTodo) : null,
			transition: options.transition,
		},
	};
}

export function failedTodoAction(
	context: TodoMutationContext,
	action: TodoToolName,
	operation: TodoListOperation,
	errorCode: string,
	attemptedAction: {
		seq?: number;
		todoListReplaceReason?: TodoListReplaceReason;
	},
): WorkerToolResult<TodoActionPayload> {
	return failedTodoActionResult(
		new Date().toISOString(),
		action,
		operation,
		context.runId,
		context.taskId,
		errorCode,
		context.todos,
		attemptedAction,
	);
}

export function failedTodoActionResult(
	startedAt: string,
	action: TodoToolName,
	operation: TodoListOperation,
	runId: string,
	taskId: string,
	errorCode: string,
	todos: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>> = [],
	attemptedAction: {
		seq?: number;
		todoListReplaceReason?: TodoListReplaceReason;
	} = {},
): WorkerToolResult<TodoActionPayload> {
	const runningTodos = todos.filter((todo) => todo.status === "running");
	return {
		ok: false,
		toolName: action,
		startedAt,
		finishedAt: new Date().toISOString(),
		payload: {
			runId,
			taskId,
			action,
			operation,
			todos: todos.map(toPayloadTodo),
			currentTodo:
				runningTodos.length === 1 ? toPayloadTodo(runningTodos[0]) : null,
			nextTodo: null,
			diagnostics: {
				errorCode,
				attemptedAction: { action, operation, ...attemptedAction },
				currentSnapshot: {
					runningCount: runningTodos.length,
					runningSeqs: runningTodos.map((todo) => todo.seq),
					pendingSeqs: todos
						.filter((todo) => todo.status === "pending")
						.map((todo) => todo.seq),
				},
			},
		},
		error: {
			code: errorCode,
			message: buildErrorMessage(action, errorCode),
		},
	};
}

export function buildErrorMessage(action: TodoToolName, errorCode: string) {
	if (errorCode === "INVALID_TOOL_ARGS")
		return `${action} requires valid arguments.`;
	if (errorCode === "RUN_NOT_FOUND") return "Run context not found.";
	if (errorCode === "CURRENT_TODO_MISSING")
		return "No running Todo exists for the current run.";
	if (errorCode === "CURRENT_TODO_NOT_UNIQUE")
		return "Multiple running Todos exist; current Todo is not unique.";
	if (errorCode === "TODO_SEQ_NOT_FOUND")
		return "Requested Todo seq was not found.";
	if (errorCode === "TODO_NOT_STARTABLE")
		return "Requested Todo is already closed and cannot be started.";
	if (errorCode === "PREVIOUS_TODO_OPEN")
		return "Previous Todo is still pending or running; close it before starting a later Todo.";
	if (errorCode === "TODO_LIST_REPLACE_REASON_REQUIRED")
		return "todo_list operation=replace is structural replanning. A running Todo exists, so provide todoListReplaceReason. If the current Todo is complete, use todo_list operation=done seq=<current>.";
	if (errorCode === "INVALID_TODO_LIST_REPLACE_REASON")
		return "todoListReplaceReason must be one of initial_plan, scope_changed, estimate_changed, newly_required_work, or blocked_replan.";
	if (errorCode === "TODO_EVIDENCE_NOT_MET")
		return "Todo completion evidence requirements are not satisfied. Use evidenceRefs returned by NightWorkers tool outcomes.";
	return `${action} failed.`;
}

export function validateTodoListReplaceReason(input: {
	currentTodos: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>;
	todoListReplaceReason?: TodoListReplaceReason;
}): { ok: true } | { ok: false; errorCode: string } {
	if (
		input.todoListReplaceReason !== undefined &&
		!isTodoListReplaceReason(input.todoListReplaceReason)
	) {
		return { ok: false, errorCode: "INVALID_TODO_LIST_REPLACE_REASON" };
	}

	const hasRunningTodo = input.currentTodos.some(
		(todo) => todo.status === "running",
	);
	if (hasRunningTodo && !input.todoListReplaceReason) {
		return { ok: false, errorCode: "TODO_LIST_REPLACE_REASON_REQUIRED" };
	}

	return { ok: true };
}

export function isTodoListReplaceReason(
	value: unknown,
): value is TodoListReplaceReason {
	return (
		value === "initial_plan" ||
		value === "scope_changed" ||
		value === "estimate_changed" ||
		value === "newly_required_work" ||
		value === "blocked_replan"
	);
}

export function resolveCurrentTodo(
	todos: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>,
) {
	const runningTodos = todos.filter((todo) => todo.status === "running");
	if (runningTodos.length === 0) {
		return { ok: false as const, errorCode: "CURRENT_TODO_MISSING" };
	}
	if (runningTodos.length > 1) {
		return { ok: false as const, errorCode: "CURRENT_TODO_NOT_UNIQUE" };
	}
	return { ok: true as const, todo: runningTodos[0] };
}

export function resolveTargetTodo(
	todos: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>,
	seq?: number,
) {
	if (seq === undefined) return resolveCurrentTodo(todos);
	if (!Number.isInteger(seq) || seq < 1) {
		return { ok: false as const, errorCode: "INVALID_TOOL_ARGS" };
	}
	const todo = todos.find((candidate) => candidate.seq === seq);
	if (!todo) return { ok: false as const, errorCode: "TODO_SEQ_NOT_FOUND" };
	if (todo.status !== "running")
		return { ok: false as const, errorCode: "CURRENT_TODO_MISSING" };
	return { ok: true as const, todo };
}

export function currentSeqOrNull(
	todos: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>,
) {
	const current = todos.find((todo) => todo.status === "running");
	return current?.seq ?? null;
}

export function isFinalCloseoutTodo(
	todo: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>[number],
) {
	return (
		(todo.taskType === "knowledge_capture" &&
			todo.procedureId === "contextstill.register_candidates") ||
		(todo.taskType === "completion_report" &&
			todo.procedureId === "final_completion_report") ||
		todo.procedureId === "contextstill_closeout"
	);
}

export function toRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export function toPayloadTodo(
	todo: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>[number],
): TodoListPayloadTodo {
	return {
		id: todo.id,
		seq: todo.seq,
		title: todo.title,
		description: todo.description,
		taskType: todo.taskType,
		status: todo.status,
		procedureId: todo.procedureId,
		dependsOn: todo.dependsOn,
		startedAt: todo.startedAt,
		completedAt: todo.completedAt,
		evidenceRequirementsJson: todo.evidenceRequirementsJson,
		evidenceRefsJson: todo.evidenceRefsJson,
	};
}
