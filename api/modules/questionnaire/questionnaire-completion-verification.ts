import type { DesignQuestionnaire } from "../../../shared/schemas/design-questionnaire.schema";
import type { CompletionVerificationScope } from "../../../shared/schemas/verification-checklist.schema";

export const COMPLETION_VERIFICATION_QUESTION_ID = "completion-verification";
export const COMPLETION_VERIFICATION_DECISION_KEY =
	"completion.verification_scope";
export const COMPLETION_VERIFICATION_OPTION_IDS = {
	none: "completion-verification-none",
	unit: "completion-verification-unit",
	e2eIfUi: "completion-verification-e2e",
	unitAndE2eIfUi: "completion-verification-unit-e2e",
} as const;

export type { CompletionVerificationScope };

const completionVerificationQuestion: DesignQuestionnaire["questionSets"][number]["questions"][number] =
	{
		id: COMPLETION_VERIFICATION_QUESTION_ID,
		topic: "完了条件のテスト範囲",
		question: "実装完了の条件にするテスト範囲を選んでください。",
		why: "選択したテスト範囲をFeature Planの検証計画と完了条件へ引き継ぎます。",
		answerType: "single_choice",
		options: [
			{
				id: COMPLETION_VERIFICATION_OPTION_IDS.none,
				label: "テストを完了条件にしない",
				tradeoff:
					"実装結果はテスト成功を完了条件にせず、選択外のテストを追加しません。",
			},
			{
				id: COMPLETION_VERIFICATION_OPTION_IDS.unit,
				label: "Unit testを完了条件にする",
				tradeoff: "対象機能のUnit test成功を完了条件にします。",
			},
			{
				id: COMPLETION_VERIFICATION_OPTION_IDS.e2eIfUi,
				label: "E2Eを完了条件にする（フロントエンドにUIがある場合）",
				tradeoff:
					"対象にフロントエンドUIがある場合だけ、その利用経路のE2E成功を完了条件にします。",
			},
			{
				id: COMPLETION_VERIFICATION_OPTION_IDS.unitAndE2eIfUi,
				label: "Unit testとE2Eを完了条件にする（フロントエンドにUIがある場合）",
				tradeoff:
					"Unit testに加え、対象にフロントエンドUIがある場合だけE2E成功も完了条件にします。",
			},
		],
		blocks: ["Feature Planの検証計画と完了条件"],
		outputSection: "verification-scope",
		decisionKey: COMPLETION_VERIFICATION_DECISION_KEY,
		blocking: true,
		blockingReason: "実装完了の判定に使うテスト範囲を確定するためです。",
	};

export function appendCompletionVerificationQuestion(
	questionnaire: DesignQuestionnaire,
): DesignQuestionnaire {
	const next = structuredClone(questionnaire);
	const lastQuestionSet = next.questionSets.at(-1);
	if (!lastQuestionSet) return next;
	for (const questionSet of next.questionSets) {
		questionSet.questions = questionSet.questions.filter(
			(question) =>
				question.id !== COMPLETION_VERIFICATION_QUESTION_ID &&
				question.decisionKey !== COMPLETION_VERIFICATION_DECISION_KEY,
		);
	}
	lastQuestionSet.questions.push(
		structuredClone(completionVerificationQuestion),
	);
	return next;
}

export function resolveCompletionVerificationScope(session: {
	answers: Array<{
		questionId: string;
		answer: { selectedOptionIds: string[] };
	}>;
}): CompletionVerificationScope | null {
	const answer = session.answers.find(
		(item) => item.questionId === COMPLETION_VERIFICATION_QUESTION_ID,
	)?.answer;
	const selected = answer?.selectedOptionIds[0];
	if (selected === COMPLETION_VERIFICATION_OPTION_IDS.none) return "none";
	if (selected === COMPLETION_VERIFICATION_OPTION_IDS.unit) return "unit";
	if (selected === COMPLETION_VERIFICATION_OPTION_IDS.e2eIfUi)
		return "e2e_if_ui";
	if (selected === COMPLETION_VERIFICATION_OPTION_IDS.unitAndE2eIfUi)
		return "unit_and_e2e_if_ui";
	return null;
}
