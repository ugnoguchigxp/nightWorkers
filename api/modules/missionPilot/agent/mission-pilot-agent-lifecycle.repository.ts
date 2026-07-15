import { and, eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { missionPilotToolCalls } from "../../../db/mission-pilot-agent-schema";
import {
	completeMissionPilotToolCall,
	finishMissionPilotAgentTurn,
	renewMissionPilotAgentTurnLease,
} from "./mission-pilot-conversation.repository";

export { finishMissionPilotAgentTurn, renewMissionPilotAgentTurnLease };
export async function cancelPendingMissionPilotToolCalls(
	sessionId: string,
	reason: "stopped" | "resource_limit" = "stopped",
) {
	const pending = await db
		.select()
		.from(missionPilotToolCalls)
		.where(
			and(
				eq(missionPilotToolCalls.sessionId, sessionId),
				eq(missionPilotToolCalls.status, "pending"),
			),
		);
	for (const call of pending)
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
						: "Mission Pilot was stopped before this action started.",
				retryAfterMs: null,
				attempt: 1,
				actionId: call.actionId,
				idempotencyKey: call.idempotencyKey,
			},
		});
	return pending.length;
}
