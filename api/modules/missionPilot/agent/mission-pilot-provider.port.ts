import {
	buildNormalizedSupervisorLlmRequestCandidates,
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
		if (
			(message.role === "user" || message.role === "tool") &&
			typeof message.content === "string"
		)
			return message.content;
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
		const normalizedRequests = buildNormalizedSupervisorLlmRequestCandidates({
			systemPrompt: input.systemContext,
			userPrompt,
			label: "mission_pilot_agent",
			role: "mission_pilot",
			routeOverride,
		});
		return callMissionPilotProviderCandidates({
			candidates: normalizedRequests,
			signal: input.signal,
			callCandidate: (normalizedRequest) =>
				callProviderToolTurn({
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
				}),
		});
	},
};

type MissionPilotProviderCandidate = ReturnType<
	typeof buildNormalizedSupervisorLlmRequestCandidates
>[number];

export async function callMissionPilotProviderCandidates(input: {
	candidates: MissionPilotProviderCandidate[];
	signal: AbortSignal;
	callCandidate: (
		candidate: MissionPilotProviderCandidate,
	) => ReturnType<typeof callProviderToolTurn>;
}) {
	if (input.candidates.length === 0) {
		return {
			type: "unsupported" as const,
			reason:
				"Mission Pilot has no configured provider route that supports tool turns.",
			providerDebug: {
				mode: "provider_native_tools",
				candidateCount: 0,
			},
		};
	}

	let lastUnsupported: Awaited<ReturnType<typeof callProviderToolTurn>> | null =
		null;
	for (const candidate of input.candidates) {
		const result = await retryMissionPilotProviderCall(
			() => input.callCandidate(candidate),
			input.signal,
		);
		if (result.type === "supported") return result;
		lastUnsupported = result;
	}

	return (
		lastUnsupported ?? {
			type: "unsupported" as const,
			reason:
				"Mission Pilot has no configured provider route that supports tool turns.",
		}
	);
}

export async function retryMissionPilotProviderCall<T>(
	operation: () => Promise<T>,
	signal: AbortSignal,
) {
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		try {
			return await operation();
		} catch (error) {
			const failure = withStructuredProviderAttempt(
				normalizeStructuredProviderError(error),
				attempt,
			);
			if (!failure.retryable || attempt === 3 || signal.aborted) throw failure;
			await new Promise<void>((resolve, reject) => {
				if (signal.aborted) return reject(signal.reason);
				const timer = setTimeout(
					resolve,
					process.env.NODE_ENV === "test"
						? 0
						: Math.min(
								10_000,
								failure.retryAfterMs ?? 250 * 2 ** (attempt - 1),
							),
				);
				signal.addEventListener(
					"abort",
					() => {
						clearTimeout(timer);
						reject(signal.reason);
					},
					{ once: true },
				);
			});
		}
	}
	throw new Error("unreachable provider retry state");
}
