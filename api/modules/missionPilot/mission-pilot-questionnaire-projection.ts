import {
	missionPilotQuestionnaireDrafts,
	missionPilotSessions,
} from "@nightworkers/mission-pilot/backend";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { DesignQuestionnaireSession } from "../../../shared/schemas/design-questionnaire.schema";
import { db } from "../../db/client";

export async function projectMissionPilotQuestionnaireDraftAnswers(
	taskId: string,
	sessions: DesignQuestionnaireSession[],
) {
	const [pilot] = await db
		.select({
			id: missionPilotSessions.id,
			desiredState: missionPilotSessions.desiredState,
		})
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.taskId, taskId));
	if (pilot?.desiredState !== "playing") return sessions;
	const [draft] = await db
		.select()
		.from(missionPilotQuestionnaireDrafts)
		.where(
			and(
				eq(missionPilotQuestionnaireDrafts.sessionId, pilot.id),
				inArray(missionPilotQuestionnaireDrafts.state, [
					"waiting_user",
					"submitting",
					"failed",
				]),
			),
		)
		.orderBy(desc(missionPilotQuestionnaireDrafts.createdAt))
		.limit(1);
	if (!draft) return sessions;
	return sessions.map((session) =>
		session.id !== draft.questionnaireSessionId
			? session
			: {
					...session,
					answers: draft.answersJson.map((answer) => ({
						id: draft.id,
						questionId: answer.questionId,
						answer,
						answeredAt: draft.updatedAt,
					})),
				},
	);
}
