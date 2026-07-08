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
	| "review"
	| "general_answer";

export function normalizeNativeApiExecutionMode(
	value: unknown,
): NativeApiExecutionMode {
	if (
		value === "planning" ||
		value === "implementation" ||
		value === "test" ||
		value === "review" ||
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
	if (mode === "test") return "implementation";
	return mode;
}

export function isNativeApiPlanningMode(mode: NativeApiExecutionMode): boolean {
	return mode === "planning";
}
