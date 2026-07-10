import type * as repo from "../../../modules/nightworkers/nightworkers.repository";
import type {
	NativeApiDispatchResult,
	NativeApiDispatchState,
} from "./native-api-dispatch-types";
import type { NativeApiToolResult } from "./native-api-tool-history";
import { capNativeApiToolResultContent } from "./native-api-tool-result-projector";

export function continueWith(
	toolResult: NativeApiToolResult,
	state: NativeApiDispatchState,
): NativeApiDispatchResult {
	return { kind: "continue", toolResult, state };
}

export function failedToolResult(
	code: string,
	message: string,
	payload?: unknown,
): NativeApiToolResult {
	return capNativeApiToolResultContent({
		ok: false,
		content: JSON.stringify({ ok: false, error: { code, message }, payload }),
		...(payload !== undefined ? { payload } : {}),
		error: { code, message },
	});
}

export function openTodosRemainToolResult(
	openTodos: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>,
): NativeApiToolResult {
	const openTodoSummaries = [...openTodos]
		.sort((a, b) => a.seq - b.seq)
		.map((todo) => ({
			seq: todo.seq,
			title: todo.title,
			status: todo.status,
			taskType: todo.taskType,
			procedureId: todo.procedureId ?? null,
		}));
	const running = openTodoSummaries.find((todo) => todo.status === "running");
	const pending = openTodoSummaries.find((todo) => todo.status === "pending");
	const nextAction = running
		? {
				operation: "done",
				seq: running.seq,
				example: `todo_list operation=done seq=${running.seq}`,
				alternatives: ["block", "fail"],
			}
		: pending
			? {
					operation: "start",
					seq: pending.seq,
					example: `todo_list operation=start seq=${pending.seq}`,
					alternatives: ["block", "fail"],
				}
			: null;
	const message = [
		`finalize_answer is blocked because open Todos remain: ${openTodoSummaries
			.map((todo) => todo.seq)
			.join(", ")}`,
		nextAction
			? `Next Todo action hint: call ${nextAction.example}. Use block/fail instead if the Todo cannot be completed.`
			: "Use todo_list done/block/fail to close the remaining open Todos before finalize_answer.",
	].join(" ");
	return capNativeApiToolResultContent({
		ok: false,
		content: JSON.stringify({
			ok: false,
			error: { code: "OPEN_TODOS_REMAIN", message },
			openTodos: openTodoSummaries,
			nextAction,
		}),
		payload: { openTodos: openTodoSummaries, nextAction },
		error: {
			code: "OPEN_TODOS_REMAIN",
			message,
			details: { openTodos: openTodoSummaries, nextAction },
		},
	});
}
