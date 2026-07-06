import { describe, expect, it } from "vitest";
import {
	buildSubmittableQuestionnaireAnswers,
	getAnswerProgress,
	getQuestionnaireSubmissionState,
	getUnansweredQuestions,
} from "../src/modules/planMode";

const questionGroups = [
	{
		id: "scope",
		questions: [
			{
				id: "q1",
				question: "最初に着手する範囲はどれにしますか？",
				answerType: "single_choice",
				options: [
					{ id: "q1-o1", label: "画面の最小構成から始める", tradeoff: "small" },
					{ id: "q1-o2", label: "保存まで含める", tradeoff: "wide" },
				],
			},
			{
				id: "q2",
				question: "今回まず必要な機能はどれですか？",
				answerType: "multi_choice",
				options: [
					{ id: "q2-o1", label: "カード作成", tradeoff: "core" },
					{ id: "q2-o2", label: "通知", tradeoff: "ops" },
				],
			},
		],
	},
];

describe("ArtifactQuestionnaire answer progress", () => {
	it("treats an untouched multi choice question as an explicit empty answer candidate", () => {
		const answers = {
			q1: {
				questionId: "q1",
				selectedOptionIds: ["q1-o1"],
				rankedOptionIds: [],
				deferred: false,
			},
		};

		expect(getAnswerProgress(questionGroups, answers)).toEqual({
			answeredCount: 2,
			totalCount: 2,
			unansweredCount: 0,
		});
		expect(getUnansweredQuestions(questionGroups, answers)).toEqual([]);
		expect(
			buildSubmittableQuestionnaireAnswers(questionGroups, answers),
		).toContainEqual({
			questionId: "q2",
			selectedOptionIds: [],
			rankedOptionIds: [],
			deferred: false,
		});
	});

	it("keeps single choice questions incomplete until selected or deferred", () => {
		const answers = {
			q2: {
				questionId: "q2",
				selectedOptionIds: [],
				rankedOptionIds: [],
				deferred: false,
			},
		};

		expect(getAnswerProgress(questionGroups, answers)).toEqual({
			answeredCount: 1,
			totalCount: 2,
			unansweredCount: 1,
		});
		expect(
			getUnansweredQuestions(questionGroups, answers).map(
				(question) => question.id,
			),
		).toEqual(["q1"]);
	});

	it("locks the submit action after a questionnaire is completed", () => {
		expect(
			getQuestionnaireSubmissionState({
				unansweredCount: 0,
				isCompleted: true,
				isImplementationLocked: false,
				isCapabilityEnabled: true,
			}),
		).toEqual({
			disabled: true,
			icon: undefined,
			label: "回答済み",
			readOnly: true,
			state: "completed",
		});
	});

	it("keeps the submit action enabled only for ready unanswered-free drafts", () => {
		expect(
			getQuestionnaireSubmissionState({
				unansweredCount: 0,
				isCompleted: false,
				isImplementationLocked: false,
				isCapabilityEnabled: true,
			}),
		).toMatchObject({
			disabled: false,
			icon: "send",
			label: "回答を送信して次へ",
			readOnly: false,
			state: "ready",
		});
		expect(
			getQuestionnaireSubmissionState({
				unansweredCount: 2,
				isCompleted: false,
				isImplementationLocked: false,
				isCapabilityEnabled: true,
			}),
		).toMatchObject({
			disabled: true,
			label: "未回答 2件",
			state: "incomplete",
		});
	});
});
