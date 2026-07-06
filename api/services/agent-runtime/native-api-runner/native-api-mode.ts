import type { StructuredLlmRole } from "../../structured-llm/types";
import type { AgentRunContext } from "../types";

export type NativeApiExecutionMode =
	| "planning"
	| "implementation"
	| "review"
	| "runtime_debug"
	| "general_answer";

export type NativeApiStateCardRole =
	| "plan"
	| "implementation"
	| "review"
	| "runtime_debug"
	| "general_answer";

export function normalizeNativeApiExecutionMode(
	value: unknown,
): NativeApiExecutionMode {
	if (
		value === "planning" ||
		value === "implementation" ||
		value === "review" ||
		value === "runtime_debug" ||
		value === "general_answer"
	) {
		return value;
	}
	return "implementation";
}

export function readNativeApiExecutionMode(
	context: AgentRunContext,
): NativeApiExecutionMode {
	return normalizeNativeApiExecutionMode(context.runtimeOptions?.executionMode);
}

export function nativeApiRoleForExecutionMode(
	mode: NativeApiExecutionMode,
): StructuredLlmRole {
	if (mode === "planning" || mode === "general_answer") return "plan";
	if (mode === "review") return "review";
	return "implementation";
}

export function stateCardRoleForExecutionMode(
	mode: NativeApiExecutionMode,
): NativeApiStateCardRole {
	if (mode === "planning") return "plan";
	return mode;
}

export function isNativeApiPlanningMode(mode: NativeApiExecutionMode): boolean {
	return mode === "planning";
}
