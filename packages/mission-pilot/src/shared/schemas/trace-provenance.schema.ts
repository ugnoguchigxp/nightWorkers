export type TraceProvenance = {
	owner: "user" | "mission_pilot" | "coding_agent" | "system";
	channel: "chat" | "pilot_thought" | "artifact" | "internal";
	producer: {
		kind: "user" | "structured_llm" | "agent_runtime" | "runtime" | "system";
		role?: string;
		runId?: string;
		callId?: string;
	};
	orchestrationRef?: {
		kind: "mission_pilot";
		sessionId: string;
		phaseRunId?: string;
		phase?: string;
		cycle?: number;
		attempt?: number;
	} | null;
};
