import type { DesignQuestionnaireSession } from "../../../../shared/schemas/design-questionnaire.schema";
import { recordMissionPilotTaskEvent } from "./mission-pilot-task-event.adapter";

export async function recordMissionPilotQuestionnaireReady(
	session: DesignQuestionnaireSession,
) {
	const taskRevision =
		session.updatedAt instanceof Date
			? session.updatedAt.getTime()
			: new Date(session.updatedAt).getTime();
	return recordMissionPilotTaskEvent({
		taskId: session.taskId,
		type: "questionnaire.ready",
		sourceEventId: `questionnaire-ready:${session.id}:${taskRevision}`,
		taskRevision,
		payload: {
			questionnaireSessionId: session.id,
			status: session.status,
		},
	});
}
