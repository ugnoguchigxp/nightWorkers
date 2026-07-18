import { createHash } from "node:crypto";
import { getDesignQuestionnaireSession } from "./questionnaire.repository";
import { listDesignQuestionnaires } from "./questionnaire-query.service";

export async function readQuestionnaireOperatorState(taskId: string) {
	const sessions = await listDesignQuestionnaires(taskId);
	const current = sessions[0] ?? null;
	if (!current) return null;
	const decisionBody = JSON.stringify(
		current.answers.map((answer) => ({
			questionId: answer.questionId,
			answer: answer.answer,
		})),
	);
	const blockingQuestionCount = current.questionSets
		.flatMap((set) => set.questionnaire?.questionSets ?? [])
		.flatMap((set) => set.questions)
		.filter(
			(question) =>
				!current.answers.some((answer) => answer.questionId === question.id),
		).length;
	return {
		id: current.id,
		revision: new Date(current.updatedAt).getTime(),
		status: current.status,
		decisionDigest: decisionBody === "[]" ? null : digest(decisionBody),
		blockingQuestionCount,
	};
}

export async function questionnaireSessionBelongsToTask(
	taskId: string,
	sessionId: string,
) {
	const session = await getDesignQuestionnaireSession(sessionId);
	return session?.taskId === taskId;
}

function digest(value: string) {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
