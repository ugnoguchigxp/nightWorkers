import {
	buildNormalizedSupervisorLlmRequestCandidates,
	callProviderToolTurn,
	normalizeStructuredProviderError,
	providerAdapterKey,
	withStructuredProviderAttempt,
} from "../../../services/structured-llm/public";
import type { StructuredLlmThinkingDepth } from "../../../services/structured-llm/settings";
import type { MissionPilotProviderPort } from "./mission-pilot-agent.ports";
import { missionPilotDigest } from "./mission-pilot-content-page";
import { appendMissionPilotTaskEvent } from "./mission-pilot-task-event.repository";

export class MissionPilotProviderRetryScheduledError extends Error {
	constructor(
		readonly failure: ReturnType<typeof normalizeStructuredProviderError>,
		readonly availableAt: Date,
	) {
		super("Mission Pilot provider retry was scheduled.");
		this.name = "MissionPilotProviderRetryScheduledError";
	}
}

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
			retryContext: {
				sessionId: input.sessionId,
				taskId: input.taskId,
				taskRevision: input.currentStepContext?.taskRef.revision ?? 0,
				attempt: latestProviderRetryAttempt(input.messages),
			},
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
	retryContext?: {
		sessionId: string;
		taskId: string;
		taskRevision: number;
		attempt?: number;
	};
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
	let lastRetryableFailure: unknown = null;
	for (const candidate of input.candidates) {
		try {
			const result = await input.callCandidate(candidate);
			if (result.type === "supported") return result;
			lastUnsupported = result;
		} catch (error) {
			const failure = normalizeStructuredProviderError(error);
			if (!failure.retryable || input.signal.aborted) throw failure;
			lastRetryableFailure = failure;
		}
	}
	if (lastRetryableFailure)
		return retryMissionPilotProviderCall(
			() => Promise.reject(lastRetryableFailure),
			input.signal,
			input.retryContext,
		);

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
	retryContext?: {
		sessionId: string;
		taskId: string;
		taskRevision: number;
		attempt?: number;
	},
) {
	const attempt = Math.max(1, Math.min(3, retryContext?.attempt ?? 1));
	try {
		return await operation();
	} catch (error) {
		const failure = withStructuredProviderAttempt(
			normalizeStructuredProviderError(error),
			attempt,
		);
		if (!failure.retryable || attempt === 3 || signal.aborted || !retryContext)
			throw failure;
		const delay =
			process.env.NODE_ENV === "test"
				? 0
				: Math.min(10_000, failure.retryAfterMs ?? 250 * 2 ** (attempt - 1));
		const availableAt = new Date(Date.now() + delay);
		const sourceEventId = `provider-retry:${retryContext.sessionId}:${attempt + 1}:${missionPilotDigest(`${Date.now()}:${attempt}`)}`;
		await appendMissionPilotTaskEvent({
			taskId: retryContext.taskId,
			eventType: "mission_pilot.retry_timer_elapsed",
			sourceEventId,
			taskRevision: retryContext.taskRevision,
			payload: {
				attempt,
				nextAttempt: attempt + 1,
				retryAfterMs: failure.retryAfterMs,
				failure,
			},
			availableAt,
		});
		throw new MissionPilotProviderRetryScheduledError(failure, availableAt);
	}
}

function latestProviderRetryAttempt(
	messages: Parameters<MissionPilotProviderPort["nextTurn"]>[0]["messages"],
) {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const content = messages[index]?.content;
		if (
			typeof content !== "string" ||
			!content.includes("mission_pilot.retry_timer_elapsed")
		)
			continue;
		try {
			const parsed = JSON.parse(content) as Record<string, unknown>;
			const events = Array.isArray(parsed.events) ? parsed.events : [];
			for (const event of [...events].reverse()) {
				const record =
					event && typeof event === "object"
						? (event as Record<string, unknown>)
						: {};
				if (record.eventType !== "mission_pilot.retry_timer_elapsed") continue;
				const payload =
					record.payload && typeof record.payload === "object"
						? (record.payload as Record<string, unknown>)
						: {};
				if (typeof payload.nextAttempt === "number") return payload.nextAttempt;
			}
		} catch {}
	}
	return 1;
}
