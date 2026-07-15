import type { AgentRunContext } from "../types";

export type NativeApiExecutionMode = "implementation";

export type NativeApiStateCardRole =
	| "plan"
	| "implementation"
	| "test"
	| "review"
	| "general_answer";

export function normalizeNativeApiExecutionMode(
	_value: unknown,
): NativeApiExecutionMode {
	return "implementation";
}

export function readNativeApiExecutionMode(
	context: AgentRunContext,
): NativeApiExecutionMode {
	return normalizeNativeApiExecutionMode(context.runtimeOptions?.executionMode);
}
