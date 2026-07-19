import type { WorkerToolResult } from "../../../services/worker-tools/types";
import { loadCodingAgentContextPacket } from "../context";
import {
	type TodoMutationCommand,
	type TodoMutationResult,
	TodoMutationService,
} from "../todo";

export type TodoToolName = "todo_list";
export type TodoListOperation = "list" | TodoMutationCommand["op"];
export type TodoListCommand = { op: "list" } | TodoMutationCommand;

export type TodoActionPayload = {
	runId: string;
	action: TodoToolName;
	command: TodoListCommand;
	planRevision: number;
	todos: TodoMutationResult<unknown>["todos"];
	currentTodo: unknown | null;
};

export async function todoListTool(input: {
	runId: string;
	command: TodoListCommand;
	actor?: "agent" | "human";
}): Promise<WorkerToolResult<TodoActionPayload | null>> {
	const startedAt = new Date().toISOString();
	const runId = input.runId?.trim();
	if (!runId || !input.command || typeof input.command.op !== "string") {
		return failed(
			startedAt,
			"INVALID_TOOL_ARGS",
			"Todo commandが不正です。",
			null,
		);
	}

	try {
		const packet = await loadCodingAgentContextPacket(runId);
		if (!packet) {
			return failed(
				startedAt,
				"RUN_NOT_FOUND",
				"対象Runが存在しません。",
				null,
			);
		}
		if (input.command.op === "list") {
			return ok(startedAt, {
				runId,
				action: "todo_list",
				command: input.command,
				planRevision: packet.planSummary.planRevision,
				todos: packet.planSummary.todos,
				currentTodo: packet.currentTodo,
			});
		}

		const result = await new TodoMutationService(
			packet.systemContext,
			input.actor ?? "agent",
		).execute(runId, input.command);
		const payload: TodoActionPayload = {
			runId,
			action: "todo_list",
			command: input.command,
			planRevision: result.planRevision,
			todos: result.todos,
			currentTodo: result.currentTodo,
		};
		return result.ok
			? ok(startedAt, payload)
			: failed(startedAt, result.error.code, result.error.message, payload);
	} catch (error) {
		return failed(
			startedAt,
			"TODO_ACTION_FAILED",
			error instanceof Error ? error.message : String(error),
			null,
		);
	}
}

function ok(
	startedAt: string,
	payload: TodoActionPayload,
): WorkerToolResult<TodoActionPayload> {
	return {
		ok: true,
		toolName: "todo_list",
		startedAt,
		finishedAt: new Date().toISOString(),
		payload,
	};
}

function failed(
	startedAt: string,
	code: string,
	message: string,
	payload: TodoActionPayload | null,
): WorkerToolResult<TodoActionPayload | null> {
	return {
		ok: false,
		toolName: "todo_list",
		startedAt,
		finishedAt: new Date().toISOString(),
		payload,
		error: { code, message },
	};
}
