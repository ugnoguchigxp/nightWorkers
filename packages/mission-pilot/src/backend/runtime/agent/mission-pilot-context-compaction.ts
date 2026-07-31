import type {
	ProviderToolDefinition,
	ProviderToolMessage,
} from "../../../services/structured-llm/public";
import {
	p as defaultP,
	type SystemContextP,
} from "../../../systemContexts/catalog";
import {
	boundMissionPilotCompactionInput,
	estimateMissionPilotProviderRequestTokens,
} from "./mission-pilot-context-envelope";

export function getMissionPilotCompactionSystemContext(
	p: SystemContextP = defaultP,
) {
	return p("missionPilot.compaction", {});
}

export function shouldCompactMissionPilotContext(input: {
	systemContext: string;
	messages: ProviderToolMessage[];
	tools: ProviderToolDefinition[];
	softTokenBudget: number;
}) {
	return (
		estimateMissionPilotProviderRequestTokens(input) > input.softTokenBudget
	);
}

export function buildMissionPilotCompactionRequest(
	messages: ProviderToolMessage[],
	maxBytes = 64_000,
) {
	return boundMissionPilotCompactionInput(messages, maxBytes);
}
