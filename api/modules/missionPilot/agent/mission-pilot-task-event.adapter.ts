import crypto from "node:crypto";
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
export async function recordMissionPilotQuestionnaireStateChanged(
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
	const stateDigest = crypto
		.createHash("sha256")
		.update(
			JSON.stringify({
				status: session.status,
				updatedAt: session.updatedAt,
				questionSets: session.questionSets.map((set) => ({
					id: set.id,
					sequence: set.sequence,
					createdAt: set.createdAt,
				})),
				answers: session.answers.map((answer) => ({
					questionId: answer.questionId,
					answer: answer.answer,
					answeredAt: answer.answeredAt,
				})),
				reviews: session.reviews.map((review) => ({
					id: review.id,
					status: review.status,
					publishedMessageId: review.publishedMessageId,
					updatedAt: review.updatedAt,
				})),
			}),
		)
		.digest("hex");
	return recordMissionPilotTaskEvent({
		taskId: session.taskId,
		type: "questionnaire.state_changed",
		sourceEventId: `questionnaire-state:${session.id}:${session.status}:${session.questionSets.length}:${stateDigest}`,
		taskRevision: task.updatedAt.getTime(),
		payload: {
			questionnaireSessionId: session.id,
			status: session.status,
			questionSetCount: session.questionSets.length,
			sourceRevision,
			stateDigest,
		},
	});
}
