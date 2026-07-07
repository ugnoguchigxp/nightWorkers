import type {
	ProviderToolCall,
	ProviderToolMessage,
} from "../../structured-llm/tool-calls";
import type { ModelVisiblePayloadSummary } from "../model-visible-payload";
import {
	formatOntologyCloseoutRequirementsForPrompt,
	formatOntologyRuntimeContextForPrompt,
} from "../ontology-runtime-context";
import type { AgentRunContext } from "../types";
import { readNativeApiExecutionMode } from "./native-api-mode";
import { readNativeApiRoleWorkingContextText } from "./native-api-role-context-events";

export type NativeApiUserSource = "user" | "runtime" | "todo" | "state_card";

export type NativeApiToolResult = {
	ok: boolean;
	content: string;
	payload?: unknown;
	modelVisibleSummary?: ModelVisiblePayloadSummary;
	error?: {
		code?: string;
		message: string;
		details?: unknown;
	};
};

export type NativeApiHistoryItem =
	| { type: "system"; content: string }
	| { type: "user"; content: string; source: NativeApiUserSource }
	| { type: "assistant"; content: string; toolCalls?: ProviderToolCall[] }
	| {
			type: "tool_result";
			toolCallId: string;
			toolName: string;
			result: NativeApiToolResult;
	  };

export function buildInitialNativeApiHistory(
	context: AgentRunContext,
	options: { resumeHistory?: readonly NativeApiHistoryItem[] | null } = {},
): NativeApiHistoryItem[] {
	const userMessage = context.latestUserMessage || context.compiledPrompt;
	const items: NativeApiHistoryItem[] = [
		{ type: "system", content: buildNativeApiSystemPrompt(context) },
		...(options.resumeHistory ?? []),
		{ type: "user", source: "user", content: userMessage },
	];
	const currentTodo = context.currentTodo;
	if (currentTodo) {
		items.push({
			type: "user",
			source: "todo",
			content: renderCurrentTodoContext(currentTodo),
		});
	}
	const roleWorkingContext = readNativeApiRoleWorkingContextText(context);
	if (roleWorkingContext) {
		items.push({
			type: "user",
			source: "runtime",
			content: roleWorkingContext,
		});
	}
	return items;
}

export function getLatestNativeApiUserContentByHeader(
	history: readonly NativeApiHistoryItem[],
	header: string,
) {
	return (
		[...history]
			.reverse()
			.find(
				(item): item is Extract<NativeApiHistoryItem, { type: "user" }> =>
					item.type === "user" && item.content.startsWith(header),
			)?.content ?? null
	);
}

export function sanitizeNativeApiResumeHistory(
	history: unknown,
	options: { maxItems?: number } = {},
): NativeApiHistoryItem[] | null {
	if (!Array.isArray(history)) return null;
	const sanitized: NativeApiHistoryItem[] = [];
	const pendingToolCallIds = new Set<string>();
	const completedToolCallIds = new Set<string>();

	for (const item of history) {
		if (!item || typeof item !== "object" || Array.isArray(item)) return null;
		const record = item as Record<string, unknown>;
		if (record.type === "system") continue;
		if (record.type === "user") {
			if (record.source !== "user") continue;
			const content = readNonEmptyString(record.content);
			if (!content) continue;
			sanitized.push({ type: "user", source: "user", content });
			continue;
		}
		if (record.type === "assistant") {
			const content = typeof record.content === "string" ? record.content : "";
			const toolCalls = readProviderToolCalls(record.toolCalls);
			if (!toolCalls) return null;
			for (const toolCall of toolCalls) pendingToolCallIds.add(toolCall.id);
			sanitized.push({
				type: "assistant",
				content,
				...(toolCalls.length ? { toolCalls } : {}),
			});
			continue;
		}
		if (record.type === "tool_result") {
			const toolCallId = readNonEmptyString(record.toolCallId);
			const toolName = readNonEmptyString(record.toolName);
			const result = readNativeApiToolResult(record.result);
			if (!toolCallId || !toolName || !result) return null;
			if (
				!pendingToolCallIds.has(toolCallId) ||
				completedToolCallIds.has(toolCallId)
			) {
				return null;
			}
			pendingToolCallIds.delete(toolCallId);
			completedToolCallIds.add(toolCallId);
			sanitized.push({ type: "tool_result", toolCallId, toolName, result });
			continue;
		}
		return null;
	}

	if (pendingToolCallIds.size > 0) return null;
	const maxItems = options.maxItems ?? 16;
	return trimSanitizedResumeHistory(sanitized, maxItems);
}

export function projectNativeApiHistoryToProviderMessages(
	history: readonly NativeApiHistoryItem[],
): ProviderToolMessage[] {
	const systemPrompt = history
		.filter(
			(item): item is Extract<NativeApiHistoryItem, { type: "system" }> => {
				return item.type === "system" && item.content.trim().length > 0;
			},
		)
		.map((item) => item.content.trim())
		.join("\n\n");
	const messages: ProviderToolMessage[] = systemPrompt
		? [{ role: "system", content: systemPrompt }]
		: [];

	for (const item of history) {
		if (item.type === "system") continue;
		if (item.type === "user") {
			messages.push({ role: "user", content: item.content });
			continue;
		}
		if (item.type === "assistant") {
			messages.push({
				role: "assistant",
				content: item.content,
				...(item.toolCalls?.length ? { toolCalls: item.toolCalls } : {}),
			});
			continue;
		}
		messages.push({
			role: "tool",
			toolCallId: item.toolCallId,
			content: item.result.content,
		});
	}

	return messages;
}

function trimSanitizedResumeHistory(
	history: NativeApiHistoryItem[],
	maxItems: number,
) {
	const limit = Math.max(0, Math.floor(maxItems));
	if (limit === 0) return [];
	if (history.length <= limit) return history;
	const window = history.slice(Math.max(0, history.length - limit));
	for (let offset = 0; offset < window.length; offset += 1) {
		const candidate = window.slice(offset);
		if (isValidTrimmedResumeHistory(candidate)) return candidate;
	}
	return [];
}

function isValidTrimmedResumeHistory(history: NativeApiHistoryItem[]) {
	const pendingToolCallIds = new Set<string>();
	for (const item of history) {
		if (item.type === "assistant") {
			for (const toolCall of item.toolCalls ?? []) {
				pendingToolCallIds.add(toolCall.id);
			}
			continue;
		}
		if (item.type !== "tool_result") continue;
		if (!pendingToolCallIds.has(item.toolCallId)) return false;
		pendingToolCallIds.delete(item.toolCallId);
	}
	return pendingToolCallIds.size === 0;
}

export function extractNativeApiSystemPrompt(
	history: readonly NativeApiHistoryItem[],
) {
	return history
		.filter(
			(item): item is Extract<NativeApiHistoryItem, { type: "system" }> => {
				return item.type === "system" && item.content.trim().length > 0;
			},
		)
		.map((item) => item.content.trim())
		.join("\n\n");
}

export function extractLatestNativeApiUserPrompt(
	history: readonly NativeApiHistoryItem[],
) {
	const userItems = history.filter(
		(item): item is Extract<NativeApiHistoryItem, { type: "user" }> =>
			item.type === "user",
	);
	return userItems.at(-1)?.content ?? "";
}

function buildNativeApiSystemPrompt(context: AgentRunContext) {
	const executionMode = readNativeApiExecutionMode(context);
	const planModeSettings = formatPlanModeSettingsSnapshot(
		context.runtimeOptions?.planModeSettingsSnapshot,
	);
	const ontologyGuidance = buildOntologyGuidance(context);
	return [
		`executionMode: ${executionMode}`,
		...(planModeSettings ? [`planModeSettings: ${planModeSettings}`] : []),
		"Codex 型の turn lifecycle / tool dispatch / cancellation discipline に従って実行します。",
		"Codex SDK lane へ fallback せず、SchemaFirst supervisor loop へ fallback しません。",
		"new_context tool は、会話履歴を要約せず次の provider turn から新しい context window を開始します。",
		"リポジトリの読み書きは登録済み Project の repo root を基準にし、worker tool handler 経由で行います。",
		"",
		"Tool choice guidance:",
		"- context_initial_instructions は通常 read_current_specification の後に実行して従ってください。",
		"- native/API resume で runtime が仕様未発見を非致命化した場合は、復元済み履歴と最新ユーザー依頼を現在の作業文脈として続行してください。",
		"- 仕様書、実装計画、artifact が source of truth です。Plan Mode artifact の契約詳細が実装に影響する場合は read_current_specification includeDesignContext=true の assembled design context も読んでください。",
		"- provider-visible tools は current Todo / procedure に合わせて絞られます。表示されている tool から現在の作業に必要なものだけを使ってください。",
		...(ontologyGuidance ? ontologyGuidance : []),
		"- TodoList pane がユーザーに見える進捗の source of truth です。Timeline 追加警告ではなく、TodoList の状態遷移で現在位置を示してください。",
		"- SystemContext / Todo snapshot に出る initial_instructions / context_compile / completion_report は読み取り用の NightWorkers-managed gates です。replace では実作業 Todo だけを書き、固定ゲートは NightWorkers に維持させてください。",
		"- Todo snapshot を echo して固定ゲートを replace に含めても tool は固定ゲートへ merge しますが、これは進捗更新ではありません。作業段階を進める場合は start/done/block/fail を使ってください。",
		"- 2 手以上の調査、レビュー、実装、検証では、最初の実質作業前に既存 Todo を start するか、作業内容に合わない場合だけ todo_list operation=replace で UI 追跡可能な TodoList にしてください。",
		"- todo_list operation=replace は TodoList の構造を再定義する再計画操作です。見積もり変更、スコープ変更、作業分解の粒度変更、実装中に新しい必須作業が判明した場合だけ使います。",
		"- running Todo がある状態で todo_list operation=replace を使う場合は todoListReplaceReason を必ず指定してください。現在の Todo が完了したことを表すために todo_list operation=replace を使ってはいけません。",
		"- todo_list operation=start/done/block/fail は既存 Todo の状態遷移です。Todo が終わったら todo_list operation=done を使ってください。todo_list operation=done は次の pending Todo を自動で running にします。",
		"- todo_list operation=list は診断専用であり、進捗更新ではありません。",
		"- ファイルを編集する前に、対象ファイルまたは直接関係する既存ファイルを読む。新規ファイル作成では、配置先の route / registry / sibling / style / test pattern を先に確認してください。",
		"- rg --files や ls は探索であり、編集対象の読了 evidence ではありません。読んだ内容に基づかない blind edit を避けてください。",
		"- finalReport / finalize_answer の前に open Todo を確認し、未完了 Todo は done/block/fail のいずれかに整理してください。未確認 mutation や未実施 verification を done にしないでください。",
		"- blocker、未完了 Todo、failed tests/review、ユーザー確認へ進む判断がある場合は context_decision を強く推奨します。",
		"- 推奨 tool を使わない場合は、finalReport でその理由を短く説明してください。",
		"",
		...modeGuidance(executionMode),
		`repoRoot: ${context.repoRoot}`,
	].join("\n");
}

function buildOntologyGuidance(context: AgentRunContext) {
	if (!readOntologyMcpEnabled(context)) return null;
	return [
		formatOntologyRuntimeContextForPrompt(
			context.contextSnapshot.ontologyContext,
		),
		"- module ontology tool が使える場合、広域探索や cross-module edit の前に classify_goal と compile_module_context で primaryModule / secondaryModules / invariants / focused verification を確認してください。",
		"- owned paths 外の planned edit では check_boundary を使い、unknown path や forbidden mutation を finalReport まで黙って持ち込まないでください。",
		"- ontology-guided work の finalReport には primary module、secondary modules、boundary crossings、invariants checked、verification run、skipped verification reason を含めてください。",
		formatOntologyCloseoutRequirementsForPrompt(),
	];
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

function formatPlanModeSettingsSnapshot(snapshot: unknown) {
	if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
		return null;
	const disabledCapabilities = (snapshot as { disabledCapabilities?: unknown })
		.disabledCapabilities;
	if (!Array.isArray(disabledCapabilities)) return null;
	return disabledCapabilities.length > 0
		? `disabled=${disabledCapabilities.join(", ")}`
		: "all enabled";
}

function modeGuidance(
	executionMode: ReturnType<typeof readNativeApiExecutionMode>,
) {
	if (executionMode === "planning") {
		return [
			"Planning guidance:",
			"- 原則として実装・ファイル変更・project import は避け、調査結果に基づく実装計画を返してください。",
			"- ただし、ユーザーが実装開始を明示した場合、または計画中に実装へ進む合意が明確になった場合は、Todo を更新して implementation work に入って構いません。",
			"- mutation tool を使う場合は、その理由と根拠を finalReport に含めてください。",
			"- Planning is not closeout. 実装と検証が終わっていない場合、compile_eval は通常不要です。",
			"",
		];
	}
	if (executionMode === "review") {
		return [
			"Review guidance:",
			"- 変更差分、受け入れ条件、検証結果を確認し、バグ・回帰・責務境界違反・テスト不足を優先してください。",
			"- 必要に応じて git_diff、read_file、run_verification、context_compile を使って根拠を確認してください。",
			"- 修正が必要で明確な場合は、Todo を更新して実装修正 tool を使って構いません。",
			"",
		];
	}
	if (executionMode === "general_answer") {
		return [
			"General answer guidance:",
			"- 原則として最小限の回答でよいですが、リポジトリ事実が必要な場合は read/search tools を使って確認してください。",
			"- コード変更が必要だと判断した場合は、その理由を明示して Todo を更新してから進めてください。",
			"",
		];
	}
	return [
		"Implementation guidance:",
		"- 実装 Todo が running になった後は、plan-only answer や次ステップ列挙だけで停止しないでください。",
		"- 実装、必要な検証、必要な修正、closeout まで進めてください。明確な blocker がある場合は todo_list operation=block/fail を使って説明してください。",
		"- ファイル編集、DB mutation、長い検証、review 判定の後は、該当 Todo を done/block/fail のいずれかに更新してから次の段階に進んでください。",
		"- import_project を使った場合は、postImport payload と recommended verification command を優先してください。",
		"- コード変更後、package.json に verify script が存在する場合は、完了報告前の代表検証として verify command を最優先で実行してください。typecheck / lint / test / build の個別実行は、修正途中の focused check、または verify script が存在しない・実行不能な場合の fallback としてください。",
		"",
	];
}

function renderCurrentTodoContext(
	currentTodo: NonNullable<AgentRunContext["currentTodo"]>,
) {
	return [
		"[Current Native API Runner Todo]",
		`seq=${currentTodo.seq}`,
		`title=${currentTodo.title}`,
		`taskType=${currentTodo.taskType}`,
		`procedureId=${currentTodo.procedureId ?? "none"}`,
		`status=${currentTodo.status}`,
	].join("\n");
}

function readNonEmptyString(value: unknown) {
	return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readProviderToolCalls(value: unknown): ProviderToolCall[] | null {
	if (value === undefined) return [];
	if (!Array.isArray(value)) return null;
	const calls: ProviderToolCall[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object" || Array.isArray(item)) return null;
		const record = item as Record<string, unknown>;
		const id = readNonEmptyString(record.id);
		const name = readNonEmptyString(record.name);
		if (!id || !name) return null;
		calls.push({
			id,
			name,
			arguments:
				record.arguments &&
				typeof record.arguments === "object" &&
				!Array.isArray(record.arguments)
					? (record.arguments as Record<string, unknown>)
					: {},
		});
	}
	return calls;
}

function readNativeApiToolResult(value: unknown): NativeApiToolResult | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (typeof record.ok !== "boolean") return null;
	const content = typeof record.content === "string" ? record.content : null;
	if (content === null) return null;
	const error = record.error;
	return {
		ok: record.ok,
		content,
		...(record.payload !== undefined ? { payload: record.payload } : {}),
		...(record.modelVisibleSummary &&
		typeof record.modelVisibleSummary === "object" &&
		!Array.isArray(record.modelVisibleSummary)
			? {
					modelVisibleSummary:
						record.modelVisibleSummary as ModelVisiblePayloadSummary,
				}
			: {}),
		...(error && typeof error === "object" && !Array.isArray(error)
			? { error: error as NativeApiToolResult["error"] }
			: {}),
	};
}
