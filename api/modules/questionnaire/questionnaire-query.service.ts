import { NotFoundError } from "../../lib/errors";
import { getPlanModeTask } from "../nightworkers/nightworkers.plan-mode-core.port";
import * as repo from "./questionnaire.repository";
import { buildDesignQuestionnaireSessionView } from "./questionnaire-parser.service";

export async function listDesignQuestionnaires(taskId: string) {
	const task = await getPlanModeTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	const sessions = await repo.listDesignQuestionnaireSessionsForTask(taskId);
	return Promise.all(
		sessions.map((session) => buildDesignQuestionnaireSessionView(session.id)),
	);
}

export async function getDesignQuestionnaireSession(
	taskId: string,
	sessionId: string,
) {
	const session = await buildDesignQuestionnaireSessionView(sessionId);
	if (session.taskId !== taskId)
		throw new NotFoundError("Questionnaire session not found");
	return session;
}
