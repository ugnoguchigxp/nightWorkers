import type {
	TraceChannel,
	TraceProvenance,
} from "../../../shared/schemas/trace-provenance.schema";
import { resolveRunOrchestrationRef } from "../agentsShare";

type MissionPilotRefInput = {
	sessionId: string;
	phaseRunId?: string;
	phase?: string;
	cycle?: number;
	attempt?: number;
};

export function userChatTrace(): TraceProvenance {
	return { owner: "user", channel: "chat", producer: { kind: "user" } };
}

export function codingAgentChatTrace(input?: {
	runId?: string | null;
	orchestrationRef?: MissionPilotRefInput | null;
}): TraceProvenance {
	return {
		owner: "coding_agent",
		channel: "chat",
		producer: {
			kind: "agent_runtime",
			...(input?.runId ? { runId: input.runId } : {}),
		},
		...(input?.orchestrationRef
			? {
					orchestrationRef: {
						kind: "mission_pilot" as const,
						...input.orchestrationRef,
					},
				}
			: {}),
	};
}

export function structuredLlmChatTrace(input?: {
	role?: string | null;
	callId?: string | null;
	orchestrationRef?: MissionPilotRefInput | null;
}): TraceProvenance {
	return {
		owner: "coding_agent",
		channel: "chat",
		producer: {
			kind: "structured_llm",
			...(input?.role ? { role: input.role } : {}),
			...(input?.callId ? { callId: input.callId } : {}),
		},
		...(input?.orchestrationRef
			? {
					orchestrationRef: {
						kind: "mission_pilot" as const,
						...input.orchestrationRef,
					},
				}
			: {}),
	};
}

export function missionPilotThoughtTrace(
	input: MissionPilotRefInput & { role?: string; callId?: string },
): TraceProvenance {
	const orchestrationRef = {
		kind: "mission_pilot" as const,
		sessionId: input.sessionId,
		...(input.phaseRunId ? { phaseRunId: input.phaseRunId } : {}),
		...(input.phase ? { phase: input.phase } : {}),
		...(input.cycle !== undefined ? { cycle: input.cycle } : {}),
		...(input.attempt !== undefined ? { attempt: input.attempt } : {}),
	};
	return {
		owner: "mission_pilot",
		channel: "pilot_thought",
		producer: {
			kind: "structured_llm",
			role: input.role ?? "mission_pilot",
			...(input.callId ? { callId: input.callId } : {}),
		},
		orchestrationRef,
	};
}

export function missionPilotInitialPromptTrace(
	sessionId: string,
	controlVersion: number,
) {
	const trace: TraceProvenance = {
		owner: "user",
		channel: "chat",
		producer: { kind: "user" },
		orchestrationRef: { kind: "mission_pilot", sessionId },
	};
	return {
		trace,
		metadataJson: withTraceProvenance(
			{
				source: "mission_pilot",
				intent: "initial_prompt",
				controlVersion,
				missionPilotSessionId: sessionId,
			},
			trace,
		),
	};
}

export function systemInternalTrace(): TraceProvenance {
	return {
		owner: "system",
		channel: "internal",
		producer: { kind: "system" },
	};
}

export function withTraceProvenance(
	value: unknown,
	trace: TraceProvenance,
): Record<string, unknown> {
	const record =
		value === undefined || value === null
			? {}
			: value && typeof value === "object" && !Array.isArray(value)
				? (value as Record<string, unknown>)
				: { rawPayload: value };
	return { ...record, traceProvenance: trace };
}

export function resolveTaskMessageTrace(input: {
	role: "user" | "assistant" | "system" | "tool";
	runId?: string | null;
	metadata?: unknown;
	trace?: TraceProvenance;
}): TraceProvenance {
	if (input.runId) return codingAgentRunTrace(input.runId, input.trace);
	if (input.trace) return input.trace;
	if (input.role === "user") return userChatTrace();
	if (input.role === "assistant" || input.role === "tool") {
		return codingAgentChatTrace();
	}
	return systemInternalTrace();
}

export function resolveActivityTrace(input: {
	runId?: string | null;
	source: string;
	payloadJson?: unknown;
	trace?: TraceProvenance;
}): TraceProvenance {
	if (input.runId) return codingAgentRunTrace(input.runId, input.trace);
	if (input.trace) return input.trace;
	const payload =
		input.payloadJson && typeof input.payloadJson === "object"
			? (input.payloadJson as Record<string, unknown>)
			: {};
	if (input.source === "mission_pilot") {
		const sessionId =
			typeof payload.missionPilotSessionId === "string"
				? payload.missionPilotSessionId
				: "legacy";
		return missionPilotThoughtTrace({ sessionId });
	}
	if (input.source === "user") return userChatTrace();
	if (
		input.source === "assistant" ||
		input.source === "worker" ||
		input.source === "tool" ||
		input.source === "supervisor"
	) {
		return codingAgentChatTrace({ runId: input.runId });
	}
	return systemInternalTrace();
}

export function resolveLlmUsageTrace(input: {
	runId?: string | null;
	callId: string;
	metadata?: Record<string, unknown>;
	trace?: TraceProvenance;
}): TraceProvenance {
	if (input.runId) return codingAgentRunTrace(input.runId, input.trace);
	if (input.trace) return input.trace;
	if (input.metadata?.role === "mission_pilot") {
		return missionPilotThoughtTrace({
			sessionId:
				typeof input.metadata.missionPilotSessionId === "string"
					? input.metadata.missionPilotSessionId
					: "legacy",
			callId: input.callId,
		});
	}
	return structuredLlmChatTrace({
		role: typeof input.metadata?.role === "string" ? input.metadata.role : null,
		callId: input.callId,
	});
}

function codingAgentRunTrace(
	runId: string,
	trace?: TraceProvenance,
): TraceProvenance {
	if (!trace) return codingAgentChatTrace({ runId });
	return {
		owner: "coding_agent",
		channel: "chat",
		producer: {
			...trace.producer,
			runId,
		},
		...(trace.orchestrationRef !== undefined
			? { orchestrationRef: trace.orchestrationRef }
			: {}),
	};
}

export async function resolveRunCodingAgentTrace(
	runId: string,
): Promise<TraceProvenance> {
	return codingAgentChatTrace({
		runId,
		orchestrationRef: await resolveRunOrchestrationRef(runId),
	});
}

export function isTraceChannel(value: string): value is TraceChannel {
	return ["chat", "pilot_thought", "artifact", "internal"].includes(value);
}
