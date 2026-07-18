import type { DesignQuestionnaireSession } from "../../../shared/schemas/design-questionnaire.schema";

type QuestionnaireReadyListener = (
	session: DesignQuestionnaireSession,
) => Promise<void> | void;
type QuestionnaireStateChangedListener = (
	session: DesignQuestionnaireSession,
) => Promise<void> | void;

const questionnaireReadyListeners = new Set<QuestionnaireReadyListener>();
const questionnaireStateChangedListeners =
	new Set<QuestionnaireStateChangedListener>();

export function registerQuestionnaireReadyListener(
	listener: QuestionnaireReadyListener,
) {
	questionnaireReadyListeners.add(listener);
	return () => questionnaireReadyListeners.delete(listener);
}

export function registerQuestionnaireStateChangedListener(
	listener: QuestionnaireStateChangedListener,
) {
	questionnaireStateChangedListeners.add(listener);
	return () => questionnaireStateChangedListeners.delete(listener);
}

export async function publishQuestionnaireReady(
	session: DesignQuestionnaireSession,
) {
	await Promise.all(
		[...questionnaireReadyListeners].map((listener) => listener(session)),
	);
}

export async function publishQuestionnaireStateChanged(
	session: DesignQuestionnaireSession,
) {
	await Promise.all(
		[...questionnaireStateChangedListeners].map((listener) =>
			listener(session),
		),
	);
}

export async function publishQuestionnaireTransition(
	session: DesignQuestionnaireSession,
) {
	await publishQuestionnaireStateChanged(session);
	if (session.status === "answering") await publishQuestionnaireReady(session);
}
