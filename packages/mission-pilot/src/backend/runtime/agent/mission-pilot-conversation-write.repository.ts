import type { MissionPilotActionFailure } from "../../../contracts";
import { callMissionPilotPersistence } from "../../persistence-port";

export function seedMissionPilotConversation(input: {
	sessionId: string;
	systemContext: string;
	initialPrompt: string;
}) {
	return callMissionPilotPersistence<boolean>(
		"seedMissionPilotConversation",
		input,
	);
}

export function appendMissionPilotUserMessage(input: {
	sessionId: string;
	content: string;
	sourceKind?: string;
	sourceId?: string;
}) {
	return callMissionPilotPersistence("appendMissionPilotUserMessage", input);
}

export function appendMissionPilotRuntimeFailure(input: {
	sessionId: string;
	failure: MissionPilotActionFailure;
	leaseOwner?: string;
}) {
	return callMissionPilotPersistence("appendMissionPilotRuntimeFailure", input);
}

export function appendMissionPilotConversationItem(input: {
	sessionId: string;
	kind:
		| "user"
		| "assistant"
		| "task_event"
		| "run_outcome"
		| "compaction_summary"
		| "runtime_failure"
		| "repair_request";
	body: unknown;
	turnId?: string | null;
	sourceKind?: string | null;
	sourceId?: string | null;
	leaseOwner?: string;
}) {
	return callMissionPilotPersistence(
		"appendMissionPilotConversationItem",
		input,
	);
}

export function compactMissionPilotConversation(input: {
	sessionId: string;
	summary: string;
	leaseOwner: string;
	sourceRevision: number;
	sourceDigest: string;
	sourceThroughSequence: number;
}) {
	return callMissionPilotPersistence("compactMissionPilotConversation", input);
}
