import type { Input } from "@openai/codex-sdk";
import { getNightWorkersCodexToolNames } from "../../../mcp/nightworkers-tool-manifest";
import {
	formatOntologyCloseoutRequirementsForPrompt,
	formatOntologyRuntimeContextForPrompt,
} from "../../../modules/ontology";
import { estimateTokens } from "../../conversation-context/token-budget";
import { formatRuntimeWorkspaceContextForPrompt } from "../runtime-workspace-context";
import type { AgentRunContext } from "../types";

export function buildCodexRuntimePrompt(context: AgentRunContext): string {
	return buildCodexRuntimePromptParts(context).prompt;
}

export function buildCodexRuntimeInput(
	context: AgentRunContext,
	prompt: string,
): Input {
	if (!context.imageAttachments?.length) return prompt;
	return [
		{ type: "text", text: prompt },
		...context.imageAttachments.map((image) => ({
			type: "local_image" as const,
			path: image.path,
		})),
	];
}

export function buildCodexRuntimeTurnInput(
	context: AgentRunContext,
	prompt: string,
	imageInputSent: boolean,
): Input {
	return imageInputSent ? prompt : buildCodexRuntimeInput(context, prompt);
}

export type CodexRuntimePromptParts = {
	prompt: string;
	request: string;
	runtimeContract: string;
	estimates: {
		requestTokens: number;
		runtimeContractTokens: number;
		fullPromptTokens: number;
	};
};

export function buildCodexRuntimePromptParts(
	context: AgentRunContext,
): CodexRuntimePromptParts {
	const request = (context.latestUserMessage || context.compiledPrompt).trim();
	const executionMode = readCodexRuntimeExecutionMode(context);
	const ontologyMcpEnabled = readOntologyMcpEnabled(context);
	const nightWorkersToolList = getNightWorkersCodexToolNames({
		executionMode,
		ontologyMcpEnabled,
	}).join(", ");
	const runtimeContract =
		executionMode === "general_answer"
			? buildGeneralAnswerContract(context, nightWorkersToolList)
			: executionMode === "review"
				? buildReviewContract(context, nightWorkersToolList)
				: buildExecutionContract(context, nightWorkersToolList, executionMode);
	const prompt = request ? `${request}\n\n${runtimeContract}` : runtimeContract;
	return {
		prompt,
		request,
		runtimeContract,
		estimates: {
			requestTokens: estimateTokens(request),
			runtimeContractTokens: estimateTokens(runtimeContract),
			fullPromptTokens: estimateTokens(prompt),
		},
	};
}

function buildGeneralAnswerContract(
	context: AgentRunContext,
	nightWorkersToolList: string,
) {
	const readOnlyToolList =
		nightWorkersToolList
			.split(", ")
			.filter(
				(toolName) =>
					toolName !== "nightworkers.todo_list" &&
					toolName !== "nightworkers.import_project",
			)
			.join(", ") || "none";
	return [
		"[NightWorkers Runtime Contract]",
		`taskId: ${context.taskId}`,
		`runId: ${context.runId}`,
		...formatRuntimeWorkspaceContextForPrompt(context),
		"executionMode: general_answer",
		"Plan mode: disabled. この run は質問への回答用です。Plan Mode artifact を作成・更新せず、実装編集も行わず、必要な読み取り確認だけで回答してください。",
		"",
		"NightWorkers MCP:",
		"- MCP server name: nightworkers",
		`- Available read-only NightWorkers MCP tools in this lane: ${readOnlyToolList}.`,
		"",
		"General answer behavior:",
		"- ユーザーの質問に答えるための読み取り確認だけを行う。",
		"- Plan Mode artifact、Plan Mode Workspace、TodoList、Implementation Queue を作成・更新しない。",
		"- 実装編集、テスト実行、レビュー、verify、closeout gate を開始しない。",
		"- 完了済みの Plan Mode artifact は証跡として扱い、後続の質問で再編集・再オープン対象にしない。",
		"- 回答に必要な根拠が確認できたら、短く直接回答する。",
	].join("\n");
}

function buildExecutionContract(
	context: AgentRunContext,
	nightWorkersToolList: string,
	executionMode: ReturnType<typeof readCodexRuntimeExecutionMode>,
) {
	if (executionMode === "planning") {
		return buildPlanningContract(context, nightWorkersToolList);
	}
	if (executionMode === "test") {
		return buildTestModeContract(context, nightWorkersToolList);
	}
	const planModeContract =
		"Plan mode: disabled. ユーザーはこの run で Plan Mode を明示していない。計画だけの回答で止まらず、implementation-plan artifact を主成果物として作らない。";
	const ontologyProtocol = buildOntologyProtocolContract(context);
	const repositoryBootstrap = Boolean(
		context.runtimeOptions?.repositoryBootstrap,
	);
	const contract = [
		"[NightWorkers Runtime Contract]",
		`taskId: ${context.taskId}`,
		`runId: ${context.runId}`,
		...formatRuntimeWorkspaceContextForPrompt(context),
		`executionMode: ${executionMode}`,
		planModeContract,
		"",
		"NightWorkers MCP:",
		"- MCP server name: nightworkers",
		`- Available NightWorkers MCP tools in this lane: ${nightWorkersToolList}.`,
		"- Treat nightworkers MCP tools as the execution interface. When a named NightWorkers tool fits, call it directly instead of describing equivalent shell steps.",
		"- context-still.initial_instructions は、この task で未実行の場合だけ作業前に一度実行して従う。チャット入力ごとに再実行しない。",
		"",
		...(ontologyProtocol ? [ontologyProtocol, ""] : []),
		...(repositoryBootstrap
			? [
					"Repository bootstrap run:",
					"- このrunは通常機能の実装runではありません。登録済みrepoRootを初期化するbootstrap専用です。",
					"- 最初にpwdとlist-dir / ls相当でrepoRootの存在、空状態、.gitの有無を確認してください。",
					"- Git HEADがなく空または未materializedならnightworkers.import_projectを実行してください。未指定のHono Web/APIはsource=starter, stack=honoとし、variantを省略して既定SQLiteを使ってください。",
					"- import_project後にGit HEADとbaseline commitを確認し、通常機能のファイル編集や実装には進まずbootstrap Todoと固定gateだけを完了してください。",
					"",
				]
			: []),
		"実装時の最小実行方針:",
		"- 明示的な計画・仕様化依頼でない限り、対象変更と必要な局所確認を同じ実作業 Todo の中で扱う。小変更で詳細な implementation-plan artifact を作らない。Todo tracking、quality_gate_verify、closeout は省略しない。",
		"- テスト実装は原則 Test Mode の担当です。Implementation Mode では production change と必要最小限の局所確認に集中してください。既存テストの軽微な修正や失敗原因切り分けを除き、新規 test file / broad test coverage の追加を主成果物にしないでください。",
		"- 仕様が正本の場合、または planning / specification / design-doc / requirement-check / 既存仕様前提の実装では、最初に nightworkers.read_current_specification を呼ぶ。設計契約が実装に影響する場合は includeDesignContext=true。必要な仕様が見つからなければ nightworkers.list_recent_specifications から taskId を選んで読む。仕様と assembled design context を計画・実装・検証の根拠にする。",
		"- 実行順は specification -> Todo execution -> verification -> closeout。closeout は実装と検証が終わり、実装 Todo に pending / running がない場合だけ開始する。NightWorkers の「完了報告」は TodoList 末尾の「完了報告を行う」gate の最終 assistant report だけを指し、Todo 作成結果、計画共有、途中経過、次着手メッセージは含めない。",
		"- Todo 操作は nightworkers.todo_list に統一する。TodoList pane がユーザー向け進捗の正本で、Timeline cards は Todo 進捗や内部警告の機構ではない。SystemContext / Todo snapshot の coding_preparation / completion_report は読み取り用の固定 gate であり、replace で再定義する実作業 Todo ではない。",
		"- operation=replace は scope / estimate / 分解変更時の構造再計画だけに使い、完了印には使わない。writable input はユーザー依頼に対応する実装・調査などの実作業 Todo だけ。局所確認は該当する実作業 Todo の完了条件に含め、`必要最小限の動作確認を行う` のようなユーザー依頼にない独立検証 Todo を追加しない。completion_report Todo や広域 verify Todo を意図的に含めない。固定 gate は NightWorkers が追加・merge する。",
		"- 2 手以上の調査・レビュー・実装・検証では、最初の実質作業前に既存 Todo を start するか、必要な場合だけ replace する。作業段階が変わる tool 実行前に対応 Todo を running にし、編集・DB mutation・長い検証・review 判定後は具体的 evidence で done / block / fail に整理する。operation=list は診断専用で進捗変更に使わない。",
		"- operation=done は具体的 evidence がある current Todo にだけ使い、次の pending Todo を自動 start する。承認・入力待ちは block、実装・検証の具体的失敗は fail。fail / block / skipped は終端状態なので再 start しない。前の Todo が pending / running のまま後続 Todo を始めない。検証不能または失敗時は検証 Todo を先に fail / block する。",
		"- 最終 assistant report 前に open Todo を確認し、未完了 Todo は done / block / fail に整理する。未確認 mutation や未実施 verification を done にしない。Todo 追跡 MCP が失敗しても次の実装行動が明確なら実装は続ける。追跡失敗は完了ではない。実装・scaffold・検証 Todo が running なら plan-only answer や next-steps summary で止まらず、作業継続または current Todo の block / fail を行う。",
		"- quality_gate_verify Todo が current になる前は、修正途中の最小局所確認だけ行う。targeted E2E は current specification / Questionnaire Decisions が E2E 必須または主軸と明示した場合だけ使う。Questionnaire が unit 主軸なら E2E Todo / E2E command を追加・実行しない。リポジトリ全体の広域 verify は quality_gate_verify Todo が current の時だけ実行し、成功後にファイル変更がなければ再実行しない。",
		"- lint / format:check / typecheck / test / coverage / build / verify / completion_check は NightWorkers の run_check / run_verification / completion_check が正式 evidence 経路です。native command_execution で途中確認しても、closeout 前には managed check を実行してください。",
		"- package.json に verify script があれば、完了報告前の代表検証は verify command を優先する。verify が format / typecheck / lint / test を含む場合、個別コマンドを重複実行しない。個別実行は修正途中の切り分け、または verify がない・実行不能な場合の fallback に限る。verify 未実行なら理由と代替検証を final report に書く。",
		"- 同一 Todo 内の関連変更は、読み取りと方針整理後にまとめて編集する。1 エラー / 1 ファイルごとの逐次 file_change ループを避ける。",
		"- verify 失敗時はエラー全体を分類し、同じ原因・同じ層をまとめて修正してから再実行する。",
		"- DB schema / migration / 永続化テーブル変更では、TodoList に固定 gate「DB migration を実行する」が必要です。migration ファイル、DB schema、DB bootstrap / seed / persistence table 定義を作成・更新する必要が分かった時点で、編集前または直後に nightworkers.todo_list operation=replace を使い、todoListReplaceReason=newly_required_work または scope_changed として taskType=data_migration または procedureId=data_migration.apply_migration の Todo を含める。",
		"- DB migration Todo は、migration 作成、実作業対象 DB への適用、schema/table 確認、関連 API または focused test 成功まで done にしない。migration 作成だけ、隔離 DB の smoke だけ、通常 implementation Todo だけで DB 変更を閉じない。",
		"- ファイルを編集する前に、対象ファイルまたは直接関係する既存ファイルを読む。新規ファイルでは配置先 route / registry / sibling component / 既存 style / test pattern を先に読む。rg --files や ls は探索であり編集対象を読んだ evidence ではない。rg -n、sed、cat、nl、head/tail、git diff -- path など対象内容に触れる確認を使う。blind edit を避け、必要範囲だけ読む。",
		"- 作成または大幅編集後は、検証や closeout の前に関係箇所を読み返す。新規ファイルは作成ファイルまたは path-scoped diff、既存ファイルは変更箇所または git diff -- path を確認する。",
		"- Project import は nightworkers.import_project が単一入口。新規 scaffold は source=starter と stack/variant、任意 Git は source=git と repoUrl。未指定の空または空に近い Web/API app は、ユーザーが別 stack / blank / DB / RAG / SSR / SSG variant を明示しない限り source=starter, stack=hono、既定 SQLite variant を使う。DB 指定は postgres / pgvector / turso / cloudflare 等、RAG や embeddings-backed search は variant=rag、DB/RAG variant なしの SSR / SSG 指定は対応 overlay。DB/RAG variant と overlay は同時指定しない。",
		"- import_project で扱える task では shell git clone を使わない。import_project が失敗・cancel・未承認なら停止して tool failure を報告し、fallback static app や代替実装を作らない。starter / template / clone / import_project task では、作業開始時にまず pwd と list-dir / ls 相当で targetPath の存在、空状態、.git の有無を確認する。空または空に近い targetPath は未 materialized と扱い、import_project または clone 成功前に targetPath 内の package.json や source files を shell/read tools で読まない。",
		"- import_project 成功後は postImport.gitInitialization、postImport.llmContext、postImport.manifest、postImport.initialization を先に使う。payload 欠落、truncated、または修復対象の失敗がある場合を除き、LLM_CONTEXT.md / package.json の再読込や install 再実行をしない。manifest-based verification は postImport.manifest.recommendedVerificationCommands を優先する。",
		"- zsh command で find -name などに glob pattern を渡す場合は、zsh の先行展開を避けるため quote する。例: -name 'vite.config.*'。",
		"- NightWorkers task_run id を外部 MCP runId として渡さない。context-still compile_eval では context_compile が返した runId だけを使い、なければ runId を省略して tool に latest session run を解決させる。",
		"- context-still compile_eval は context_compile を使った run の closeout feedback です。ユーザーへ保存可否を Yes / No で質問せず、常に保存許可として扱ってください。coding_preparation / completion_report など NightWorkers-managed gate の Todo に紐づく場合も、その紐づけを理由にユーザー確認へ戻さないでください。",
	].join("\n");
	return contract;
}

function buildTestModeContract(
	context: AgentRunContext,
	nightWorkersToolList: string,
) {
	const testModeAction = readTestModeAction(context);
	const missionPilotRun = Boolean(context.runtimeOptions?.missionPilot);
	return [
		"[NightWorkers Runtime Contract]",
		`taskId: ${context.taskId}`,
		`runId: ${context.runId}`,
		...formatRuntimeWorkspaceContextForPrompt(context),
		"executionMode: test",
		...(testModeAction ? [`testMode.action: ${testModeAction}`] : []),
		"Plan mode: disabled. この run は Test Mode です。Implementation run の thread/history を前提にせず、仕様書の completion conditions と verification JSON を source of truth にしてください。",
		"",
		"NightWorkers MCP:",
		"- MCP server name: nightworkers",
		`- Available Test Mode tools in this lane: ${nightWorkersToolList}.`,
		"- context-still.initial_instructions は、この task で未実行の場合だけ作業前に一度実行して従う。チャット入力ごとに再実行しない。",
		"",
		"Test Mode behavior:",
		"- 最初に nightworkers.read_current_specification view=verification を読み、verification JSON / Verification Checklist の完了条件を検証観点の正本にする。",
		"- Test Mode agent は Implementation agent とは別 session で動く。Implementation run の thread/history を引き継がず、この run 内で必要な仕様・ファイル・テストを読み直す。",
		"- testMode.action が plan_and_implement_tests の場合、画面上のワークフロー順に、実装開始 -> ユニットテスト実行 -> 証跡テストチェックを進める。実装開始では Verification Checklist 準拠のテスト計画を本文にまとめたうえで着手し、計画作成だけで完了扱いにしない。",
		"- テストは完了条件観点を中心に追加・修正し、production code の変更は明確な defect を証明できる場合の最小修正に限る。",
		"- lint / format:check / typecheck / test / coverage / build / verify は NightWorkers の run_check / run_verification で実行し、raw output artifact と managed evidence を残す。完了条件を満たす証跡として実行する run_check には、対応する AC-xxx を conditionIds に明示する。複数条件を同じ command で確認できる場合だけ複数 ID を指定する。",
		"- conditionIds のない broad verify / coverage / build 成功は補助的な全体ゲート証跡であり、個別の完了条件を満たした扱いにはならない。各条件は対応する test case または conditionIds 付き managed check で確認する。",
		"- nightworkers.completion_check は、managed evidence が Verification Checklist の項目と一致しているかを確認する証跡テストチェックとして実行する。failed / unknown required conditions が残る場合は、対象テストまたは明確な defect を修正して再度 run_check / completion_check を実行する。",
		"- Test Mode では TodoList を使わない。Verification Checklist の状態は backend の deterministic evidence 更新に任せ、画面進捗はこの run の managed tool 実行イベントから表現される。",
		...(missionPilotRun
			? [
					"- 最終回答は verdict(pass|rework|attention), defectOwner(test|implementation|environment|unknown), failedConditionIds, evidenceRunIds, affectedPaths, summary, implementationRework を持つJSON objectだけを返す。",
					"- production defectはdefectOwner=implementationとし、implementationReworkへobjective、acceptanceCriteria、evidenceRefsを設定する。Test role自身でproduction修正を抱え込まない。",
				]
			: []),
	].join("\n");
}

function readTestModeAction(context: AgentRunContext) {
	const testMode =
		context.runtimeOptions?.testMode &&
		typeof context.runtimeOptions.testMode === "object" &&
		!Array.isArray(context.runtimeOptions.testMode)
			? (context.runtimeOptions.testMode as Record<string, unknown>)
			: {};
	const action = testMode.action;
	return typeof action === "string" ? action : null;
}

function buildReviewContract(
	context: AgentRunContext,
	nightWorkersToolList: string,
) {
	const options = readReviewRunOptions(context);
	return [
		"[NightWorkers Runtime Contract]",
		`taskId: ${context.taskId}`,
		`runId: ${context.runId}`,
		...formatRuntimeWorkspaceContextForPrompt(context),
		"executionMode: review",
		"Review lane: completed-task review only. 実装中の会話継続ではなく、完了後の system context と repository evidence を根拠にレビューする。",
		"",
		"NightWorkers MCP:",
		"- MCP server name: nightworkers",
		`- Available review tools in this lane: ${nightWorkersToolList}.`,
		"- context-still.initial_instructions は、この task で未実行の場合だけレビュー作業前に一度実行して従う。チャット入力ごとに再実行しない。",
		"",
		"Review behavior:",
		"- StateCard continuation、implementation handoff、実装中の会話履歴を前提にしない。",
		"- 変更済み repository state、git diff/status、仕様、テスト/verify evidence、run events から判断する。",
		options.applyFixes
			? "- applyFixes=true の Review Run では、根拠ある accepted findings だけを最小差分で修正してよい。"
			: "- applyFixes=false の Review Run では、実装編集を開始しない。",
		options.commitChanges
			? "- commitChanges=true の Review Run では、verify 成功後に対象差分だけ commit してよい。"
			: "- commitChanges=false の Review Run では、commit しない。",
		"- Implementation Queue 投入、import_project、Plan Mode artifact 更新を開始しない。",
		"- findings 保存用の別ファイルを作成しない。final report には repoRoot 外のローカルファイルパスや /tmp /private/tmp への Markdown link を書かず、指摘は final report と Review Status artifact に残す。",
		"- 指摘は重大度順に、具体的な file/line と再現・検証根拠を添える。問題がなければその旨と残リスクだけを短く返す。",
	].join("\n");
}

function readReviewRunOptions(context: AgentRunContext) {
	const reviewRun =
		context.runtimeOptions?.reviewRun &&
		typeof context.runtimeOptions.reviewRun === "object" &&
		!Array.isArray(context.runtimeOptions.reviewRun)
			? (context.runtimeOptions.reviewRun as Record<string, unknown>)
			: {};
	const options =
		reviewRun.options &&
		typeof reviewRun.options === "object" &&
		!Array.isArray(reviewRun.options)
			? (reviewRun.options as Record<string, unknown>)
			: {};
	return {
		applyFixes: options.applyFixes === true,
		commitChanges: options.commitChanges === true,
	};
}

function buildOntologyProtocolContract(context: AgentRunContext) {
	if (!readOntologyMcpEnabled(context)) return null;
	return [
		"Module ontology protocol:",
		formatOntologyRuntimeContextForPrompt(
			context.contextSnapshot.ontologyContext,
		),
		"- When ontology tools are available and the task is not a trivial single-file edit, classify the goal with nightworkers.classify_goal before broad exploration.",
		"- Compile module context with nightworkers.compile_module_context, then search owned paths before repository-wide search.",
		"- Run nightworkers.check_boundary before planned edits outside owned paths; do not silently edit unknown or forbidden paths.",
		"- Use nightworkers.get_verification_plan to prefer focused verification from the primary module and add secondary verification only for declared crossings.",
		"- Final reports for ontology-guided work must include primary module, secondary modules, boundary crossings, invariants checked, verification run, and skipped verification reasons.",
		formatOntologyCloseoutRequirementsForPrompt(),
	].join("\n");
}

function buildPlanningContract(
	context: AgentRunContext,
	nightWorkersToolList: string,
) {
	return [
		"[NightWorkers Runtime Contract]",
		`taskId: ${context.taskId}`,
		`runId: ${context.runId}`,
		...formatRuntimeWorkspaceContextForPrompt(context),
		"executionMode: planning",
		"Plan mode: enabled. ユーザーは計画、仕様化、設計作業を明示的に依頼している。ユーザーが実装へ移るよう依頼するまで、実装編集は行わない。",
		"",
		"NightWorkers MCP:",
		"- MCP server name: nightworkers",
		`- Available read-only NightWorkers MCP tools in this lane: ${nightWorkersToolList || "none"}.`,
		"- context-still.initial_instructions は、この task で未実行の場合だけ作業前に一度実行して従う。チャット入力ごとに再実行しない。",
		"",
		"Planning behavior:",
		"- リポジトリの読み取り、既存仕様の確認、実装計画の作成に限定する。",
		"- Project import、TodoList mutation、ファイル編集、実装、検証、closeout gate を開始しない。",
		"- 実装に移るにはユーザーの明示依頼が必要です。",
		"- 完了時は、実装順、検証ゲート、停止条件を含む計画を短く具体的に返す。",
	].join("\n");
}

function readCodexRuntimeExecutionMode(context: AgentRunContext) {
	const value = context.runtimeOptions?.executionMode;
	if (
		value === "planning" ||
		value === "implementation" ||
		value === "test" ||
		value === "review" ||
		value === "general_answer"
	) {
		return value;
	}
	const snapshotValue = context.contextSnapshot.executionMode;
	if (
		snapshotValue === "planning" ||
		snapshotValue === "implementation" ||
		snapshotValue === "test" ||
		snapshotValue === "review" ||
		snapshotValue === "general_answer"
	) {
		return snapshotValue;
	}
	return "implementation";
}

function readOntologyMcpEnabled(context: AgentRunContext) {
	const snapshot = context.contextSnapshot as Record<string, unknown>;
	const ontologyMcp = snapshot.ontologyMcp;
	if (
		!ontologyMcp ||
		typeof ontologyMcp !== "object" ||
		Array.isArray(ontologyMcp)
	) {
		return false;
	}
	const enabled = (ontologyMcp as Record<string, unknown>).enabled;
	return enabled === true;
}
