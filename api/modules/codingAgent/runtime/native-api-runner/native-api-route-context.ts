import { isLlmRole, type LlmRole } from "../../../../../shared/llm-role";
import type { AgentRunContext } from "../types";

export function readNativeApiActiveRole(context: AgentRunContext): LlmRole {
	return readNativeApiConfiguredActiveRole(context) ?? "implementation";
}

export function readNativeApiConfiguredActiveRole(
	context: AgentRunContext,
): LlmRole | null {
	const effectiveRouting = toRecord(
		toRecord(context.contextSnapshot)?.effectiveLlmRouting,
	);
	if (isLlmRole(effectiveRouting?.activeRole)) {
		return effectiveRouting.activeRole;
	}

	const runtimeRouting = toRecord(context.runtimeOptions?.llmRouting);
	if (isLlmRole(runtimeRouting?.activeRole)) return runtimeRouting.activeRole;
	return null;
}

export function readNativeApiEffectiveRoutingSnapshot(
	context: AgentRunContext,
): Record<string, unknown> | null {
	return toRecord(toRecord(context.contextSnapshot)?.effectiveLlmRouting);
}

function toRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
