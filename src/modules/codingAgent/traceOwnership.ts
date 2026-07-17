type TraceOwnedRecord = {
	traceOwner?: string | null;
	traceChannel?: string | null;
};

type ChatMessageRecord = TraceOwnedRecord & {
	role?: string | null;
};

export function isCodingAgentChatTrace(record: TraceOwnedRecord): boolean {
	return record.traceOwner === "coding_agent" && record.traceChannel === "chat";
}

export function isCodingAgentChatMessage(record: ChatMessageRecord): boolean {
	if (isCodingAgentChatTrace(record)) return true;
	return record.traceOwner === "user" && record.traceChannel === "chat";
}
