import { eq } from "drizzle-orm";
import type { DesignQuestionnaireSession } from "../../../../shared/schemas/design-questionnaire.schema";
import { db } from "../../../db/client";
import { missionPilotSessions } from "../../../db/mission-pilot-schema";
import { buildQuestionnaireStateChange } from "../../questionnaire";
import { readTaskOperatorProjection } from "../../taskOperator";
import { toControlSummary } from "../mission-pilot.repository";
import { createMissionPilotTaskOperatorAccess } from "../mission-pilot-delegation";
import { publishMissionPilotUpdated } from "../mission-pilot-realtime";
import { MISSION_PILOT_QUESTIONNAIRE_RESPONSE_DELAY_MS } from "./mission-pilot-agent.constants";
import {
	getMissionPilotSessionById,
	isMissionPilotAgentSession,
} from "./mission-pilot-agent-session.repository";
import {
	appendMissionPilotTaskEvent,
	consumePendingMissionPilotQuestionnaireEvents,
} from "./mission-pilot-task-event.repository";

export async function recordMissionPilotTaskEvent(
	input: Omit<
		Parameters<typeof appendMissionPilotTaskEvent>[0],
		"eventType"
	> & { type: Parameters<typeof appendMissionPilotTaskEvent>[0]["eventType"] },
) {
	const event = await appendMissionPilotTaskEvent({
		...input,
		eventType: input.type,
	});
	if (event) {
		const session = await getMissionPilotSessionById(event.sessionId);
		if (session)
			publishMissionPilotUpdated(event.taskId, toControlSummary(session));
		const { scheduleMissionPilotAgentWake } = await import(
			"./mission-pilot-agent-wake.service"
		);
		scheduleMissionPilotAgentWake({ sessionId: event.sessionId });
	}
	return event;
}
export async function recordMissionPilotQuestionnaireStateChanged(
	session: DesignQuestionnaireSession,
) {
	const [pilot] = await db
		.select({
			id: missionPilotSessions.id,
			desiredState: missionPilotSessions.desiredState,
		})
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.taskId, session.taskId));
	if (
		pilot?.desiredState !== "playing" ||
		!(await isMissionPilotAgentSession(pilot.id))
	)
		return null;
	if (session.status !== "answering")
		await consumePendingMissionPilotQuestionnaireEvents({
			sessionId: pilot.id,
			questionnaireSessionId: session.id,
			status: "answering",
		});
	const access = await createMissionPilotTaskOperatorAccess({
		sessionId: pilot.id,
		taskId: session.taskId,
	});
	const projection = await readTaskOperatorProjection(
		session.taskId,
		access.context,
		access.delegatedAuthorization,
	);
	const stateChange = buildQuestionnaireStateChange(session);
	const detectedAt = new Date();
	const availableAt =
		session.status === "answering"
			? new Date(
					detectedAt.getTime() + MISSION_PILOT_QUESTIONNAIRE_RESPONSE_DELAY_MS,
				)
			: detectedAt;
	return recordMissionPilotTaskEvent({
		taskId: session.taskId,
		type: "questionnaire.state_changed",
		sourceEventId: `questionnaire-state:${session.id}:${session.status}:${session.questionSets.length}:${stateChange.stateDigest}`,
		taskRevision: projection.task.revision,
		payload: {
			questionnaireSessionId: session.id,
			status: session.status,
			questionSetCount: session.questionSets.length,
			sourceRevision: stateChange.revision,
			stateDigest: stateChange.stateDigest,
			detectedAt: detectedAt.toISOString(),
			availableAt: availableAt.toISOString(),
			responseDelayMs:
				session.status === "answering"
					? MISSION_PILOT_QUESTIONNAIRE_RESPONSE_DELAY_MS
					: 0,
		},
		availableAt,
	});
}
