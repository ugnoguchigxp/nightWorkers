import type { AgentRunContext, AgentRuntimeSink } from "../types";
import type { NativeApiSessionStore } from "./native-api-session-store";
import type {
	NativeApiHistoryItem,
	NativeApiToolResult,
} from "./native-api-tool-history";
export type StartupFailureRuntimeHost = { store: NativeApiSessionStore };
export type StartupFailureGateResult = {
	historyItem: NativeApiHistoryItem;
	toolResult: NativeApiToolResult;
};
type StartupPhase =
	| "startup_specification"
	| "startup_initial_instructions"
	| "startup_context_compile"
	| "startup_todo_alignment";

export async function runFailedRuntimeGate(
	runtime: StartupFailureRuntimeHost,
	input: {
		phase: StartupPhase;
		toolName: string;
		arguments: Record<string, unknown>;
		context: AgentRunContext;
		sink: AgentRuntimeSink;
		turnId: string;
		error: NativeApiToolResult;
		eventPayload?: Record<string, unknown>;
	},
): Promise<StartupFailureGateResult> {
	const toolCall = {
		id: `runtime-gate-${input.phase}-${crypto.randomUUID()}`,
		name: input.toolName,
		arguments: {
			...input.arguments,
			phase: input.phase,
		},
	};
	const record = await runtime.store.recordToolCallPending({
		runId: input.context.runId,
		taskId: input.context.taskId,
		turnId: input.turnId,
		toolCall,
		todoSeq: input.context.currentTodo?.seq ?? null,
		source: "runtime_gate",
	});
	await runtime.store.markToolCallRunning({ id: record.id });
	await input.sink.emit({
		type: "tool_call_started",
		message: `[NativeApiRunner] ${input.toolName} startup gate started.`,
		payload: {
			callId: toolCall.id,
			toolName: input.toolName,
			phase: input.phase,
			arguments: input.arguments,
			...input.eventPayload,
		},
	});
	await runtime.store.finishToolCall({
		id: record.id,
		status: "failed",
		result: input.error,
		error: input.error.error,
		modelVisibleOutput: input.error.content,
	});
	await input.sink.emit({
		type: "tool_call_finished",
		message: `[NativeApiRunner] ${input.toolName} startup gate failed.`,
		payload: {
			callId: toolCall.id,
			toolName: input.toolName,
			phase: input.phase,
			status: "failed",
			ok: false,
			error: input.error.error,
			...input.eventPayload,
		},
	});
	return {
		historyItem: {
			type: "tool_result",
			toolCallId: toolCall.id,
			toolName: input.toolName,
			result: input.error,
		},
		toolResult: input.error,
	};
}
