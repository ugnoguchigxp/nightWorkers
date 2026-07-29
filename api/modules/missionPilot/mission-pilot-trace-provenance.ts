import type { TraceProvenance } from "../../../shared/schemas/trace-provenance.schema";

type MissionPilotArtifactRef = {
	sessionId: string;
	phaseRunId?: string;
	phase?: string;
	cycle?: number;
	attempt?: number;
};

export function missionPilotArtifactTrace(
	input: MissionPilotArtifactRef,
): TraceProvenance {
	return {
		owner: "mission_pilot",
		channel: "artifact",
		producer: {
			kind: "structured_llm",
			role: "mission_pilot",
		},
		orchestrationRef: {
			kind: "mission_pilot",
			...input,
		},
	};
}

export function missionPilotThoughtTrace(
	input: MissionPilotArtifactRef & { role?: string; callId?: string },
): TraceProvenance {
	return {
		owner: "mission_pilot",
		channel: "pilot_thought",
		producer: {
			kind: "structured_llm",
			role: input.role ?? "mission_pilot",
			...(input.callId ? { callId: input.callId } : {}),
		},
		orchestrationRef: {
			kind: "mission_pilot",
			sessionId: input.sessionId,
			...(input.phaseRunId ? { phaseRunId: input.phaseRunId } : {}),
			...(input.phase ? { phase: input.phase } : {}),
			...(input.cycle !== undefined ? { cycle: input.cycle } : {}),
			...(input.attempt !== undefined ? { attempt: input.attempt } : {}),
		},
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
		metadataJson: {
			source: "mission_pilot",
			intent: "initial_prompt",
			controlVersion,
			missionPilotSessionId: sessionId,
			traceProvenance: trace,
		},
	};
}
