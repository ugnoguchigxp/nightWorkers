import type { DesignQuestionnaireSession } from "../../../../shared/schemas/design-questionnaire.schema";
import type { QuestionnaireDecisionInventoryItem } from "../../../modules/questionnaire/questionnaire-validation";

type QuestionnaireSourceInput = {
	sourceBlueprintMessage?: {
		id: string;
		metadataJson?: unknown;
	} | null;
	taskPrompt: string;
	projectStackContext?: string | null;
	planModeContext?: string | null;
};

type SpecificationContext = {
	task: string;
	projectStackContext: string;
	implementationPlanGuidance: string;
	questionnaireDecisions: string;
	blueprintSummary: string;
	dataModelDdl: string;
	planViewReferences: string;
	planModeReferences: string;
	traceability: string;
	userRegenerationRequest?: string | null;
};

type AdditionalQuestionnairePromptInput = {
	task: string;
	source: "user_requested" | "artifact_triggered" | "pre_feature_plan_gate";
	reason?: string | null;
	maxQuestions: number;
	projectStackContext?: string | null;
	planModeContext?: string | null;
	decisionInventory: QuestionnaireDecisionInventoryItem[];
};

export function buildDesignQuestionnaireSystemPrompt() {
	return [
		"実装前の確認フォームを作ります。目的は、grill-me のように仕様の曖昧さを段階的に潰すことです。",
		"Questionnaire は最大4ページまで続けられます。初回はその1ページ目です。",
		"初回フォームでは、最初に回答できる重要論点を 1 ページ分まとめて聞いてください。",
		"質問ジャンルは task / blueprint / repository context から判断し、必要なものを選んでください。固定分類やキーワード一致で決めないでください。",
		"例として、scope、UI/UX、データ、backend/API、認証、外部連携、Docker、cloud deployment、storage、運用、非対象などが論点になり得ます。",
		"Questionnaire も後続の設計書と同じく、入力 context に含まれる既存資料と project context を材料にしてください。材料があるのに一般論だけで質問を作らないでください。",
		"auth / permission は対象面が public only または auth only と明確なら質問しないでください。public / protected / auth / admin などの面が混在する、または対象機能をどの面に置くか不明な場合は、初回または follow-up で route / API / data の保護方針を必ず確認してください。",
		"auth / permission の質問は「認証は必要ですか？」だけにせず、既存の public/protected 面、追加 route/API、データの所有境界に結びつく選択肢にしてください。",
		"テンプレート選定のため、使用する技術スタックと DB/永続化の選択が context から確定できない場合は、初回フォームで必ず確認してください。",
		"技術スタックの質問では、Hono + React/Vite、Python/FastAPI + React/Vite、API only、RAG など、starter template や branch variant を識別できる粒度の選択肢にしてください。",
		"DB/永続化の質問では、SQLite、PostgreSQL、pgvector、Turso/libSQL、DBなし/後続決定など、sqlite 等の template variant を識別できる選択肢にしてください。",
		"ただし、現時点の回答がないと答えられない下位論点は初回で無理に聞かず、回答後の follow-up に回してください。",
		"コードや入力contextから合理的に推定できることは、ユーザーに聞かず前提として扱ってください。",
		"ユーザーが Radio button または Checkbox で選べる質問だけを作ってください。",
		"自由記述、説明文、DB設計、分岐条件、id は作らないでください。",
		"質問は原則 8-12 件にしてください。明らかに論点が少ない場合だけ少なくして構いません。",
		"各 options は 2-10 件にしてください。",
		"type は単一選択なら radio、本当に複数の選択肢を同時に採用できる設問だけ checkbox にしてください。",
		"実装深度、優先度、段階、テンプレート/DB の選定など単一軸の判断を checkbox で表現しないでください。",
		"checkbox の質問では、ユーザーが「どれも不要」を表明できる選択肢を必ず1つ含めてください。",
		"選択肢は狭すぎる機能名だけにせず、「最小構成」「後続対応」「今回は含めない」など判断できる粒度を含めてください。",
		"JSON root は {title, questions} のみです。",
		"回答は JSON のみで返してください。",
	].join("\n");
}

export function buildDesignQuestionnaireInitialUserPrompt(
	input: QuestionnaireSourceInput,
) {
	const metadata = (input.sourceBlueprintMessage?.metadataJson || {}) as {
		appBlueprint?: unknown;
		mockBlueprint?: unknown;
	};
	const source = input.sourceBlueprintMessage
		? {
				sourceKind: "blueprint",
				blueprintMessageId: input.sourceBlueprintMessage.id,
				blueprint: metadata.appBlueprint || metadata.mockBlueprint,
			}
		: {
				sourceKind: "plan_mode_intake",
				prompt: input.taskPrompt,
			};
	return [
		input.sourceBlueprintMessage
			? "次の App Blueprint artifact を入力に、実装前に決めたい質問フォームを生成してください。"
			: "次の Plan mode intake を入力に、実装前に決めたい質問フォームを生成してください。",
		"",
		JSON.stringify(source, null, 2),
		"",
		"## Project Stack Context",
		input.projectStackContext?.trim() || "Project stack は未検出です。",
		"",
		"## Plan Mode Context",
		input.planModeContext?.trim() || "Plan Mode の追加 context は未検出です。",
	].join("\n");
}

export function buildDesignQuestionnaireFollowUpUserPrompt(
	session: DesignQuestionnaireSession,
	projectStackContext?: string | null,
	planModeContext?: string | null,
) {
	return [
		"次の質問票と回答をもとに、追加確認が必要な質問だけを follow-up question set として返してください。",
		"answeredQuestions は既に回答済みの仕様判断です。選択肢が「未定」「後続決定」でも、その質問自体は回答済みとして扱ってください。",
		"answeredQuestions と同じ質問、同じ判断軸、同じ意味の言い換え、同じ選択肢集合の質問は絶対に繰り返さないでください。",
		"追加質問は unansweredQuestions と answeredQuestions のどちらにも存在しない新しい判断軸だけにしてください。",
		"",
		"## Project Stack Context",
		projectStackContext?.trim() || "Project stack は未検出です。",
		"",
		"## Plan Mode Context",
		planModeContext?.trim() || "Plan Mode の追加 context は未検出です。",
		"",
		JSON.stringify(buildSessionPromptPayload(session), null, 2),
	].join("\n");
}

export function buildDesignQuestionnaireFollowUpDecisionSystemPrompt() {
	return [
		"目的は、実装前の仕様の曖昧さを grill-me のように質問攻めで潰すことです。",
		"ユーザー回答を読み、次に聞かないと答えられない下位論点や、まだ未確認の質問ジャンルが残っているか判定してください。",
		"Questionnaire は最大4ページまでです。4ページ目まで回答済みなら追加質問を出さず ready_for_design_assembly にしてください。",
		"answeredQuestions は既に回答済みの仕様判断です。選択肢が「未定」「後続決定」でも、その質問自体は回答済みとして扱い、同じ判断軸を言い換えて再質問しないでください。",
		"不足がある場合だけ action=follow_up にし、次に回答可能になったジャンルの追加質問を questionnaire に返してください。",
		"既存質問と同じ質問文、同じ意味、または同じ選択肢セットの質問は絶対に返さないでください。",
		"checkbox が未選択で回答されている場合、それは「どれも不要 / 今回は含めない」という仕様判断として扱ってください。",
		"一度の follow-up で全ジャンルを詰め込まず、次に設計判断を進めるために必要な 1 ページ分だけを返してください。",
		"テンプレート選定に必要な使用技術スタックまたは DB/永続化の選択がまだ未確認なら、starter template や branch variant を識別できる粒度で追加確認してください。",
		"DB/永続化の追加確認では、SQLite、PostgreSQL、pgvector、Turso/libSQL、DBなし/後続決定などを区別できる選択肢にしてください。",
		"Docker、cloud deployment、storage、認証、外部連携、運用、非対象などは、回答内容または Plan Mode Context から必要性が見えた場合に追加確認してください。",
		"public / protected / auth / admin などの面が混在する、または対象機能の配置が未回答なら、auth / permission の確認を follow-up に含めてください。明確に public only または auth only なら繰り返し聞かないでください。",
		"コードや既存回答から合理的に推定できることは、ユーザーに聞かず前提として扱ってください。",
		"追加質問はユーザーが Radio button または Checkbox で選べるものだけにしてください。",
		"自由記述、説明文、DB設計、分岐条件、id は作らないでください。",
		"追加質問は原則 4-10 件、各 options は 2-10 件にしてください。",
		"追加質問でも、type は単一選択なら radio、本当に複数の選択肢を同時に採用できる設問だけ checkbox にしてください。",
		"実装深度、優先度、段階、テンプレート/DB の選定など単一軸の判断を checkbox で表現しないでください。",
		"すでに回答から十分に判断できる内容を繰り返さないでください。",
		"十分であれば action=ready_for_design_assembly とし、questionnaire は null にしてください。",
		"回答は JSON のみで返してください。",
	].join("\n");
}

export function buildDesignQuestionnaireFollowUpDecisionUserPrompt(
	session: DesignQuestionnaireSession,
	projectStackContext?: string | null,
	planModeContext?: string | null,
) {
	return [
		"次の質問票とユーザー回答を評価し、Design Assembly に進めるか、さらに追質問が必要かを判定してください。",
		"追質問が必要な場合だけ、追加質問フォームを questionnaire に入れてください。",
		"answeredQuestions に含まれる質問と回答は必ず引き継ぎ、同じ質問や同じ判断軸を再生成しないでください。",
		"十分なら action は ready_for_design_assembly、questionnaire は null にしてください。",
		"",
		"## Project Stack Context",
		projectStackContext?.trim() || "Project stack は未検出です。",
		"",
		"## Plan Mode Context",
		planModeContext?.trim() || "Plan Mode の追加 context は未検出です。",
		"",
		JSON.stringify(buildSessionPromptPayload(session), null, 2),
	].join("\n");
}

export function buildAdditionalDesignQuestionnaireSystemPrompt() {
	return [
		"Plan Mode 中に追加確認が必要かを判断し、必要な場合だけ追加質問を返します。",
		"目的は、Blueprint、Data Model、API Contract、Zod Schema、Flow、Feature Plan 生成中に見えた矛盾や不足を、LLM が勝手に丸めずユーザーに確認することです。",
		"既存資料から合理的に決められる事項は質問しないでください。",
		"実装判断に影響しない好み質問は出さないでください。",
		"decisionInventory に同じ decisionKey、同じ質問、同じ選択肢集合がある場合は絶対に再質問しないでください。",
		"未回答の同 decisionKey がある場合も新規質問を作らず、空配列にしてください。",
		"blocking=true は、回答なしに Feature Plan を作ると仕様が危険に曖昧になる質問だけです。",
		"auth / permission、data ownership、migration、破壊的操作、外部連携、API / validation 矛盾は blocking になり得ます。",
		"API / DB 契約に「空または削除結果」「現在の status または切替指示」「作成順」「A または B」のような曖昧さがあり、project convention から決められない場合は追加質問にしてください。",
		"DELETE response、toggle semantics、id generation、sort direction、migration strategy は、実装者がその場で決めると危険な場合だけ blocking にしてください。",
		"non-blocking は回答すれば精度は上がるが既存資料や project convention で安全に進められるものだけです。",
		"質問は radio または checkbox のみです。自由記述は作らないでください。",
		"decisionKey は lower-case の dot 区切りにしてください。例: auth.scope.todo, api.todo.status_update_contract, data.todo.updated_at_strategy。",
		"質問不要なら questions は空配列です。",
		"回答は JSON object のみで、title, rationale, questions を返してください。",
	].join("\n");
}

export function buildAdditionalDesignQuestionnaireUserPrompt(
	input: AdditionalQuestionnairePromptInput,
) {
	return [
		"次の Plan Mode context から、今追加でユーザーに確認すべき実装判断だけを返してください。",
		`追加質問の最大件数: ${input.maxQuestions}`,
		`source: ${input.source}`,
		`reason: ${input.reason?.trim() || "明示理由なし"}`,
		"",
		"## Task",
		input.task,
		"",
		"## Project Stack Context",
		input.projectStackContext?.trim() || "Project stack は未検出です。",
		"",
		"## Plan Mode Context",
		input.planModeContext?.trim() || "Plan Mode の追加 context は未検出です。",
		"",
		"## Decision Inventory",
		JSON.stringify(input.decisionInventory, null, 2),
	].join("\n");
}

export function buildDesignQuestionnaireReviewSystemPrompt() {
	return [
		"回答を設計判断、後回し事項、未解決事項、Data Model handoff note に整理してください。",
		"DB table、column、relation、DDL の具体案は作らず、Data Model へ渡す制約・論点だけを書いてください。",
		"sourceQuestionIds と unresolvedQuestionIds を必ず保持してください。",
	].join("\n");
}

export function buildDesignQuestionnaireReviewUserPrompt(
	session: DesignQuestionnaireSession,
) {
	return JSON.stringify(
		{
			sessionId: session.id,
			sourceBlueprintMessageId: session.sourceBlueprintMessageId,
			questionSets: session.questionSets.map((set) => set.questionnaire),
			answers: session.answers.map((answer) => answer.answer),
		},
		null,
		2,
	);
}

export function buildSpecificationDocumentSystemPrompt() {
	return [
		"Design Questionnaire、Blueprint summary、Data Model DDL reference、Implementation Plan Guidance をもとに、実装前に読む実装計画書を Markdown で作成してください。",
		"目的は、後続のコーディングエージェントが迷わず実装、検証、完了判定できることです。必要な判断だけを短く、実装順に読める計画にしてください。",
		"文体はストレートにしてください。背景説明、評価理由、Evidence の再掲、装飾的な言い回し、同じ内容の重複を避けてください。",
		"実装対象は Task と Target Project Context に記載されたプロジェクトです。生成・管理システム名を、実装対象アプリ名や実装先として本文に書かないでください。",
		"Target Project Context の Project name/root が NightWorkers 自体を指す場合を除き、本文で NightWorkers / NightWorker を実装対象名として使わないでください。",
		"Blueprint summary は選択された画面・section・component・copy・sample・props 要約です。JSON として扱わず、画面再現に必要な仕様判断として解釈してください。",
		"Questionnaire Decisions を採用判断の正としてください。Data Model DDL reference と衝突する場合は Questionnaire を優先し、DDL 側の対象外要素は実装対象にしないでください。",
		"Data Model DDL reference は参考情報です。DDL や migration を実行する指示ではありません。DB 変更が必要な場合だけ、既存 tooling に従う schema/migration 作成・適用・検証ステップを書いてください。",
		"Plan Mode References は入力専用の関連資料 context です。最終文書に全件列挙せず、設計判断と契約の確定に使ってください。",
		"既生成資料は正本として信頼し、同じ内容を推測し直さないでください。矛盾がある場合は、最新ユーザー指示、Questionnaire Decisions、各 domain の専用 view、既存 repository context の順に優先してください。",
		"未決定事項は極力作らず、既存資料から合理的に決められる場合は前提として固定してください。実装を始めると危険な矛盾または欠落だけを未解決として短く残してください。",
		"Plan View References に API Contract や Zod Schema がある場合は、本文に詳細を再掲せず、`## 実装計画` と `## トレーサビリティ` でどの artifact を正本として使うかを短く示してください。",
		"API Contract / Zod Schema に JSON shape が含まれる場合でも、Feature Plan 本文に schema 全文や request / response / error shape を貼らないでください。詳細契約は assembled design context 側の責務です。",
		"auth / permission が仕様に影響する場合は、Questionnaire answer、Blueprint、または既存 project convention の根拠を1行で書いてください。根拠が無いまま public/protected/admin を固定しないでください。",
		"`A または B`、`必要に応じて`、`適宜` のような API / DB 契約の未決表現は避けてください。既存資料から決められない場合だけ assumption として短く残してください。",
		"content の見出しは原則 `## 目的`, `## スコープ`, `## タスク分類`, `## 実装計画`, `## 検証計画`, `## 完了条件`, `## トレーサビリティ` だけにしてください。",
		"`## 目的` は 1-2 文にしてください。",
		"`## スコープ` は対象 / 非対象を短い箇条書きにしてください。",
		"`## タスク分類` は分類と理由を 2-3 行で書いてください。",
		"`## 実装計画` は番号付きで DB / API / UI / test / verification の順に、各項目 1-2 文で書いてください。API / UI / DB / validation の詳細は、それぞれ API Contract / Blueprint / Data Model / Zod Schema artifact を正として参照する形にしてください。",
		"`## 検証計画` は Target Project Context の `Project package scripts` に存在する script 名だけを command として書いてください。存在しない `verify:e2e` や架空の focused test command を推測しないでください。",
		"`## 完了条件` は検証済み事実だけで書いてください。",
		"`## トレーサビリティ` は source ID 羅列ではなく、実装判断に効いた資料種別、採用判断、詳細契約は assembled design context にあることだけを短く書いてください。監査用 ID は metadata 側に残るため本文に列挙しないでください。",
		"画面仕様、機能要件、データ設計方針、参考情報、Evidence などの追加見出しは、重複になる場合は作らないでください。",
		"出力は JSON object のみで、title と content を返してください。content は Markdown 文字列にしてください。",
	].join("\n");
}

export function buildSpecificationDocumentUserPrompt(
	context: SpecificationContext,
) {
	return [
		"次の圧縮済み context から Specification を作成してください。",
		"",
		"## Task",
		context.task,
		"",
		"## Target Project Context",
		context.projectStackContext,
		"",
		"## Implementation Plan Guidance",
		context.implementationPlanGuidance,
		context.userRegenerationRequest?.trim()
			? [
					"",
					"## User Regeneration Request",
					context.userRegenerationRequest.trim(),
					"",
					"上記の再生成指示を優先してください。ただし、指摘されていない既存 artifact の確定判断は維持し、Feature Plan 全体を不要に広げないでください。",
				].join("\n")
			: null,
		"",
		"## Questionnaire Decisions",
		context.questionnaireDecisions,
		"",
		"## Blueprint Summary",
		context.blueprintSummary,
		"",
		"## Data Model DDL Reference",
		context.dataModelDdl,
		"",
		"## Plan View References",
		context.planViewReferences,
		"",
		"## Plan Mode References",
		context.planModeReferences,
		"",
		"## Traceability",
		context.traceability,
	]
		.filter((line): line is string => line !== null)
		.join("\n");
}

function buildSessionPromptPayload(session: DesignQuestionnaireSession) {
	const allQuestions = session.questionSets.flatMap((set) =>
		(set.questionnaire?.questionSets || []).flatMap(
			(questionSet) => questionSet.questions,
		),
	);
	const questionById = new Map(
		allQuestions.map((question) => [question.id, question]),
	);
	const answeredQuestionIds = new Set(
		session.answers.map((answer) => answer.questionId),
	);
	return {
		sessionId: session.id,
		taskId: session.taskId,
		repositoryId: session.repositoryId,
		sourceBlueprintMessageId: session.sourceBlueprintMessageId,
		questionSets: session.questionSets.map((set) => set.questionnaire),
		answers: session.answers.map((answer) => answer.answer),
		answeredQuestions: session.answers.map((answer) => {
			const question = questionById.get(answer.questionId);
			const optionById = new Map(
				(question?.options || []).map((option) => [option.id, option]),
			);
			return {
				questionId: answer.questionId,
				question: question?.question ?? null,
				topic: question?.topic ?? null,
				answerType: question?.answerType ?? null,
				selectedOptionLabels: answer.answer.selectedOptionIds.map(
					(optionId) => optionById.get(optionId)?.label ?? optionId,
				),
				rankedOptionLabels: answer.answer.rankedOptionIds.map(
					(optionId) => optionById.get(optionId)?.label ?? optionId,
				),
				booleanValue: answer.answer.booleanValue ?? null,
				freeText: answer.answer.freeText ?? null,
				deferred: answer.answer.deferred,
			};
		}),
		unansweredQuestions: allQuestions
			.filter((question) => !answeredQuestionIds.has(question.id))
			.map((question) => ({
				questionId: question.id,
				question: question.question,
				topic: question.topic,
				answerType: question.answerType,
				optionLabels: (question.options || []).map((option) => option.label),
			})),
	};
}
