import type { PromptImageAttachment } from "../../../../../shared/prompt-image";
import { isPromptImageMediaType } from "../../../../../shared/prompt-image";
import { projectExplorationCatalogRunPinSchema } from "../../../../../shared/schemas/project-exploration-catalog.schema";
import type { ModelVisiblePayloadSummary } from "../../../../services/model-visible-payload";
import type {
	ProviderToolCall,
	ProviderToolMessage,
} from "../../../../services/structured-llm/tool-calls";
import { buildProjectExplorationAgentWorkflow } from "../../../ontology/exploration/project-exploration-agent-workflow";
import {
	CODING_AGENT_DDD_FALLBACK_INSTRUCTIONS_JA,
	CODING_AGENT_RUNTIME_REMINDERS_JA,
	CODING_AGENT_SYSTEM_CONTEXT_VERSION,
} from "../../context";
import { formatRuntimeWorkspaceContextForPrompt } from "../runtime-workspace-context";
import type { AgentRunContext } from "../types";

export type NativeApiUserSource = "user" | "runtime" | "todo" | "state_card";

export type NativeApiToolResult = {
	ok: boolean;
	content: string;
	payload?: unknown;
	modelVisibleSummary?: ModelVisiblePayloadSummary;
	error?: { code?: string; message: string; details?: unknown };
};

export type NativeApiHistoryItem =
	| { type: "system"; content: string }
	| {
			type: "user";
			content: string;
			source: NativeApiUserSource;
			imageAttachments?: PromptImageAttachment[];
	  }
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
	const items: NativeApiHistoryItem[] = [
		{ type: "system", content: buildNativeApiSystemPrompt(context) },
		...(options.resumeHistory ?? []),
		{
			type: "user",
			source: "user",
			content: context.latestUserMessage || context.compiledPrompt,
			...(context.imageAttachments?.length
				? { imageAttachments: context.imageAttachments }
				: {}),
		},
	];
	if (context.currentTodo) {
		items.push({
			type: "user",
			source: "todo",
			content: renderCurrentTodoContext(context.currentTodo),
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
			const imageAttachments = readNativeApiImageAttachments(
				record.imageAttachments,
			);
			sanitized.push({
				type: "user",
				source: "user",
				content,
				...(imageAttachments.length ? { imageAttachments } : {}),
			});
			continue;
		}
		if (record.type === "assistant") {
			const toolCalls = readProviderToolCalls(record.toolCalls);
			if (!toolCalls) return null;
			for (const toolCall of toolCalls) pendingToolCallIds.add(toolCall.id);
			sanitized.push({
				type: "assistant",
				content: typeof record.content === "string" ? record.content : "",
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
	if (pendingToolCallIds.size) return null;
	return trimSanitizedResumeHistory(sanitized, options.maxItems ?? 16);
}

export function projectNativeApiHistoryToProviderMessages(
	history: readonly NativeApiHistoryItem[],
): ProviderToolMessage[] {
	const systemPrompt = extractNativeApiSystemPrompt(history);
	const messages: ProviderToolMessage[] = systemPrompt
		? [{ role: "system", content: systemPrompt }]
		: [];
	for (const item of history) {
		if (item.type === "system") continue;
		if (item.type === "user") {
			messages.push({
				role: "user",
				content: item.imageAttachments?.length
					? [
							{ type: "text", text: item.content },
							...item.imageAttachments.map((image) => ({
								type: "image" as const,
								image,
							})),
						]
					: item.content,
			});
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

export function extractNativeApiSystemPrompt(
	history: readonly NativeApiHistoryItem[],
) {
	return history
		.filter(
			(item): item is Extract<NativeApiHistoryItem, { type: "system" }> =>
				item.type === "system" && Boolean(item.content.trim()),
		)
		.map((item) => item.content.trim())
		.join("\n\n");
}

export function extractLatestNativeApiUserPrompt(
	history: readonly NativeApiHistoryItem[],
) {
	return (
		history
			.filter(
				(item): item is Extract<NativeApiHistoryItem, { type: "user" }> =>
					item.type === "user",
			)
			.at(-1)?.content ?? ""
	);
}

export function readOntologyMcpEnabled(context: AgentRunContext) {
	const ontologyMcp = (context.contextSnapshot as Record<string, unknown>)
		.ontologyMcp;
	return Boolean(
		ontologyMcp &&
			typeof ontologyMcp === "object" &&
			!Array.isArray(ontologyMcp) &&
			(ontologyMcp as Record<string, unknown>).enabled === true,
	);
}

export function readProjectExplorationCatalogPin(context: AgentRunContext) {
	const parsed = projectExplorationCatalogRunPinSchema.safeParse(
		(context.contextSnapshot as Record<string, unknown>)
			.projectExplorationCatalog,
	);
	return parsed.success ? parsed.data : null;
}

function buildNativeApiSystemPrompt(context: AgentRunContext) {
	const projectExplorationWorkflow = buildProjectExplorationAgentWorkflow(
		readProjectExplorationCatalogPin(context),
	);
	return [
		"[NightWorkers Coding Agent Runtime]",
		JSON.stringify(
			context.codingAgentSystemContext ?? {
				version: CODING_AGENT_SYSTEM_CONTEXT_VERSION,
				roleInstructionsJa:
					"Taskの意味、Todo、次の行動、検証、完了可否を判断するCoding Agentとして振る舞ってください。",
				taskGoal: context.latestUserMessage || context.compiledPrompt,
				registeredRepositoryRoot: context.repoRoot,
			},
			null,
			2,
		),
		CODING_AGENT_DDD_FALLBACK_INSTRUCTIONS_JA,
		"[Project Static Intelligence Workflow]",
		JSON.stringify(projectExplorationWorkflow, null, 2),
		...formatRuntimeWorkspaceContextForPrompt(context),
		"Todo planとcurrent Todoは各turnのTodo Contextを正本にしてください。",
		"最初のturnではtodo_listでplanを作成してcurrent Todoを開始し、それ以外のworkspace toolを先に呼ばないでください。",
		...CODING_AGENT_RUNTIME_REMINDERS_JA,
		"tool結果を読んで次の行動を選び、失敗時はrecord_failureで外部作業記憶を更新してください。",
		"Testや自己確認の要否はTaskとTodo Contextから判断し、専用modeを前提にしないでください。",
		"tool callなしの本文は最終回答候補です。open Todoがある場合は明示transitionしてから回答してください。",
	].join("\n");
}

function renderCurrentTodoContext(
	currentTodo: NonNullable<AgentRunContext["currentTodo"]>,
) {
	return [
		"[Current Coding Agent Todo]",
		`id=${currentTodo.id}`,
		`revision=${currentTodo.revision ?? 0}`,
		`seq=${currentTodo.seq}`,
		`title=${currentTodo.title}`,
		`objective=${currentTodo.objective ?? currentTodo.description ?? ""}`,
		`context=${currentTodo.context ?? ""}`,
		`nextAction=${currentTodo.nextAction ?? ""}`,
		`acceptanceCriteria=${JSON.stringify(currentTodo.acceptanceCriteria ?? [])}`,
		`lastFailure=${currentTodo.lastFailure ?? ""}`,
		`attemptCount=${currentTodo.attemptCount ?? 0}`,
		`status=${currentTodo.status}`,
	].join("\n");
}

function trimSanitizedResumeHistory(
	history: NativeApiHistoryItem[],
	maxItems: number,
) {
	const limit = Math.max(0, Math.floor(maxItems));
	if (!limit) return [];
	if (history.length <= limit) return history;
	const window = history.slice(-limit);
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
		} else if (item.type === "tool_result") {
			if (!pendingToolCallIds.delete(item.toolCallId)) return false;
		}
	}
	return pendingToolCallIds.size === 0;
}

function readNativeApiImageAttachments(
	value: unknown,
): PromptImageAttachment[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) return [];
		const record = item as Record<string, unknown>;
		if (
			typeof record.id !== "string" ||
			typeof record.name !== "string" ||
			typeof record.path !== "string" ||
			typeof record.size !== "number" ||
			typeof record.mediaType !== "string" ||
			!isPromptImageMediaType(record.mediaType)
		) {
			return [];
		}
		return [
			{
				id: record.id,
				name: record.name,
				path: record.path,
				size: record.size,
				mediaType: record.mediaType,
			},
		];
	});
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
	if (typeof record.ok !== "boolean" || typeof record.content !== "string") {
		return null;
	}
	return {
		ok: record.ok,
		content: record.content,
		...(record.payload !== undefined ? { payload: record.payload } : {}),
		...(record.modelVisibleSummary &&
		typeof record.modelVisibleSummary === "object" &&
		!Array.isArray(record.modelVisibleSummary)
			? {
					modelVisibleSummary:
						record.modelVisibleSummary as ModelVisiblePayloadSummary,
				}
			: {}),
		...(record.error &&
		typeof record.error === "object" &&
		!Array.isArray(record.error)
			? { error: record.error as NativeApiToolResult["error"] }
			: {}),
	};
}

function readNonEmptyString(value: unknown) {
	return typeof value === "string" && value.trim() ? value : null;
}
