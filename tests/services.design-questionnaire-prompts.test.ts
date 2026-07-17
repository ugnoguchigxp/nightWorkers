import { describe, expect, it } from "vitest";
import {
	buildDesignQuestionnaireFollowUpDecisionSystemPrompt,
	buildDesignQuestionnaireFollowUpDecisionUserPrompt,
	buildDesignQuestionnaireInitialUserPrompt,
	buildDesignQuestionnaireSystemPrompt,
} from "../api/services/structured-generation/prompts/design-questionnaire";
import { questionnaireChoiceFormSchema } from "../shared/schemas/design-questionnaire.schema";

describe("design questionnaire prompts", () => {
	it("keeps starter stack choices independent from database choices", () => {
		const prompt = buildDesignQuestionnaireSystemPrompt();

		expect(prompt).toContain("回答によって実装、公開契約、データ、権限、検証");
		expect(prompt).toContain("目的と成功状態、対象ユーザー、対象 / 非対象");
		expect(prompt).toContain("主要操作と状態遷移、受け入れ条件");
		expect(prompt).toContain("権限不足・部分失敗・再試行・削除や復旧");
		expect(prompt).toContain("互換性、migration、rollback、監視・運用");
		expect(prompt).toContain("矛盾や暗黙の仮定");
		expect(prompt).toContain("各質問は一つの判断軸だけ");
		expect(prompt).toContain("同時採用できる独立項目だけ");
		expect(prompt).toContain("削除方式と追加機能");
		expect(prompt).toContain("物理削除 / 論理削除");
		expect(prompt).toContain("並び順と空状態");
		expect(prompt).toContain("結合せずfollow-upへ回して");
		expect(prompt).toContain("意味を重複させず");
		expect(prompt).toContain("初期質問は15件を絶対上限");
		expect(prompt).toContain("最低件数や目標件数はありません");
		expect(prompt).toContain("15件を埋めるために質問を増やさず");
		expect(prompt).toContain("Task名、プロダクト名、機能名を入れず");
		expect(prompt).toContain("1/4 のような表記も入れない");
		expect(prompt).not.toContain("最大4ページ");
		expect(prompt).not.toContain("1 ページ分");
		expect(prompt).not.toContain("原則 8-12 件");
		expect(prompt).toContain("通常のrepository調査で一意に分かる事項");
		expect(prompt).toContain("使用する技術スタック");
		expect(prompt).toContain("DB/永続化");
		expect(prompt).toContain("branch variant");
		expect(prompt).toContain("どの技術スタックで実装しますか？");
		expect(prompt).toContain(
			"既存 template 名、認証、showcase などの説明を「〜を基に」のような前提句として質問文へ混ぜない",
		);
		expect(prompt).toContain("Hono + React/Vite (デフォルト)");
		expect(prompt).toContain("「デフォルト」を独立した選択肢にはせず");
		expect(prompt).toContain("RAG (Hono + React/Vite)");
		expect(prompt).toContain("Python/FastAPI + React/Vite");
		expect(prompt).toContain("API only (FastAPI)");
		expect(prompt).toContain("Java 8 + Spring Boot 2.7 + React/Vite");
		expect(prompt).toContain("Java 25 + Spring Boot 4 + React/Vite");
		expect(prompt).toContain("Rust + Axum + React/Vite");
		expect(prompt).toContain(
			"Java 8、Java 25、Rust + Axum + React/Vite の選択肢を必ず含めて",
		);
		expect(prompt).toContain("DB/永続化は必ず別の質問で選び");
		expect(prompt).toContain(
			"技術スタックの選択肢には SQLite、PostgreSQL、pgvector、Turso/libSQL などの DB 製品や永続化方式を含めない",
		);
		expect(prompt).not.toContain("Hono + React/Vite + SQLite");
		expect(prompt).not.toContain("RAG (Hono + React/Vite + pgvector)");
		expect(prompt).not.toContain("API only (FastAPI + SQLite)");
		expect(prompt).toContain("SQLite");
		expect(prompt).toContain("PostgreSQL");
		expect(prompt).toContain("pgvector");
		expect(prompt).toContain("Turso/libSQL");
		expect(prompt).toContain(
			"SQLite と PostgreSQL は Hono、Python、Java、Rust の各基本技術スタック",
		);
		expect(prompt).toContain(
			"pgvector と Turso/libSQL の専用 starter variant は Hono と Python に限定",
		);
		expect(prompt).toContain(
			"専用 variant がないことを理由に DB の選択肢を除外しない",
		);
		expect(prompt).toContain("対応する SQLite variant を雛形として使用");
		expect(prompt).toContain("DB 要件は SQLite へ変更せず");
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

		expect(prompt).toContain("回答によって実装、公開契約、データ、権限、検証");
		expect(prompt).toContain("空状態・重複・上限・不正入力");
		expect(prompt).toContain("矛盾や暗黙の仮定");
		expect(prompt).toContain("使用技術スタック");
		expect(prompt).toContain("DB/永続化");
		expect(prompt).toContain("branch variant");
		expect(prompt).toContain("どの技術スタックで実装しますか？");
		expect(prompt).toContain(
			"既存 template 名、認証、showcase などの説明を「〜を基に」のような前提句として質問文へ混ぜない",
		);
		expect(prompt).toContain("Hono + React/Vite (デフォルト)");
		expect(prompt).toContain("「デフォルト」を独立した選択肢にはせず");
		expect(prompt).toContain("RAG (Hono + React/Vite)");
		expect(prompt).toContain("API only (FastAPI)");
		expect(prompt).toContain("Java 8 + Spring Boot 2.7 + React/Vite");
		expect(prompt).toContain("Java 25 + Spring Boot 4 + React/Vite");
		expect(prompt).toContain("Rust + Axum + React/Vite");
		expect(prompt).toContain(
			"Java 8、Java 25、Rust + Axum + React/Vite の選択肢を必ず含めて",
		);
		expect(prompt).toContain("DB/永続化は必ず別の質問で選び");
		expect(prompt).not.toContain("Hono + React/Vite + SQLite");
		expect(prompt).not.toContain("RAG (Hono + React/Vite + pgvector)");
		expect(prompt).not.toContain("API only (FastAPI + SQLite)");
		expect(prompt).toContain("SQLite");
		expect(prompt).toContain("PostgreSQL");
		expect(prompt).toContain("pgvector");
		expect(prompt).toContain("Turso/libSQL");
		expect(prompt).toContain(
			"pgvector と Turso/libSQL の専用 starter variant は Hono と Python に限定",
		);
		expect(prompt).toContain("対応する SQLite variant を雛形として使用");
		expect(prompt).toContain("implementationPlan.steps");
		expect(prompt).toContain("各 options は 2-10 件");
		expect(prompt).toContain(
			"本当に複数の選択肢を同時に採用できる設問だけ checkbox",
		);
		expect(prompt).toContain("実装深度、優先度、段階");
		expect(prompt).toContain("単一軸の判断を checkbox で表現しない");
		expect(prompt).toContain("対象機能の配置が未回答");
		expect(prompt).toContain("auth / permission の確認");
		expect(prompt).toContain("question set sequence が4以上");
		expect(prompt).toContain("この実行上限をtitleや質問文へ表示しない");
		expect(prompt).toContain("追加質問は最大10件");
		expect(prompt).not.toContain("最大4ページ");
		expect(prompt).not.toContain("必要な 1 ページ分");
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

	it("accepts at most fifteen initial questions", () => {
		const question = {
			text: "実装判断はどれですか？",
			type: "radio" as const,
			options: ["案A", "案B"],
		};

		expect(
			questionnaireChoiceFormSchema.safeParse({
				title: "実装前確認",
				questions: Array.from({ length: 15 }, () => question),
			}).success,
		).toBe(true);
		expect(
			questionnaireChoiceFormSchema.safeParse({
				title: "実装前確認",
				questions: Array.from({ length: 16 }, () => question),
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
