import type { MissionPilotActionFailure } from "../../../contracts";
import { normalizeStructuredProviderError } from "../../../services/structured-llm/public";
import { buildMissionPilotSystemContext } from "../prompts/mission-pilot-system-context";
import type { loadMissionPilotProviderMessages } from "./mission-pilot-conversation.repository";

export function readMissionPilotRuntimeSystemContext(
	messages: Awaited<ReturnType<typeof loadMissionPilotProviderMessages>>,
) {
	const system = messages.find((message) => message.role === "system");
	return system?.content ?? buildMissionPilotSystemContext();
}

export function missionPilotProviderFailure(
	error: unknown,
): MissionPilotActionFailure {
	const normalized = error instanceof Error ? error.message : String(error);
	const typed = normalizeStructuredProviderError(error);
	return {
		kind: typed.kind,
		retryable: typed.retryable,
		providerCode: typed.code ?? null,
		httpStatus: typed.httpStatus ?? null,
		message: normalized,
		retryAfterMs: typed.retryAfterMs ?? null,
		attempt: typed.attempt ?? 1,
		actionId: "provider.next_turn",
		idempotencyKey: null,
		details: typed.providerBody
			? { providerBody: typed.providerBody }
			: undefined,
	};
}

export function missionPilotResourceFailure(
	limit: string,
): MissionPilotActionFailure {
	return {
		kind: "resource_limit",
		retryable: false,
		providerCode: null,
		httpStatus: null,
		message: `Mission Pilot wake resource limit reached: ${limit}`,
		retryAfterMs: null,
		attempt: 1,
		actionId: "runtime.continue",
		idempotencyKey: null,
	};
}
