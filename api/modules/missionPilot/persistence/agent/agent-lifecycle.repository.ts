import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../../../db/client";
import { missionPilotToolCalls } from "../index";
import {
	completeMissionPilotToolCall,
	finishMissionPilotAgentTurn,
	renewMissionPilotAgentTurnLease,
} from "./conversation.repository";

export { finishMissionPilotAgentTurn, renewMissionPilotAgentTurnLease };
export async function cancelPendingMissionPilotToolCalls(
	sessionId: string,
	reason: "stopped" | "resource_limit" = "stopped",
) {
	return cancelMissionPilotToolCalls(sessionId, ["pending"], reason);
}

export async function cancelRunningMissionPilotToolCalls(sessionId: string) {
	return cancelMissionPilotToolCalls(sessionId, ["running"], "stopped");
}

async function cancelMissionPilotToolCalls(
	sessionId: string,
	statuses: Array<"pending" | "running">,
	reason: "stopped" | "resource_limit",
) {
	const openCalls = await db
		.select()
		.from(missionPilotToolCalls)
		.where(
			and(
				eq(missionPilotToolCalls.sessionId, sessionId),
				inArray(missionPilotToolCalls.status, statuses),
			),
		);
	for (const call of openCalls)
		await completeMissionPilotToolCall({
			id: call.id,
			cancelled: true,
			failure: {
				kind: "domain_precondition",
				retryable: false,
				providerCode:
					reason === "resource_limit"
						? "MISSION_PILOT_RESOURCE_LIMIT"
						: "MISSION_PILOT_STOPPED",
				httpStatus: null,
				message:
					reason === "resource_limit"
						? "Wake resource limit reached before this action started."
						: call.status === "running"
							? "Mission Pilot was stopped while this action was running."
							: "Mission Pilot was stopped before this action started.",
				retryAfterMs: null,
				attempt: 1,
				actionId: call.actionId,
				idempotencyKey: call.idempotencyKey,
			},
		});
	return openCalls.length;
}
