import {
	buildNormalizedSupervisorLlmRequest,
	callProviderToolTurn,
	normalizeStructuredProviderError,
	providerAdapterKey,
	withStructuredProviderAttempt,
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
		const request = {
			provider: providerAdapterKey(normalizedRequest.providerId),
			messages: input.messages,
			tools: input.tools,
			systemPrompt: input.systemContext,
			userPrompt,
			options: {
				label: "mission_pilot_agent",
				role: "mission_pilot" as const,
				routeOverride,
				taskId: input.taskId,
				normalizedRequest,
				toolChoice: "auto" as const,
			},
			signal: input.signal,
			setProviderDebug: () => undefined,
		};
		return retryMissionPilotProviderCall(
			() => callProviderToolTurn(request),
			input.signal,
		);
	},
};

export async function retryMissionPilotProviderCall<T>(
	operation: () => Promise<T>,
	signal: AbortSignal,
) {
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			return await operation();
		} catch (error) {
			const failure = withStructuredProviderAttempt(
				normalizeStructuredProviderError(error),
				attempt,
			);
			if (!failure.retryable || attempt === 3 || signal.aborted) throw failure;
			await abortableDelay(
				process.env.NODE_ENV === "test"
					? 0
					: Math.min(10_000, failure.retryAfterMs ?? 250 * 2 ** (attempt - 1)),
				signal,
			);
		}
	}
	throw new Error("unreachable provider retry state");
}

function abortableDelay(ms: number, signal: AbortSignal) {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<void>((resolve, reject) => {
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal.reason);
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal.addEventListener("abort", onAbort, { once: true });
	});
}
