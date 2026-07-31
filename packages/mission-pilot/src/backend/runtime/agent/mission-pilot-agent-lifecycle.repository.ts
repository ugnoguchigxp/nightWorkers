import { callMissionPilotPersistence } from "../../persistence-port";

export {
	finishMissionPilotAgentTurn,
	renewMissionPilotAgentTurnLease,
} from "./mission-pilot-conversation.repository";

export function cancelPendingMissionPilotToolCalls(
	sessionId: string,
	reason: "stopped" | "resource_limit" = "stopped",
) {
	return callMissionPilotPersistence<number>(
		"cancelPendingMissionPilotToolCalls",
		sessionId,
		reason,
	);
}

export function cancelRunningMissionPilotToolCalls(sessionId: string) {
	return callMissionPilotPersistence<number>(
		"cancelRunningMissionPilotToolCalls",
		sessionId,
	);
}
