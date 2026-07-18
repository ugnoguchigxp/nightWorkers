import type { DesignQuestionnaireSession } from "../../../../shared/schemas/design-questionnaire.schema";
import type { QuestionnaireDecisionInventoryItem } from "../../../modules/questionnaire/questionnaire-validation";
import { FEATURE_PLAN_TRACEABILITY_STATEMENT } from "../../../modules/specification/specification-traceability";

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
	artifactInputPrompt?: string | null;
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

const TECH_STACK_QUESTION_GUIDANCE =
	"技術スタックの質問文は「どの技術スタックで実装しますか？」と簡潔にしてください。Project Stack Context や task に含まれる既存 template 名、認証、showcase などの説明を「〜を基に」のような前提句として質問文へ混ぜないでください。選択肢は、Hono + React/Vite (デフォルト)、RAG (Hono + React/Vite)、Python/FastAPI + React/Vite、API only (FastAPI)、Java 8 + Spring Boot 2.7 + React/Vite、Java 25 + Spring Boot 4 + React/Vite、Rust + Axum + React/Vite など、アプリケーションの runtime / framework 構成を識別できる粒度にしてください。「デフォルト」を独立した選択肢にはせず、通常の Hono starter の選択肢を必ず Hono + React/Vite (デフォルト) と表示してください。DB/永続化は必ず別の質問で選び、技術スタックの選択肢には SQLite、PostgreSQL、pgvector、Turso/libSQL などの DB 製品や永続化方式を含めないでください。RAG は RAG (Hono + React/Vite)、API only は API only (FastAPI)、Rust starter は Rust + Axum + React/Vite と表示してください。未materializedな新規Projectで技術スタックを質問する場合は、Java 8、Java 25、Rust + Axum + React/Vite の選択肢を必ず含めてください。";

const STARTER_TEMPLATE_DATABASE_VARIANT_POLICY =
	"SQLite と PostgreSQL は Hono、Python、Java、Rust の各基本技術スタックで専用 starter variant を利用できます。pgvector と Turso/libSQL の専用 starter variant は Hono と Python に限定されます。選択された技術スタックと DB の組み合わせに専用 variant がない場合は、選択した技術スタックと runtime version に対応する SQLite variant を雛形として使用し、ユーザーが選択した DB 要件は SQLite へ変更せず、DB driver、接続設定、schema/migration、query、検証の必要な差し替えを Feature Plan の implementationPlan.steps に含めてください。";

const DATABASE_QUESTION_GUIDANCE = `DB/永続化の質問では、SQLite、PostgreSQL、pgvector、Turso/libSQL、DBなし/後続決定など、template の branch variant または実装計画での DB 差し替えを識別できる選択肢にしてください。技術スタックに専用 variant がないことを理由に DB の選択肢を除外しないでください。${STARTER_TEMPLATE_DATABASE_VARIANT_POLICY}`;

const QUESTIONNAIRE_TITLE_GUIDANCE =
	"title は「実装前確認」のような短い汎用名にしてください。Task名、プロダクト名、機能名を入れず、ページ数、連番、進捗表記、括弧付きの 1/4 のような表記も入れないでください。";

const GRILL_ME_DECISION_GUIDANCE = [
	"grill-me では、ユーザーの依頼を言い換える質問ではなく、回答によって実装、公開契約、データ、権限、検証のいずれかが具体的に変わる未決定事項を質問してください。",
	"最初に、目的と成功状態、対象ユーザー、対象 / 非対象、主要操作と状態遷移、受け入れ条件の食い違いを確認し、その回答がないと決められない詳細を follow-up に回してください。",
	"必要に応じて、空状態・重複・上限・不正入力・権限不足・部分失敗・再試行・削除や復旧などのedge case、互換性、migration、rollback、監視・運用まで掘り下げてください。",
	"Task、既存Artifact、repository contextの間に矛盾や暗黙の仮定がある場合は、勝手に丸めず、その差によって実装が分かれる選択肢として明示してください。",
	"各質問は一つの判断軸だけを扱い、選択肢は実装者が異なる挙動として区別できる具体性を持たせてください。『適切に対応』『一般的な方法』『必要に応じて』のように実装を確定できない選択肢は作らないでください。",
	"radio の選択肢は同時に成立しない代替案、checkbox の選択肢は同時採用できる独立項目だけにしてください。削除方式と追加機能、認証方式と画面範囲など、別の判断軸を一つのcheckboxへ混ぜないでください。",
	"物理削除 / 論理削除、即時削除 / 復旧可能のように基本方針を一つ選ぶ判断はradioにし、検索・一括操作・通知などの任意機能とは別の質問にしてください。",
	"並び順と空状態、入力validationと件数上限、route配置と未認証API responseのような独立判断も一問に結合しないでください。初回回答がないと決められない下位論点は、結合せずfollow-upへ回してください。",
	"radio の選択肢同士で意味を重複させず、どの選択肢を選んだかだけで実装方針を一意に区別できるようにしてください。",
	"既存contextで確定済みの事項、通常のrepository調査で一意に分かる事項、回答しても設計や検証が変わらない好みは質問しないでください。",
].join("\n");

export function buildDesignQuestionnaireSystemPrompt() {
	return [
		"実装前の確認フォームを作ります。目的は、grill-me のように仕様の曖昧さを段階的に潰すことです。",
		"初回フォームでは、現時点で回答でき、実装方針を決めるために本当に必要な未決定事項だけを聞いてください。",
		"初期質問は15件を絶対上限とします。最低件数や目標件数はありません。15件を埋めるために質問を増やさず、必要な論点が少なければ少数で終了してください。",
		QUESTIONNAIRE_TITLE_GUIDANCE,
		GRILL_ME_DECISION_GUIDANCE,
		"質問ジャンルは task / blueprint / repository context から判断し、必要なものを選んでください。固定分類やキーワード一致で決めないでください。",
		"例として、scope、UI/UX、データ、backend/API、認証、外部連携、Docker、cloud deployment、storage、運用、非対象などが論点になり得ます。",
		"Questionnaire も後続の設計書と同じく、入力 context に含まれる既存資料と project context を材料にしてください。材料があるのに一般論だけで質問を作らないでください。",
		"auth / permission は対象面が public only または auth only と明確なら質問しないでください。public / protected / auth / admin などの面が混在する、または対象機能をどの面に置くか不明な場合は、初回または follow-up で route / API / data の保護方針を必ず確認してください。",
		"auth / permission の質問は「認証は必要ですか？」だけにせず、既存の public/protected 面、追加 route/API、データの所有境界に結びつく選択肢にしてください。",
		"テンプレート選定のため、使用する技術スタックと DB/永続化の選択が context から確定できない場合は、初回フォームで必ず確認してください。",
		TECH_STACK_QUESTION_GUIDANCE,
		DATABASE_QUESTION_GUIDANCE,
		"ただし、現時点の回答がないと答えられない下位論点は初回で無理に聞かず、回答後の follow-up に回してください。",
		"コードや入力contextから合理的に推定できることは、ユーザーに聞かず前提として扱ってください。",
		"ユーザーが Radio button または Checkbox で選べる質問だけを作ってください。",
		"自由記述、説明文、DB設計、分岐条件、id は作らないでください。",
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
		GRILL_ME_DECISION_GUIDANCE,
		QUESTIONNAIRE_TITLE_GUIDANCE,
		"ユーザー回答を読み、次に聞かないと答えられない下位論点や、まだ未確認の質問ジャンルが残っているか判定してください。",
		"question set sequence が4以上なら追加質問を出さず ready_for_design_assembly にしてください。この実行上限をtitleや質問文へ表示しないでください。",
		"answeredQuestions は既に回答済みの仕様判断です。選択肢が「未定」「後続決定」でも、その質問自体は回答済みとして扱い、同じ判断軸を言い換えて再質問しないでください。",
		"不足がある場合だけ action=follow_up にし、次に回答可能になったジャンルの追加質問を questionnaire に返してください。",
		"既存質問と同じ質問文、同じ意味、または同じ選択肢セットの質問は絶対に返さないでください。",
		"checkbox が未選択で回答されている場合、それは「どれも不要 / 今回は含めない」という仕様判断として扱ってください。",
		"一度の follow-up で全ジャンルを詰め込まず、次に設計判断を進めるために必要な質問だけを返してください。",
		"テンプレート選定に必要な使用技術スタックまたは DB/永続化の選択がまだ未確認なら、未確認の判断軸だけを追加質問にしてください。",
		TECH_STACK_QUESTION_GUIDANCE,
		DATABASE_QUESTION_GUIDANCE,
		"Docker、cloud deployment、storage、認証、外部連携、運用、非対象などは、回答内容または Plan Mode Context から必要性が見えた場合に追加確認してください。",
		"public / protected / auth / admin などの面が混在する、または対象機能の配置が未回答なら、auth / permission の確認を follow-up に含めてください。明確に public only または auth only なら繰り返し聞かないでください。",
		"コードや既存回答から合理的に推定できることは、ユーザーに聞かず前提として扱ってください。",
		"追加質問はユーザーが Radio button または Checkbox で選べるものだけにしてください。",
		"自由記述、説明文、DB設計、分岐条件、id は作らないでください。",
		"追加質問は最大10件です。最低件数や目標件数はなく、必要な質問だけを返してください。各 options は 2-10 件にしてください。",
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

export function buildSpecificationDocumentSystemPrompt(input?: {
	additionalSystemContext?: string | null;
}) {
	return [
		...(input?.additionalSystemContext ? [input.additionalSystemContext] : []),
		"Design Questionnaire、Blueprint summary、Data Model DDL reference、Implementation Plan Guidance をもとに、実装前に読む実装計画書を Markdown で作成してください。",
		"目的は、後続のコーディングエージェントが迷わず実装、検証、完了判定できることです。必要な判断だけを短く、実装順に読める計画にしてください。",
		"文体はストレートにしてください。背景説明、評価理由、Evidence の再掲、装飾的な言い回し、同じ内容の重複を避けてください。",
		"実装対象は Task と Target Project Context に記載されたプロジェクトです。生成・管理システム名を、実装対象アプリ名や実装先として本文に書かないでください。",
		"Target Project Context の Project name/root が NightWorkers 自体を指す場合を除き、本文で NightWorkers / NightWorker を実装対象名として使わないでください。",
		"Blueprint summary は選択された画面・section・component・copy・sample・props 要約です。JSON として扱わず、画面再現に必要な仕様判断として解釈してください。",
		"Questionnaire Decisions はTaskを具体化する設計判断として使用してください。Data Model DDL reference に将来拡張や対象外要素が含まれる場合は実装対象にしないでください。",
		STARTER_TEMPLATE_DATABASE_VARIANT_POLICY,
		"Questionnaire で技術スタックと DB/永続化が別々に確定している場合は、両方を組み合わせて starter variant と実装差分を決めてください。SQLite variant へのフォールバックは雛形取得方法であり、最終的な DB 要件の変更として扱わないでください。",
		"専用 variant がなく SQLite variant へフォールバックする場合、implementationPlan では SQLite variant の取得を taskType=scaffold の step、選択 DB への差し替えをそれに依存する taskType=implementation の step として分けてください。",
		"Questionnaire Decisions は参考情報ではなく、確定済みの設計判断です。各回答をSpecの対応箇所へ反映し、回答済みの選択肢を別の選択肢へ読み替えたり、projectに利用可能なtest scriptがあるという理由だけで選択外のtest種別を追加したりしないでください。",
		"検証方針を問うQuestionnaire回答は `## 検証計画` と `## 完了条件` の拘束条件です。unit / focused test / API smoke / DB verification / E2E の採否と範囲は回答どおりにし、Taskの最新の明示要件と衝突する場合は一方を黙って追加せず、未解決事項として明示してください。",
		"Data Model DDL reference は参考情報です。DDL や migration を実行する指示ではありません。DB 変更が必要な場合だけ、既存 tooling に従う schema/migration 作成・適用・検証ステップを書いてください。",
		"Plan Mode References は入力専用の関連資料 context です。最終文書に全件列挙せず、設計判断と契約の確定に使ってください。",
		"既生成資料は入力済みの設計判断として尊重し、同じ内容を不要に推測し直さないでください。矛盾がある場合は、入力全体から実装可能で一貫した解釈を選んでください。",
		"未決定事項は極力作らず、既存資料から合理的に決められる場合は前提として固定してください。実装を始めると危険な矛盾または欠落だけを未解決として短く残してください。",
		"Plan View References に API Contract や Zod Schema がある場合も、本文に詳細を再掲せず、`## 実装計画` で必要な参照先だけを短く示してください。",
		"API Contract / Zod Schema に JSON shape が含まれる場合でも、Feature Plan 本文に schema 全文や request / response / error shape を貼らないでください。詳細契約は assembled design context 側の責務です。",
		"auth / permission が仕様に影響する場合は、Questionnaire answer、Blueprint、または既存 project convention の根拠を1行で書いてください。根拠が無いまま public/protected/admin を固定しないでください。",
		"`A または B`、`必要に応じて`、`適宜` のような API / DB 契約の未決表現は避けてください。既存資料から決められない場合だけ assumption として短く残してください。",
		"contentTemplate の見出しは原則 `## 目的`, `## スコープ`, `## タスク分類`, `## 検証計画`, `## 完了条件`, `## トレーサビリティ` だけにしてください。実装計画の位置には `{{IMPLEMENTATION_PLAN}}` を正確に1件だけ置き、`## 実装計画` を別途書かないでください。",
		"`## 目的` は 1-2 文にしてください。",
		"`## スコープ` は対象 / 非対象を短い箇条書きにしてください。",
		"`## タスク分類` は分類と理由を 2-3 行で書いてください。",
		"production変更は implementationPlan.steps にだけ書いてください。DB / API / UI / domain logic / configuration を実装者が順番に完了判定できる粒度にし、API / UI / DB / validation の詳細は、それぞれ API Contract / Blueprint / Data Model / Zod Schema artifact を正として参照してください。",
		"implementationPlan は version=1、requiresDataMigration、steps を返してください。各stepは一意な key、title、description、taskType(scaffold または implementation)、dependsOnKeysを持ちます。test、verification、review、closeout、固定Todo gateはstepsへ入れないでください。",
		"implementationPlanを作るたびに、計画したproduction変更と現在のDB/schemaを照合してdata migrationの要否を判断してください。DB schema変更、既存データの変換・backfill、または既存環境へ適用するmigrationが必要な場合だけ requiresDataMigration=true にし、不要な場合はfalseにしてください。",
		"requiresDataMigration=true の場合は、migration fileの作成、既存toolingによる適用、対象schemaと関連機能の確認を行うproduction stepをimplementationPlan.stepsへ必ず1件以上含めてください。このstepは後続Coding AgentがtaskType=data_migrationのTodoとして分離できるtitleとdescriptionにし、固定Todo gateの文言そのものは使わないでください。requiresDataMigration=false の場合はmigration作業をstepsへ追加しないでください。",
		"stepsは実装順に並べ、dependsOnKeysは同じimplementationPlan内の先行stepのkeyだけを参照し、循環させないでください。",
		"`## 検証計画` は Target Project Context の `Project package scripts` に存在する script 名、または `## 実装計画` で追加すると明記した script 名だけを command として書いてください。存在しない `verify:e2e` や架空の focused test command を推測しないでください。",
		"`## 検証計画` は `## 完了条件` の各項目がどう確認されるかをつなぐテストケースゴールとして書いてください。unit / focused test / API smoke / DB verification / regression check のどれで確認するかが読める粒度にしてください。",
		"`Project package scripts` に `verify` または `verify:base` がある場合は、それを代表 gate として優先してください。同じ目的の `build` / `typecheck` / `lint` / `test` を `verify` と同列に重複列挙しないでください。",
		"`Project package scripts` に `verify` / `verify:base` が無い場合は、テンプレート未使用でも検証を弱めず、既存構成に合わせて build / typecheck / lint / test などを束ねる最小の verify 系 script 追加を `## 実装計画` に含めてください。",
		"個別の `build` / `typecheck` / `lint` / `test` は、対象範囲の確認、早期確認、または `verify` で代替できない理由がある場合だけ `## 検証計画` に含めてください。",
		"Hono/Bun template または `bun:*` API を使う DB/migration 実装では、migration 検証は Bun 実行環境の `bun test` または `bun run` 経由の CLI smoke を前提にしてください。Node/Vitest が `bun:*` を解決できない構成で動く integration test を検証計画にしないでください。",
		"`## 完了条件` は検証済み事実だけで書いてください。後続レビューでそのままテスト項目・検証ゴールとして使うため、各項目は確認対象と期待結果が分かる粒度に分けてください。",
		"`## 完了条件` では、UI 操作、DB 反映、API route、既存機能回帰などを 1 行に混ぜず、レビュー時に条件ごとのテスト有無を判定できる形にしてください。",
		"`## トレーサビリティ` は次の固定文だけを書いてください: " +
			FEATURE_PLAN_TRACEABILITY_STATEMENT,
		"画面仕様、機能要件、データ設計方針、参考情報、Evidence などの追加見出しは、重複になる場合は作らないでください。",
		"出力は JSON object のみで、title、contentTemplate、implementationPlan を返してください。contentTemplate は Markdown 文字列にしてください。",
	].join("\n");
}

export function buildSpecificationDocumentUserPrompt(
	context: SpecificationContext,
) {
	if (context.artifactInputPrompt?.trim())
		return context.artifactInputPrompt.trim();
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
