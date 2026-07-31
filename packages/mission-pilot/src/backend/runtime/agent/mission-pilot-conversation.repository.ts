import type {
	MissionPilotActionFailure,
	MissionPilotTaskEventType,
} from "../../../contracts";
import type { ProviderToolCall } from "../../../services/structured-llm/public";
import { callMissionPilotPersistence } from "../../persistence-port";
import type { MissionPilotToolCallRecord } from "../../persistence-records";
import type { MissionPilotSessionRecord } from "../../storage/repository";

export {
	finishMissionPilotAgentTurn,
	getMissionPilotConversationCheckpoint,
	listMissionPilotConversation,
	loadMissionPilotProviderMessages,
	reconcileInterruptedMissionPilotAgentSessions,
} from "./mission-pilot-conversation-query.repository";
export {
	appendMissionPilotRuntimeFailure,
	appendMissionPilotUserMessage,
	compactMissionPilotConversation,
	seedMissionPilotConversation,
} from "./mission-pilot-conversation-write.repository";

export function claimMissionPilotAgentTurn(input: {
	sessionId: string;
	leaseOwner: string;
	now?: Date;
}) {
	return callMissionPilotPersistence<{
		session: MissionPilotSessionRecord;
		turnId: string;
		turnIndex: number;
		triggerEvents: Array<{
			sequence: number;
			eventType: MissionPilotTaskEventType;
		}>;
		providerRetryAttempt: number;
	} | null>("claimMissionPilotAgentTurn", input);
}

export function renewMissionPilotAgentTurnLease(input: {
	sessionId: string;
	turnId: string;
	leaseOwner: string;
}) {
	return callMissionPilotPersistence<boolean>(
		"renewMissionPilotAgentTurnLease",
		input,
	);
}

export function persistMissionPilotProviderTurn(input: {
	sessionId: string;
	turnId: string;
	leaseOwner: string;
	content: string;
	toolCalls: ProviderToolCall[];
	provider?: string | null;
	model?: string | null;
}) {
	return callMissionPilotPersistence<MissionPilotToolCallRecord[] | null>(
		"persistMissionPilotProviderTurn",
		input,
	);
}

export function claimMissionPilotToolCall(input: {
	id: string;
	leaseOwner: string;
}) {
	return callMissionPilotPersistence<MissionPilotToolCallRecord | null>(
		"claimMissionPilotToolCall",
		input,
	);
}

export function completeMissionPilotToolCall(input: {
	id: string;
	result?: unknown;
	failure?: MissionPilotActionFailure;
	cancelled?: boolean;
}) {
	return callMissionPilotPersistence<MissionPilotToolCallRecord | null>(
		"completeMissionPilotToolCall",
		input,
	);
}

export function reprojectMissionPilotTerminalToolCall(input: {
	id: string;
	leaseOwner: string;
}) {
	return callMissionPilotPersistence<boolean>(
		"reprojectMissionPilotTerminalToolCall",
		input,
	);
}
