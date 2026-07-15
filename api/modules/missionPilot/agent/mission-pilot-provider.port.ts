import {
	buildNormalizedSupervisorLlmRequest,
	callProviderToolTurn,
	providerAdapterKey,
} from "../../../services/structured-llm/public";
import type { StructuredLlmThinkingDepth } from "../../../services/structured-llm/settings";
import type { MissionPilotProviderPort } from "./mission-pilot-agent.ports";

function latestUserPrompt(
	messages: Parameters<MissionPilotProviderPort["nextTurn"]>[0]["messages"],
) {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role === "user" && typeof message.content === "string") {
			return message.content;
		}
		if (message?.role === "tool") return message.content;
	}
	return "現在のTask Factを確認し、次の操作を判断してください。";
}

export const missionPilotProviderPort: MissionPilotProviderPort = {
	async nextTurn(input) {
		const routeOverride =
			input.providerEndpointId && input.model
				? {
						providerEndpointId: input.providerEndpointId,
						model: input.model,
						...(input.thinkingDepth
							? {
									thinkingDepth:
										input.thinkingDepth as StructuredLlmThinkingDepth,
								}
							: {}),
					}
				: null;
		const userPrompt = latestUserPrompt(input.messages);
		const normalizedRequest = buildNormalizedSupervisorLlmRequest({
			systemPrompt: input.systemContext,
			userPrompt,
			label: "mission_pilot_agent",
			role: "mission_pilot",
			routeOverride,
		});
		return callProviderToolTurn({
			provider: providerAdapterKey(normalizedRequest.providerId),
			messages: input.messages,
			tools: input.tools,
			systemPrompt: input.systemContext,
			userPrompt,
			options: {
				label: "mission_pilot_agent",
				role: "mission_pilot",
				routeOverride,
				taskId: input.taskId,
				normalizedRequest,
				toolChoice: "auto",
			},
			signal: input.signal,
			setProviderDebug: () => undefined,
		});
	},
};
