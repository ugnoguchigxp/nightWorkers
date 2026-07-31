import {
	missionPilotAgentSessions,
	missionPilotSessions,
} from "@nightworkers/mission-pilot/backend";
import { and, eq } from "drizzle-orm";
import { db } from "../../../db/client";

/**
 * Runtime ownership is deliberately derived from the durable agent-session
 * row.  Task phase, task status, and the in-memory wake registry are not
 * authority signals.
 */
export type MissionPilotRuntimeOwnership =
	| { kind: "agent"; sessionId: string }
	| { kind: "none" };

export async function resolveMissionPilotRuntimeOwnership(input: {
	sessionId?: string;
	taskId?: string;
}): Promise<MissionPilotRuntimeOwnership> {
	if (!input.sessionId && !input.taskId) return { kind: "none" };
	const [session] = await db
		.select({ id: missionPilotSessions.id })
		.from(missionPilotSessions)
		.where(
			input.sessionId
				? eq(missionPilotSessions.id, input.sessionId)
				: eq(missionPilotSessions.taskId, input.taskId as string),
		)
		.limit(1);
	if (!session) return { kind: "none" };
	const [agent] = await db
		.select({ sessionId: missionPilotAgentSessions.sessionId })
		.from(missionPilotAgentSessions)
		.where(
			and(
				eq(missionPilotAgentSessions.sessionId, session.id),
				eq(missionPilotAgentSessions.engineMode, "agent"),
			),
		)
		.limit(1);
	return agent ? { kind: "agent", sessionId: session.id } : { kind: "none" };
}

export async function isAgentMissionPilotRuntime(input: {
	sessionId?: string;
	taskId?: string;
}) {
	return (await resolveMissionPilotRuntimeOwnership(input)).kind === "agent";
}
