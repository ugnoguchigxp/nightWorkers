import { describe, expect, it } from "vitest";

import {
	areQuestionnaireAnswersComplete,
	buildQuestionnaireDecisionInventory,
	getQuestionDecisionKey,
	isDesignQuestionnaireAnswerComplete,
	listUnansweredBlockingQuestions,
	parseQuestionnaireAnswerViews,
	removeDuplicateFollowUpQuestions,
	removeDuplicateQuestionnaireQuestions,
	validateDesignQuestionnaireAnswerForQuestion,
} from "../api/modules/questionnaire/questionnaire-validation";

describe("questionnaire answer validation", () => {
	it("rejects multiple single-choice and unknown selected or ranked options", () => {
		expect(() =>
			validateDesignQuestionnaireAnswerForQuestion(
				answer({ selectedOptionIds: ["one", "two"] }),
				question({ answerType: "single_choice" }),
			),
		).toThrow("accepts only one");

		const choice = question({
			answerType: "multi_choice",
			options: [null, "invalid", { id: "known" }, { id: "" }],
		});
		expect(() =>
			validateDesignQuestionnaireAnswerForQuestion(
				answer({ selectedOptionIds: ["missing"] }),
				choice,
			),
		).toThrow("Unknown option");
		expect(() =>
			validateDesignQuestionnaireAnswerForQuestion(
				answer({ rankedOptionIds: ["missing"] }),
				choice,
			),
		).toThrow("Unknown option");
		expect(() =>
			validateDesignQuestionnaireAnswerForQuestion(
				answer({ selectedOptionIds: ["known"] }),
				choice,
			),
		).not.toThrow();
	});

	it.each([
		[question(), undefined, false],
		[question(), answer({ deferred: true }), true],
		[question({ answerType: "multi_choice" }), answer(), true],
		[question({ answerType: "boolean" }), answer(), false],
		[
			question({ answerType: "boolean" }),
			answer({ booleanValue: false }),
			true,
		],
		[question({ answerType: "free_text" }), answer({ freeText: "  " }), false],
		[question({ answerType: "free_text" }), answer({ freeText: "text" }), true],
		[question({ answerType: "ranked" }), answer(), false],
		[
			question({ answerType: "ranked" }),
			answer({ rankedOptionIds: ["one"] }),
			true,
		],
		[question(), answer(), false],
		[question(), answer({ selectedOptionIds: ["one"] }), true],
	] as const)("computes answer completeness %#", (item, value, expected) => {
		expect(isDesignQuestionnaireAnswerComplete(item, value)).toBe(expected);
	});

	it("requires at least one answerable question and every answer to be complete", () => {
		expect(
			areQuestionnaireAnswersComplete({ questionSets: [] }, new Map()),
		).toBe(false);
		const session = sessionWithQuestions([
			question({ id: "one" }),
			question({ id: "two", answerType: "boolean" }),
		]);
		expect(
			areQuestionnaireAnswersComplete(
				session as never,
				new Map([
					["one", answer({ questionId: "one", selectedOptionIds: ["yes"] })],
					["two", answer({ questionId: "two", booleanValue: true })],
				]),
			),
		).toBe(true);
		expect(
			areQuestionnaireAnswersComplete(
				sessionWithQuestions([question({ id: "missing" })]) as never,
				new Map(),
			),
		).toBe(false);
	});

	it("parses persisted answer views with schema defaults", () => {
		expect(
			parseQuestionnaireAnswerViews([
				{ questionId: "one", answerJson: { questionId: "one" } },
			]),
		).toEqual([
			{
				questionId: "one",
				answer: answer({ questionId: "one" }),
			},
		]);
	});
});

describe("questionnaire duplicate removal and inventory", () => {
	it.each([
		[
			question({ decisionKey: "decision.same" }),
			question({ decisionKey: "decision.same" }),
		],
		[
			question({ question: "配置を選んでください？" }),
			question({ question: "配置を選んでください。" }),
		],
		[
			question({
				options: [
					{ id: "a", label: "A" },
					{ id: "b", label: "B" },
				],
			}),
			question({
				options: [
					{ id: "b", label: "B" },
					{ id: "a", label: "A" },
				],
			}),
		],
	] as const)("removes direct duplicate form %#", (existing, candidate) => {
		const result = removeDuplicateQuestionnaireQuestions(
			sessionWithQuestions([existing]) as never,
			questionnaire([candidate]),
		);
		expect(result).toEqual({ questionnaire: null, skippedDuplicateCount: 1 });
	});

	it("removes answered semantic duplicates by labels, decision terms, and ngrams", () => {
		const semanticPairs = [
			[
				question({
					id: "existing",
					options: [
						{ id: "cloud", label: "クラウド" },
						{ id: "local", label: "ローカル" },
						{ id: "later", label: "未定" },
					],
				}),
				question({
					options: [
						{ id: "cloud-2", label: "クラウド" },
						{ id: "local-2", label: "ローカル" },
					],
				}),
			],
			[
				question({ id: "existing", question: "docker api の配置" }),
				question({ question: "docker api の運用" }),
			],
			[
				question({
					id: "existing",
					question: "通知ラベル詳細設定",
					options: [{ id: "shared", label: "共有" }],
				}),
				question({
					question: "通知ラベル詳細構成",
					options: [{ id: "shared-2", label: "共有" }],
				}),
			],
		] as const;

		for (const [existing, candidate] of semanticPairs) {
			const existingSession = sessionWithQuestions([existing]);
			existingSession.answers = [
				{
					questionId: "existing",
					answer: answer({ questionId: "existing" }),
				},
			];
			const result = removeDuplicateFollowUpQuestions(
				existingSession as never,
				questionnaire([candidate]),
			);
			expect(result).toBeNull();
		}
	});

	it("keeps distinct questions, removes empty sets, and counts candidates", () => {
		const existingSession = sessionWithQuestions([
			question({
				id: "existing",
				question: "unrelated",
				options: [{ id: "existing-option", label: "Existing" }],
			}),
		]);
		const value = questionnaire([
			question({
				id: "kept",
				question: "unique",
				options: [{ id: "unique-option", label: "Unique" }],
			}),
		]);
		(value.questionSets as unknown[]).push({
			id: "empty",
			questions: [question({ id: "duplicate", question: "unrelated" })],
		});
		const result = removeDuplicateQuestionnaireQuestions(
			existingSession as never,
			value,
		);
		expect(result.questionnaire?.questionSets).toHaveLength(1);
		expect(result.skippedDuplicateCount).toBe(1);
	});

	it("builds decision inventory with question and metadata blocking precedence", () => {
		const session = sessionWithQuestions([
			question({
				id: "explicit",
				blocking: false,
				decisionKey: "decision.explicit",
			}),
			question({ id: "metadata", blocking: undefined }),
			question({ id: "default", blocking: undefined }),
		]);
		session.questionSets[0].questionnaire.questionSets[0].metadata = {
			blocking: true,
		};
		session.answers = [
			{ questionId: "explicit", answer: answer({ questionId: "explicit" }) },
		];
		const inventory = buildQuestionnaireDecisionInventory(session as never);
		expect(
			inventory.map((item) => [item.questionId, item.answered, item.blocking]),
		).toEqual([
			["explicit", true, false],
			["metadata", false, true],
			["default", false, true],
		]);
	});

	it("lists only incomplete blocking answerable questions", () => {
		const blocking = question({ id: "blocking", blocking: true });
		const optional = question({ id: "optional", blocking: false });
		const complete = question({ id: "complete", blocking: true });
		const session = sessionWithQuestions([blocking, optional, complete]);
		session.answers = [
			{
				questionId: "complete",
				answer: answer({ questionId: "complete", selectedOptionIds: ["one"] }),
			},
		];
		expect(listUnansweredBlockingQuestions(session as never)).toEqual([
			expect.objectContaining({ id: "blocking" }),
		]);
	});

	it("builds explicit and all legacy decision key fallbacks", () => {
		expect(
			getQuestionDecisionKey(question({ decisionKey: " decision.key " })),
		).toBe("decision.key");
		expect(
			getQuestionDecisionKey(
				question({
					decisionKey: "",
					outputSection: "section",
					topic: "topic",
					question: "question",
				}),
			),
		).toBe("legacy.section.topic.question");
		expect(
			getQuestionDecisionKey(
				question({
					decisionKey: null,
					outputSection: "",
					topic: "",
					question: "",
					id: "id",
				}),
			),
		).toBe("legacy.section.id");
	});
});

function answer(overrides: Record<string, unknown> = {}) {
	return {
		questionId: "question",
		selectedOptionIds: [],
		rankedOptionIds: [],
		deferred: false,
		...overrides,
	};
}

function question(overrides: Record<string, unknown> = {}) {
	return {
		id: "question",
		topic: "topic",
		question: "question",
		answerType: "single_choice",
		options: [{ id: "one", label: "One" }],
		outputSection: "section",
		...overrides,
	};
}

function questionnaire(questions: unknown[]) {
	return {
		version: 1,
		source: { taskId: "task", repositoryId: "repository" },
		title: "Questionnaire",
		summary: "Summary",
		questionSets: [{ id: "set", questions }],
		openQuestions: [],
		dataModelHandoffNotes: [],
	} as never;
}

function sessionWithQuestions(questions: unknown[]) {
	return {
		questionSets: [{ questionnaire: questionnaire(questions) }],
		answers: [] as Array<{
			questionId: string;
			answer: ReturnType<typeof answer>;
		}>,
	};
}
