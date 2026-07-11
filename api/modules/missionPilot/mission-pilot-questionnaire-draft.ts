import {
	type DesignQuestion,
	type DesignQuestionnaireAnswer,
	type DesignQuestionnaireSession,
	designQuestionnaireAnswerSchema,
} from "../../../shared/schemas/design-questionnaire.schema";
import type { MissionPilotAnswerEvidence } from "../../../shared/schemas/mission-pilot.schema";

function defaultAnswer(question: DesignQuestion): {
	answer: DesignQuestionnaireAnswer;
	reason: string;
} {
	const options = question.options ?? [];
	const recommended = options.filter((option) => option.recommended);
	const preferred =
		options.find((option) => option.id === question.recommendedAnswerId) ??
		recommended[0] ??
		options[0];
	const base = {
		questionId: question.id,
		selectedOptionIds: [] as string[],
		rankedOptionIds: [] as string[],
		deferred: false,
	};
	if (question.answerType === "multi_choice") {
		const selected =
			recommended.length > 0 ? recommended : preferred ? [preferred] : [];
		return {
			answer: {
				...base,
				selectedOptionIds: selected.map((option) => option.id),
			},
			reason: selected.length
				? `推奨された選択肢「${selected.map((option) => option.label).join("、")}」を採用しました。`
				: "質問の既定方針を採用しました。",
		};
	}
	if (question.answerType === "ranked") {
		const ranked = preferred
			? [preferred, ...options.filter((option) => option.id !== preferred.id)]
			: options;
		return {
			answer: { ...base, rankedOptionIds: ranked.map((option) => option.id) },
			reason: preferred
				? `推奨された「${preferred.label}」を最優先にしました。`
				: "提示順を優先順位として採用しました。",
		};
	}
	if (question.answerType === "boolean") {
		return {
			answer: { ...base, booleanValue: true },
			reason: "Mission Pilotが作業を前進させる肯定案を提案しました。",
		};
	}
	if (question.answerType === "free_text") {
		return {
			answer: {
				...base,
				freeText: `${question.topic}については、既存設計との整合性と最小変更を優先してMission Pilotが判断します。`,
			},
			reason: "タスクの既存設計を尊重する方針で回答案を作成しました。",
		};
	}
	return {
		answer: { ...base, selectedOptionIds: preferred ? [preferred.id] : [] },
		reason: preferred
			? `${preferred.recommended || preferred.id === question.recommendedAnswerId ? "推奨された" : "先頭の"}選択肢「${preferred.label}」を採用しました。${preferred.tradeoff}`
			: "質問の既定方針を採用しました。",
	};
}

export function buildMissionPilotQuestionnaireDraft(
	session: DesignQuestionnaireSession,
	now = new Date(),
) {
	const questions = session.questionSets.flatMap(
		(set) =>
			set.questionnaire?.questionSets.flatMap((group) => group.questions) ?? [],
	);
	const generated = questions.map(defaultAnswer);
	return {
		answers: generated.map(({ answer }) =>
			designQuestionnaireAnswerSchema.parse(answer),
		),
		answerEvidence: Object.fromEntries(
			generated.map(({ answer, reason }) => [
				answer.questionId,
				{
					source: "mission_pilot",
					reason,
					updatedAt: now,
				} satisfies MissionPilotAnswerEvidence,
			]),
		),
	};
}
