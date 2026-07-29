import type { TaskOperatorQueryContext } from "../../../../shared/modules/taskOperator";
import {
	type DesignQuestionnaireAnswer,
	designQuestionnaireAnswerSchema,
} from "../../../../shared/schemas/design-questionnaire.schema";
import { AppError } from "../../../lib/errors";
import { getDesignQuestionnaireSession } from "../../questionnaire/questionnaire.service";
import { getSessionQuestions } from "../../questionnaire/questionnaire-parser.service";
import {
	areQuestionnaireAnswersComplete,
	validateDesignQuestionnaireAnswerForQuestion,
} from "../../questionnaire/questionnaire-validation";
import {
	resolveTaskOperatorPrincipalCapabilities,
	type TaskOperatorDelegatedAuthorizationPort,
} from "../policies/task-operator-authorization";

export async function validateTaskOperatorQuestionnaireDraft(input: {
	taskId: string;
	questionnaireSessionId: string;
	answers: DesignQuestionnaireAnswer[];
	context: TaskOperatorQueryContext;
	delegatedAuthorization?: TaskOperatorDelegatedAuthorizationPort;
}) {
	const capabilities = await resolveTaskOperatorPrincipalCapabilities({
		principal: input.context.principal,
		taskId: input.taskId,
		delegatedAuthorization: input.delegatedAuthorization,
	});
	if (!capabilities.includes("plan"))
		throw new AppError(
			403,
			"TASK_OPERATOR_PERMISSION_DENIED",
			"Questionnaire draft access is not permitted.",
		);
	const questionnaire = await getDesignQuestionnaireSession(
		input.taskId,
		input.questionnaireSessionId,
	);
	if (questionnaire.status !== "answering")
		throw new AppError(
			409,
			"QUESTIONNAIRE_NOT_ANSWERING",
			"Questionnaire is not accepting a draft.",
		);
	const questionById = new Map(
		getSessionQuestions(questionnaire).map((question) => [
			String(question.id),
			question,
		]),
	);
	const answers = input.answers.map((answer) => {
		const parsed = designQuestionnaireAnswerSchema.parse(answer);
		const question = questionById.get(parsed.questionId);
		if (!question)
			throw new AppError(
				422,
				"UNKNOWN_QUESTION",
				`Unknown question id: ${parsed.questionId}`,
			);
		validateDesignQuestionnaireAnswerForQuestion(parsed, question);
		return parsed;
	});
	if (
		new Set(answers.map((answer) => answer.questionId)).size !== answers.length
	)
		throw new AppError(
			422,
			"DUPLICATE_QUESTIONNAIRE_ANSWER",
			"Questionnaire draft contains duplicate question ids.",
		);
	if (
		!areQuestionnaireAnswersComplete(
			questionnaire,
			new Map(answers.map((answer) => [answer.questionId, answer])),
		)
	)
		throw new AppError(
			422,
			"QUESTIONNAIRE_DRAFT_INCOMPLETE",
			"Questionnaire draft must answer every currently answerable question.",
		);
	return { questionnaire, answers };
}
