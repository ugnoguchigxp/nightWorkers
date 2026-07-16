import { and, eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { missionPilotAgentSessions } from "../../../db/mission-pilot-agent-schema";
import { missionPilotSessions } from "../../../db/mission-pilot-schema";

/**
 * Runtime ownership is deliberately derived from the durable agent-session
 * row.  Task phase, task status, and the in-memory wake registry are not
 * authority signals.
 */
export type MissionPilotRuntimeOwnership =
	| { kind: "agent"; sessionId: string }
	| { kind: "legacy"; sessionId: string }
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
	return agent
		? { kind: "agent", sessionId: session.id }
		: { kind: "legacy", sessionId: session.id };
}

export async function isLegacyMissionPilotRuntime(input: {
	sessionId?: string;
	taskId?: string;
}) {
	return (await resolveMissionPilotRuntimeOwnership(input)).kind === "legacy";
}

export async function isAgentMissionPilotRuntime(input: {
	sessionId?: string;
	taskId?: string;
}) {
	return (await resolveMissionPilotRuntimeOwnership(input)).kind === "agent";
}
