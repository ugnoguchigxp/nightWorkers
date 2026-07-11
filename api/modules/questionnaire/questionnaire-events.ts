import type { DesignQuestionnaireSession } from "../../../shared/schemas/design-questionnaire.schema";

type QuestionnaireReadyListener = (
	session: DesignQuestionnaireSession,
) => Promise<void> | void;

const questionnaireReadyListeners = new Set<QuestionnaireReadyListener>();

export function registerQuestionnaireReadyListener(
	listener: QuestionnaireReadyListener,
) {
	questionnaireReadyListeners.add(listener);
	return () => questionnaireReadyListeners.delete(listener);
}

export async function publishQuestionnaireReady(
	session: DesignQuestionnaireSession,
) {
	await Promise.all(
		[...questionnaireReadyListeners].map((listener) => listener(session)),
	);
}
