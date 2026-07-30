import type {
	DesignQuestion,
	DesignQuestionDependency,
	DesignQuestionSet,
} from "../../../shared/schemas/design-questionnaire.schema";
import type {
	DesignQuestionnaireAnswer,
	DesignQuestionnaireSession,
} from "../nightworkers/types";

export function emptyQuestionnaireAnswer(
	questionId: string,
): DesignQuestionnaireAnswer {
	return {
		questionId,
		selectedOptionIds: [],
		rankedOptionIds: [],
		deferred: false,
	};
}

export function isAnswered(answer?: DesignQuestionnaireAnswer) {
	return Boolean(
		answer?.deferred ||
			answer?.selectedOptionIds.length ||
			answer?.rankedOptionIds.length ||
			answer?.booleanValue !== undefined ||
			answer?.freeText?.trim(),
	);
}

export function isQuestionAnswered(
	question: DesignQuestion,
	answer?: DesignQuestionnaireAnswer,
) {
	if (answer?.deferred) return true;
	if (question.answerType === "multi_choice") return true;
	return isAnswered(answer);
}

export function getVisibleQuestionnaireQuestions(
	questionGroups: DesignQuestionSet[],
	answers: Record<string, DesignQuestionnaireAnswer>,
) {
	return questionGroups.flatMap((group) =>
		(Array.isArray(group.questions) ? group.questions : []).filter((question) =>
			isQuestionDependencySatisfied(question, answers),
		),
	);
}

export function getUnansweredQuestions(
	questionGroups: DesignQuestionSet[],
	answers: Record<string, DesignQuestionnaireAnswer>,
) {
	return getVisibleQuestionnaireQuestions(questionGroups, answers).filter(
		(question) => !isQuestionAnswered(question, answers[question.id]),
	);
}

export function buildSubmittableQuestionnaireAnswers(
	questionGroups: DesignQuestionSet[],
	answers: Record<string, DesignQuestionnaireAnswer>,
) {
	const visibleQuestions = getVisibleQuestionnaireQuestions(
		questionGroups,
		answers,
	);
	const merged = { ...answers };
	for (const question of visibleQuestions) {
		if (!merged[question.id] && question.answerType === "multi_choice") {
			merged[question.id] = emptyQuestionnaireAnswer(question.id);
		}
	}
	return Object.values(merged);
}

export function getAnswerProgress(
	questionGroups: DesignQuestionSet[],
	answers: Record<string, DesignQuestionnaireAnswer>,
) {
	const questions = getVisibleQuestionnaireQuestions(questionGroups, answers);
	const answeredCount = questions.filter((question) =>
		isQuestionAnswered(question, answers[question.id]),
	).length;
	return {
		answeredCount,
		totalCount: questions.length,
		unansweredCount: Math.max(questions.length - answeredCount, 0),
	};
}

export function getQuestionCount(session: DesignQuestionnaireSession) {
	const answers = Object.fromEntries(
		session.answers.map((item) => [item.questionId, item.answer]),
	);
	return session.questionSets.reduce((total, set) => {
		const groups = set.questionnaire?.questionSets;
		if (!Array.isArray(groups)) return total;
		return (
			total +
			groups.reduce(
				(sum, group) =>
					sum +
					(Array.isArray(group.questions)
						? group.questions.filter((question) =>
								isQuestionDependencySatisfied(question, answers),
							).length
						: 0),
				0,
			)
		);
	}, 0);
}

export function getQuestionnaireSessionProjectionKey(
	session: DesignQuestionnaireSession | null,
) {
	if (!session) return null;
	return JSON.stringify({
		id: session.id,
		status: session.status,
		updatedAt: session.updatedAt,
		questionSets: (session.questionSets ?? []).map((set) => ({
			id: set.id,
			sequence: set.sequence,
			createdAt: set.createdAt,
		})),
		answers: session.answers ?? [],
		reviews: (session.reviews ?? []).map((review) => ({
			id: review.id,
			status: review.status,
			updatedAt: review.updatedAt,
		})),
	});
}

export function isQuestionDependencySatisfied(
	question: DesignQuestion,
	answers: Record<string, DesignQuestionnaireAnswer>,
) {
	const dependencies = Array.isArray(question.dependsOn)
		? question.dependsOn
		: [];
	return dependencies.every((dependency) => {
		const answer = answers[String(dependency.questionId)];
		if (!answer) return false;
		return evaluateQuestionDependency(answer, dependency);
	});
}

function evaluateQuestionDependency(
	answer: DesignQuestionnaireAnswer,
	dependency: DesignQuestionDependency,
) {
	const expected = dependency.value;
	const values = [
		...answer.selectedOptionIds,
		...answer.rankedOptionIds,
		...(answer.freeText?.trim() ? [answer.freeText.trim()] : []),
	];
	const hasExpectedString = Array.isArray(expected)
		? expected.some((value) => values.includes(String(value)))
		: values.includes(String(expected));
	if (typeof expected === "boolean") {
		if (dependency.operator === "equals")
			return answer.booleanValue === expected;
		if (dependency.operator === "not_equals")
			return answer.booleanValue !== expected;
		return false;
	}
	if (dependency.operator === "equals" || dependency.operator === "includes") {
		return hasExpectedString;
	}
	if (
		dependency.operator === "not_equals" ||
		dependency.operator === "excludes"
	) {
		return !hasExpectedString;
	}
	return false;
}
