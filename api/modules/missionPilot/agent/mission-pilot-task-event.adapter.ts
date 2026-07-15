import { eq } from "drizzle-orm";
import type { DesignQuestionnaireSession } from "../../../../shared/schemas/design-questionnaire.schema";
import { db } from "../../../db/client";
import { tasks } from "../../../db/schema";
import { appendMissionPilotTaskEvent } from "./mission-pilot-task-event.repository";

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
		const { scheduleMissionPilotAgentWake } = await import(
			"./mission-pilot-agent-wake.service"
		);
		scheduleMissionPilotAgentWake({ sessionId: event.sessionId });
	}
	return event;
}
export async function recordMissionPilotQuestionnaireReady(
	session: DesignQuestionnaireSession,
) {
	const [task] = await db
		.select({ updatedAt: tasks.updatedAt })
		.from(tasks)
		.where(eq(tasks.id, session.taskId));
	if (!task) return null;
	const sourceRevision =
		session.updatedAt instanceof Date
			? session.updatedAt.getTime()
			: new Date(session.updatedAt).getTime();
	return recordMissionPilotTaskEvent({
		taskId: session.taskId,
		type: "questionnaire.ready",
		sourceEventId: `questionnaire-ready:${session.id}:${sourceRevision}`,
		taskRevision: task.updatedAt.getTime(),
		payload: {
			questionnaireSessionId: session.id,
			status: session.status,
			questionSetRevision: session.questionSets.length,
		},
	});
}
