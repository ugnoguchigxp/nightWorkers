import { describe, expect, it } from "vitest";
import {
	COMPLETION_VERIFICATION_QUESTION_ID,
	resolveCompletionVerificationScope,
} from "../api/modules/questionnaire/questionnaire-completion-verification";
import { parseDesignQuestionnaireRaw } from "../api/modules/questionnaire/questionnaire-parser.service";
import {
	buildDesignQuestionnaireFollowUpDecisionSystemPrompt,
	buildDesignQuestionnaireFollowUpDecisionUserPrompt,
	buildDesignQuestionnaireInitialSystemPrompt,
	buildDesignQuestionnaireInitialUserPrompt,
	buildDesignQuestionnaireReviewSystemPrompt,
	buildDesignQuestionnaireSystemPrompt,
} from "../api/services/structured-generation/prompts/design-questionnaire";
import {
	generatedQuestionnaireChoiceFormSchema,
	questionnaireChoiceFormSchema,
} from "../shared/schemas/design-questionnaire.schema";

describe("design questionnaire prompts", () => {
	it("forbids stack and database selection for a materialized project", () => {
		const prompt = buildDesignQuestionnaireSystemPrompt("repository_fixed");

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
		expect(prompt).toContain("最終設問を含めて15件を絶対上限");
		expect(prompt).toContain("最低件数や目標件数はありません");
		expect(prompt).toContain("本当に必要な未決定事項を漏れなく質問");
		expect(prompt).toContain("必要な判断を省略してはいけません");
		expect(prompt).toContain("現時点で回答可能な必要論点が14件以内なら");
		expect(prompt).toContain("14件を埋めるために質問を増やさず");
		expect(prompt).toContain(
			"必要論点が14件を超える場合だけ、優先度の低い下位論点をfollow-up",
		);
		expect(prompt).toContain("application所有の固定設問");
		expect(prompt).toContain("kind=design_decision");
		expect(prompt).toContain("kind=completion_verification");
		expect(prompt).toContain("applicationが除外して固定設問へ置き換え");
		expect(prompt).toContain("Task名、プロダクト名、機能名を入れず");
		expect(prompt).toContain("1/4 のような表記も入れない");
		expect(prompt).not.toContain("最大4ページ");
		expect(prompt).not.toContain("1 ページ分");
		expect(prompt).not.toContain("原則 8-12 件");
		expect(prompt).toContain("通常のrepository調査で一意に分かる事項");
		expect(prompt).toContain("既存またはtemplate導入済みProject");
		expect(prompt).toContain("選択質問を生成してはいけません");
		expect(prompt).toContain("一般的なstack候補やDB製品候補からの再選択");
		expect(prompt).not.toContain(
			"どの技術スタックのtemplate projectをimportしますか？",
		);
		expect(prompt).not.toContain("第1問を技術スタック");
		expect(prompt).not.toContain("Hono + React/Vite (デフォルト)");
		expect(prompt).not.toContain("PostgreSQL、pgvector、Turso/libSQL");
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

	it("keeps stack and database reselection out of materialized follow-up", () => {
		const prompt =
			buildDesignQuestionnaireFollowUpDecisionSystemPrompt("repository_fixed");

		expect(prompt).toContain("回答によって実装、公開契約、データ、権限、検証");
		expect(prompt).toContain("空状態・重複・上限・不正入力");
		expect(prompt).toContain("矛盾や暗黙の仮定");
		expect(prompt).toContain("既存またはtemplate導入済みProject");
		expect(prompt).toContain("選択質問を生成してはいけません");
		expect(prompt).toContain("移行または置換をTaskで明示した場合だけ");
		expect(prompt).not.toContain(
			"どの技術スタックのtemplate projectをimportしますか？",
		);
		expect(prompt).not.toContain("Hono + React/Vite (デフォルト)");
		expect(prompt).not.toContain("PostgreSQL、pgvector、Turso/libSQL");
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

	it("requires explicit recommendation decisions only for the initial questionnaire", () => {
		const initialPrompt =
			buildDesignQuestionnaireInitialSystemPrompt("repository_fixed");
		const followUpPrompt =
			buildDesignQuestionnaireSystemPrompt("repository_fixed");

		expect(initialPrompt).toContain("{label, recommended}");
		expect(initialPrompt).toContain(
			"推奨できない場合は、全optionをrecommended=false",
		);
		expect(initialPrompt).toContain("radioではrecommended=trueを最大1件");
		expect(initialPrompt).toContain("位置や文言だけを理由に機械的に推奨せず");
		expect(followUpPrompt).toContain("options は文字列の配列");
		expect(followUpPrompt).not.toContain("{label, recommended}");
	});

	it("allows repository selection only for an empty unmaterialized project", () => {
		const prompt = buildDesignQuestionnaireSystemPrompt(
			"starter_selection_required",
		);

		expect(prompt).toContain("空の未materialized Project");
		expect(prompt).toContain(
			"登録済みProject folderを確認した結果、Git HEADもProject指示contextもない",
		);
		expect(prompt).toContain(
			"登録済みProject rootへimportするstarter templateのfamilyとvariantを確定",
		);
		expect(prompt).toContain(
			"repositoryMaterializationIntentとimplementationPlanの先頭Project import Todo",
		);
		expect(prompt).toContain("一意に選べない場合に限り");
		expect(prompt).toContain("技術スタックとDB/永続化を確認");
		expect(prompt).toContain("第1問を技術スタック、第2問をDB/永続化");
		expect(prompt).toContain("この2問より前に他の質問を置いてはいけません");
		expect(prompt).toContain("先頭設問を指定する場合は、その質問順を最優先");
		expect(prompt).toContain("本当に必要な未決定事項を漏れなく質問");
		expect(prompt).toContain("現時点で回答可能な必要論点が14件以内なら");
		expect(prompt).toContain(
			"どの技術スタックのtemplate projectをimportしますか？",
		);
		expect(prompt).toContain("Hono + React/Vite (デフォルト)");
		expect(prompt).toContain("RAG (Hono + React/Vite)");
		expect(prompt).toContain("Python/FastAPI + React/Vite");
		expect(prompt).toContain("API only (FastAPI)");
		expect(prompt).toContain("Java 8 + Spring Boot 2.7 + React/Vite");
		expect(prompt).toContain("Java 25 + Spring Boot 4 + React/Vite");
		expect(prompt).toContain("Rust + Axum + React/Vite");
		expect(prompt).toContain("DB/永続化は必ず別の質問で選び");
		expect(prompt).toContain(
			"importするtemplate projectのDB/永続化構成はどれにしますか？",
		);
		expect(prompt).toContain("SQLite、PostgreSQL、pgvector、Turso/libSQL");
		expect(prompt).toContain("DBなし/後続決定");
		expect(prompt).toContain(
			"専用 variant がないことを理由に DB の選択肢を除外しない",
		);
	});

	it("keeps fixed starter stack and database choices in follow-up", () => {
		const prompt = buildDesignQuestionnaireFollowUpDecisionSystemPrompt(
			"starter_selection_required",
		);

		expect(prompt).toContain(
			"どの技術スタックのtemplate projectをimportしますか？",
		);
		expect(prompt).toContain("Hono + React/Vite (デフォルト)");
		expect(prompt).toContain("Java 8 + Spring Boot 2.7 + React/Vite");
		expect(prompt).toContain("Java 25 + Spring Boot 4 + React/Vite");
		expect(prompt).toContain("Rust + Axum + React/Vite");
		expect(prompt).toContain("DB/永続化は必ず別の質問で選び");
		expect(prompt).toContain("SQLite、PostgreSQL、pgvector、Turso/libSQL");
		expect(prompt).toContain("DBなし/後続決定");
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

	it("preserves the completion verification answer for Feature Plan generation", () => {
		const prompt = buildDesignQuestionnaireReviewSystemPrompt();

		expect(prompt).toContain("decisionKey=completion.verification_scope");
		expect(prompt).toContain("outputSection=verification-scope");
		expect(prompt).toContain("テストを完了条件にしない回答も省略せず");
	});

	it("resolves completion verification scope from stable option ids", () => {
		expect(
			resolveCompletionVerificationScope({
				answers: [
					{
						questionId: COMPLETION_VERIFICATION_QUESTION_ID,
						answer: {
							selectedOptionIds: ["completion-verification-unit-e2e"],
						},
					},
				],
			}),
		).toBe("unit_and_e2e_if_ui");
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
						kind: "design_decision",
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
						kind: "design_decision",
						type: "radio",
						options: [...tenOptions, "選択肢11"],
					},
				],
			}).success,
		).toBe(false);
	});

	it("requires question provenance for new generation while preserving parser compatibility", () => {
		const legacyQuestionnaire = {
			title: "実装前確認",
			questions: [
				{
					text: "対象範囲はどれですか？",
					type: "radio",
					options: ["最小", "標準"],
				},
			],
		};

		expect(
			questionnaireChoiceFormSchema.safeParse(legacyQuestionnaire).success,
		).toBe(true);
		expect(
			generatedQuestionnaireChoiceFormSchema.safeParse(legacyQuestionnaire)
				.success,
		).toBe(false);
	});

	it("maps initial recommendations into the canonical questionnaire contract", () => {
		const parsed = parseDesignQuestionnaireRaw(
			JSON.stringify({
				title: "実装前確認",
				questions: [
					{
						text: "公開範囲はどれですか？",
						kind: "design_decision",
						type: "radio",
						options: [
							{ label: "認証済みユーザーのみ", recommended: true },
							{ label: "一般公開", recommended: false },
						],
					},
					{
						text: "追加する運用機能はどれですか？",
						kind: "design_decision",
						type: "checkbox",
						options: [
							{ label: "監査ログ", recommended: true },
							{ label: "通知", recommended: true },
							{ label: "どれも不要", recommended: false },
						],
					},
				],
			}),
			{
				taskId: "00000000-0000-0000-0000-000000000001",
				repositoryId: "00000000-0000-0000-0000-000000000002",
				sourceKind: "plan_mode_intake",
			},
		);

		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.value.questionSets[0]?.questions).toMatchObject([
			{
				id: "q1",
				recommendedAnswerId: "q1-o1",
				options: [{ id: "q1-o1", recommended: true }, { id: "q1-o2" }],
			},
			{
				id: "q2",
				options: [
					{ id: "q2-o1", recommended: true },
					{ id: "q2-o2", recommended: true },
					{ id: "q2-o3" },
				],
			},
		]);
		expect(
			parsed.value.questionSets[0]?.questions[1]?.recommendedAnswerId,
		).toBeUndefined();
	});

	it("rejects multiple recommendations for a generated radio question", () => {
		expect(
			generatedQuestionnaireChoiceFormSchema.safeParse({
				title: "実装前確認",
				questions: [
					{
						text: "公開範囲はどれですか？",
						kind: "design_decision",
						type: "radio",
						options: [
							{ label: "認証済みユーザーのみ", recommended: true },
							{ label: "一般公開", recommended: true },
						],
					},
				],
			}).success,
		).toBe(false);
	});

	it("reserves the fifteenth initial question for completion verification", () => {
		const question = {
			text: "実装判断はどれですか？",
			kind: "design_decision" as const,
			type: "radio" as const,
			options: ["案A", "案B"],
		};

		expect(
			questionnaireChoiceFormSchema.safeParse({
				title: "実装前確認",
				questions: Array.from({ length: 14 }, () => question),
			}).success,
		).toBe(true);
		expect(
			questionnaireChoiceFormSchema.safeParse({
				title: "実装前確認",
				questions: Array.from({ length: 15 }, () => question),
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
