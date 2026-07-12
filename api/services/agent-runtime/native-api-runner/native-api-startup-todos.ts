import * as repo from "../../../modules/nightworkers/nightworkers.repository";
import type { todoListTool } from "../../worker-tools/todo-list";
import type { AgentRunContext, AgentRuntimeSink } from "../types";
import type { NativeApiSessionStore } from "./native-api-session-store";
import {
	failedToolResult,
	isFinalCloseoutTodo,
	renderTodoAlignmentHistory,
	successfulTodoAlignment,
} from "./native-api-startup-support";
import type { NativeApiDispatchState } from "./native-api-tool-dispatcher";
import type {
	NativeApiHistoryItem,
	NativeApiToolResult,
} from "./native-api-tool-history";
import { projectWorkerResultToNativeApiToolResult } from "./native-api-tool-result-projector";
export type StartupTodoGateResult = {
	historyItem: NativeApiHistoryItem;
	toolResult: NativeApiToolResult;
};
export type StartupTodoRuntimeHost = {
	store: NativeApiSessionStore;
	mutateTodos: typeof todoListTool;
};

export async function alignTodos(
	runtime: StartupTodoRuntimeHost,
	input: {
		context: AgentRunContext;
		sink: AgentRuntimeSink;
		turnId: string;
		state: NativeApiDispatchState;
	},
): Promise<StartupTodoGateResult> {
	const toolCall = {
		id: `runtime-gate-startup_todo_alignment-${crypto.randomUUID()}`,
		name: "todo_list",
		arguments: { operation: "start", phase: "startup_todo_alignment" },
	};
	const record = await runtime.store.recordToolCallPending({
		runId: input.context.runId,
		taskId: input.context.taskId,
		turnId: input.turnId,
		toolCall,
		source: "runtime_gate",
	});
	await runtime.store.markToolCallRunning({ id: record.id });
	await input.sink.emit({
		type: "tool_call_started",
		message: "[NativeApiRunner] startup Todo alignment started.",
		payload: {
			callId: toolCall.id,
			toolName: "todo_list",
			operation: "startup_alignment",
			phase: "startup_todo_alignment",
		},
	});

	const toolResult = await alignTodoState(runtime, input.context.runId);
	await runtime.store.finishToolCall({
		id: record.id,
		status: toolResult.ok ? "completed" : "failed",
		result: toolResult,
		error: toolResult.error,
		modelVisibleOutput: toolResult.content,
	});
	await input.sink.emit({
		type: "tool_call_finished",
		message: `[NativeApiRunner] startup Todo alignment ${toolResult.ok ? "finished" : "failed"}.`,
		payload: {
			callId: toolCall.id,
			toolName: "todo_list",
			operation: "startup_alignment",
			phase: "startup_todo_alignment",
			status: toolResult.ok ? "completed" : "failed",
			ok: toolResult.ok,
			result: toolResult.payload,
			error: toolResult.error,
		},
	});
	return {
		historyItem: {
			type: "user",
			source: "runtime",
			content: renderTodoAlignmentHistory(toolResult),
		},
		toolResult,
	};
}

export async function alignTodoState(
	runtime: StartupTodoRuntimeHost,
	runId: string,
): Promise<NativeApiToolResult> {
	const todos = await repo.listTaskRunTodosForRun(runId);
	const openStartupGate = todos.find(
		(todo) =>
			["pending", "running"].includes(todo.status) &&
			(todo.taskType === "coding_preparation" ||
				todo.procedureId === "coding_preparation" ||
				todo.procedureId === "contextstill.initial_instructions" ||
				todo.procedureId === "contextstill.context_compile"),
	);
	if (openStartupGate) {
		return failedToolResult(
			"STARTUP_TODO_GATE_OPEN",
			`Startup Todo remains open after runtime gates: seq=${openStartupGate.seq} procedureId=${openStartupGate.procedureId}`,
		);
	}

	const runningTodos = todos.filter((todo) => todo.status === "running");
	if (runningTodos.length > 1) {
		return failedToolResult(
			"CURRENT_TODO_NOT_UNIQUE",
			`Multiple running Todos exist after startup gates: ${runningTodos.map((todo) => todo.seq).join(", ")}`,
		);
	}
	if (runningTodos.length === 1) {
		return successfulTodoAlignment(todos, null);
	}

	const nextOpen = todos
		.filter((todo) => todo.status === "pending" && !isFinalCloseoutTodo(todo))
		.sort((a, b) => a.seq - b.seq)[0];
	if (!nextOpen) {
		return successfulTodoAlignment(todos, null);
	}
	const result = await runtime.mutateTodos({
		runId,
		operation: "start",
		seq: nextOpen.seq,
	});
	if (!result.ok) return projectWorkerResultToNativeApiToolResult(result);
	const refreshed = await repo.listTaskRunTodosForRun(runId);
	return successfulTodoAlignment(refreshed, result.payload);
}

export async function completeProcedureTodo(
	runtime: StartupTodoRuntimeHost,
	runId: string,
	procedureId: string,
) {
	const todos = await repo.listTaskRunTodosForRun(runId);
	const target = todos
		.filter((todo) => todo.procedureId === procedureId)
		.sort((a, b) => a.seq - b.seq)[0];
	if (!target || target.status === "passed") return;
	if (target.status === "pending") {
		const started = await runtime.mutateTodos({
			runId,
			operation: "start",
			seq: target.seq,
		});
		if (!started.ok) return;
	}
	await runtime.mutateTodos({ runId, operation: "done", seq: target.seq });
}

export async function completeCodingPreparationTodo(
	runtime: StartupTodoRuntimeHost,
	runId: string,
) {
	const todos = await repo.listTaskRunTodosForRun(runId);
	const target = todos
		.filter(
			(todo) =>
				todo.taskType === "coding_preparation" ||
				todo.procedureId === "coding_preparation",
		)
		.sort((a, b) => a.seq - b.seq)[0];
	if (!target || target.status === "passed") return;
	if (target.status === "pending") {
		const started = await runtime.mutateTodos({
			runId,
			operation: "start",
			seq: target.seq,
		});
		if (!started.ok) return;
	}
	await runtime.mutateTodos({ runId, operation: "done", seq: target.seq });
}
