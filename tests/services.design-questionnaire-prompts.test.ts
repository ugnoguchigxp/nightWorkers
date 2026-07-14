import { describe, expect, it } from "vitest";
import {
	buildDesignQuestionnaireFollowUpDecisionSystemPrompt,
	buildDesignQuestionnaireFollowUpDecisionUserPrompt,
	buildDesignQuestionnaireInitialUserPrompt,
	buildDesignQuestionnaireSystemPrompt,
} from "../api/services/structured-generation/prompts/design-questionnaire";
import { questionnaireChoiceFormSchema } from "../shared/schemas/design-questionnaire.schema";

describe("design questionnaire prompts", () => {
	it("asks for starter stack and database choices needed to identify template variants", () => {
		const prompt = buildDesignQuestionnaireSystemPrompt();

		expect(prompt).toContain("使用する技術スタック");
		expect(prompt).toContain("DB/永続化");
		expect(prompt).toContain("branch variant");
		expect(prompt).toContain("Hono + React/Vite + SQLite");
		expect(prompt).toContain("通常の Hono starter は必ず");
		expect(prompt).toContain("RAG (Hono + React/Vite + pgvector)");
		expect(prompt).toContain("RAG の選択肢は必ず");
		expect(prompt).toContain("Python/FastAPI + React/Vite");
		expect(prompt).toContain("API only (FastAPI + SQLite)");
		expect(prompt).toContain("API only の選択肢は必ず");
		expect(prompt).toContain("Java 8 + Spring Boot 2.7 + React/Vite");
		expect(prompt).toContain("Java 25 + Spring Boot 4 + React/Vite");
		expect(prompt).toContain("Java 8 と Java 25 の選択肢を必ず含めて");
		expect(prompt).toContain("SQLite");
		expect(prompt).toContain("PostgreSQL");
		expect(prompt).toContain("pgvector");
		expect(prompt).toContain("Turso/libSQL");
		expect(prompt).toContain("各 options は 2-10 件");
		expect(prompt).toContain(
			"本当に複数の選択肢を同時に採用できる設問だけ checkbox",
		);
		expect(prompt).toContain("実装深度、優先度、段階");
		expect(prompt).toContain("単一軸の判断を checkbox で表現しない");
		expect(prompt).toContain("public / protected / auth / admin");
		expect(prompt).toContain("route / API / data の保護方針");
		expect(prompt).toContain("public only または auth only");
	});

	it("keeps missing template variant inputs in follow-up scope", () => {
		const prompt = buildDesignQuestionnaireFollowUpDecisionSystemPrompt();

		expect(prompt).toContain("使用技術スタック");
		expect(prompt).toContain("DB/永続化");
		expect(prompt).toContain("branch variant");
		expect(prompt).toContain("Hono + React/Vite + SQLite");
		expect(prompt).toContain("通常の Hono starter は必ず");
		expect(prompt).toContain("RAG (Hono + React/Vite + pgvector)");
		expect(prompt).toContain("RAG の選択肢は必ず");
		expect(prompt).toContain("API only (FastAPI + SQLite)");
		expect(prompt).toContain("API only の選択肢は必ず");
		expect(prompt).toContain("Java 8 + Spring Boot 2.7 + React/Vite");
		expect(prompt).toContain("Java 25 + Spring Boot 4 + React/Vite");
		expect(prompt).toContain("Java 8 と Java 25 を区別できる選択肢");
		expect(prompt).toContain("SQLite");
		expect(prompt).toContain("PostgreSQL");
		expect(prompt).toContain("pgvector");
		expect(prompt).toContain("Turso/libSQL");
		expect(prompt).toContain("各 options は 2-10 件");
		expect(prompt).toContain(
			"本当に複数の選択肢を同時に採用できる設問だけ checkbox",
		);
		expect(prompt).toContain("実装深度、優先度、段階");
		expect(prompt).toContain("単一軸の判断を checkbox で表現しない");
		expect(prompt).toContain("対象機能の配置が未回答");
		expect(prompt).toContain("auth / permission の確認");
	});

	it("includes concise project stack and plan mode context in initial questionnaire input", () => {
		const prompt = buildDesignQuestionnaireInitialUserPrompt({
			taskPrompt: "BBS を改善する",
			projectStackContext:
				"- 既存 Project stack: TypeScript + React + Vite + Hono\n- この stack は既存コードベースの前提です。ユーザーが変更を明示しない限り、別 stack / starter template 選択を質問しないでください。",
			planModeContext: [
				"Generated artifacts available before Questionnaire:",
				"- message=api-1; view=api_io_contract; title=BBS API",
				"Auth / permission context:",
				"- detected surfaces/signals: auth, protected, public",
			].join("\n"),
		});

		expect(prompt).toContain("## Project Stack Context");
		expect(prompt).toContain("TypeScript + React + Vite + Hono");
		expect(prompt).toContain("別 stack / starter template 選択を質問しない");
		expect(prompt).toContain("## Plan Mode Context");
		expect(prompt).toContain("view=api_io_contract");
		expect(prompt).toContain(
			"detected surfaces/signals: auth, protected, public",
		);
	});

	it("accepts up to ten choices in generated choice-form output", () => {
		const tenOptions = Array.from(
			{ length: 10 },
			(_, index) => `選択肢${index + 1}`,
		);

		expect(
			questionnaireChoiceFormSchema.safeParse({
				title: "テンプレート選定",
				questions: [
					{
						text: "使用する DB はどれですか？",
						type: "radio",
						options: tenOptions,
					},
				],
			}).success,
		).toBe(true);
		expect(
			questionnaireChoiceFormSchema.safeParse({
				title: "テンプレート選定",
				questions: [
					{
						text: "使用する DB はどれですか？",
						type: "radio",
						options: [...tenOptions, "選択肢11"],
					},
				],
			}).success,
		).toBe(false);
	});

	it("includes answered questions and selected labels in follow-up decision input", () => {
		const prompt = buildDesignQuestionnaireFollowUpDecisionUserPrompt({
			id: "00000000-0000-0000-0000-000000000001",
			taskId: "00000000-0000-0000-0000-000000000002",
			repositoryId: "00000000-0000-0000-0000-000000000003",
			sourceBlueprintMessageId: null,
			status: "answering",
			createdAt: new Date(),
			updatedAt: new Date(),
			questionSets: [
				{
					id: "00000000-0000-0000-0000-000000000004",
					sequence: 1,
					rawOutput: null,
					validationStatus: "valid",
					createdAt: new Date(),
					questionnaire: {
						version: 1,
						source: {
							taskId: "00000000-0000-0000-0000-000000000002",
							repositoryId: "00000000-0000-0000-0000-000000000003",
							sourceKind: "plan_mode_intake",
							blueprintMessageId: null,
						},
						title: "実装前に決めたいこと",
						summary: "実装前確認",
						openQuestions: [],
						dataModelHandoffNotes: [],
						questionSets: [
							{
								id: "choice-form",
								title: "実装前に決めたいこと",
								category: "実装前確認",
								purpose: "実装前に確認します。",
								questions: [
									{
										id: "q1",
										topic: "運用",
										question: "運用・保存の前提はどれですか？",
										why: "実装前に仕様判断が必要です。",
										answerType: "single_choice",
										options: [
											{
												id: "q1-o1",
												label: "ローカル開発のみ",
												tradeoff: "選択後に設計判断として整理します。",
											},
											{
												id: "q1-o2",
												label: "未定",
												tradeoff: "選択後に設計判断として整理します。",
											},
										],
										blocks: ["実装前の仕様判断"],
										outputSection: "question-1",
									},
								],
							},
						],
					},
				},
			],
			answers: [
				{
					id: "00000000-0000-0000-0000-000000000005",
					questionId: "q1",
					answeredAt: new Date(),
					answer: {
						questionId: "q1",
						selectedOptionIds: ["q1-o2"],
						rankedOptionIds: [],
						deferred: false,
					},
				},
			],
			reviews: [],
		});

		expect(prompt).toContain("answeredQuestions");
		expect(prompt).toContain("運用・保存の前提はどれですか？");
		expect(prompt).toContain("未定");
		expect(prompt).toContain("unansweredQuestions");
	});
});
