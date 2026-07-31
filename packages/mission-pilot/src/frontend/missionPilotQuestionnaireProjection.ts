import type {
	DesignQuestionnaireAnswer,
	MissionPilotQuestionnaireDraft,
} from "../contracts";

export function projectMissionPilotQuestionnaireAnswers(
	session: {
		id: string;
		answers: Array<{ answer: DesignQuestionnaireAnswer }>;
	},
	draft: MissionPilotQuestionnaireDraft | null,
): Record<string, DesignQuestionnaireAnswer> {
	const answers =
		draft?.questionnaireSessionId === session.id &&
		["waiting_user", "submitting", "failed"].includes(draft.state)
			? draft.answers
			: session.answers.map((item) => item.answer);
	return Object.fromEntries(
		answers.map((answer) => [answer.questionId, answer]),
	);
}
