import type { StructuredLlmRole } from "../../structured-llm/types";
import type { AgentRunContext } from "../types";

export type NativeApiExecutionMode =
	| "planning"
	| "implementation"
	| "test"
	| "review"
	| "general_answer";

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

export function nativeApiRoleForExecutionMode(
	_mode: NativeApiExecutionMode,
): StructuredLlmRole {
	return "implementation";
}

export function stateCardRoleForExecutionMode(
	_mode: NativeApiExecutionMode,
): NativeApiStateCardRole {
	return "implementation";
}

export function isNativeApiPlanningMode(
	_mode: NativeApiExecutionMode,
): boolean {
	return false;
}
