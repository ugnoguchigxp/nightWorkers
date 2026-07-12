import type * as repo from "../../../modules/nightworkers/nightworkers.repository";
import type { McpToolSummary } from "../../mcp/mcp-client-manager";
import type { TodoActionPayload } from "../../worker-tools/todo-list";
import type { AgentRunContext } from "../types";
import { readNativeApiExecutionMode } from "./native-api-mode";
import type { NativeApiToolResult } from "./native-api-tool-history";
import { capNativeApiToolResultContent } from "./native-api-tool-result-projector";

export function buildContextCompileArguments(
	context: AgentRunContext,
	specification: unknown,
	workTodo: StartupWorkTodo | null,
) {
	const spec = toRecord(specification);
	const specificationMissing = spec.found === false;
	const title =
		typeof spec.title === "string" && spec.title.trim()
			? spec.title.trim()
			: null;
	const digest =
		typeof spec.digest === "string" && spec.digest.trim()
			? spec.digest.trim()
			: null;
	const specContent =
		typeof spec.content === "string" && spec.content.trim()
			? summarizeText(spec.content, 240)
			: null;
	const assembledDesignContext = toRecord(spec.assembledDesignContext);
	const assembledSummary =
		typeof assembledDesignContext.summary === "string" &&
		assembledDesignContext.summary.trim()
			? summarizeText(assembledDesignContext.summary, 240)
			: null;
	const assembledSources = Array.isArray(
		assembledDesignContext.sourceMessageIds,
	)
		? assembledDesignContext.sourceMessageIds.length
		: null;
	const request = summarizeText(
		context.latestUserMessage || context.compiledPrompt,
		280,
	);
	const executionMode = readNativeApiExecutionMode(context);
	const goalParts = [
		`ユーザー依頼「${request}」に対応する。`,
		workTodo
			? `実作業 Todo #${workTodo.seq}「${workTodo.title}」(${workTodo.taskType}) を現在の作業単位にする。`
			: "startup gate ではなく、ユーザー依頼と仕様書を現在の作業単位にする。",
		title || digest
			? `仕様書 ${title ? `「${title}」` : ""}${digest ? ` (${digest})` : ""} を前提にする。`
			: specificationMissing
				? "現行仕様書は見つからなかったため、復元済み native/API resume history とユーザー依頼を現在の作業単位にする。"
				: "読了済み仕様書を前提にする。",
		specContent ? `仕様書要点: ${specContent}` : "",
		assembledSummary
			? `Assembled design context 要点: ${assembledSummary}`
			: "",
		assembledSources !== null
			? `Assembled design context sources=${assembledSources}.`
			: "",
		`executionMode=${executionMode} として、必要な実装・検証・closeout まで進める。`,
	];
	return {
		goal: goalParts.filter(Boolean).join(" "),
		domains: ["nightWorkers"],
		technologies: ["typescript", "bun"],
		changeTypes: changeTypesForExecutionMode(executionMode),
	};
}

export type StartupWorkTodo = {
	seq: number;
	title: string;
	taskType: string;
	status: string;
	procedureId?: string | null;
};

export function resolveStartupWorkTodo(
	todos: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>,
): StartupWorkTodo | null {
	return (
		todos
			.filter(
				(todo) =>
					["pending", "running"].includes(todo.status) &&
					!isStartupGateTodo(todo) &&
					!isFinalCloseoutTodo(todo),
			)
			.sort(
				(a, b) =>
					startupWorkTodoStatusRank(a.status) -
						startupWorkTodoStatusRank(b.status) || a.seq - b.seq,
			)
			.map((todo) => ({
				seq: todo.seq,
				title: todo.title,
				taskType: todo.taskType,
				status: todo.status,
				procedureId: todo.procedureId,
			}))[0] ?? null
	);
}

export function startupWorkTodoStatusRank(status: string) {
	if (status === "running") return 0;
	if (status === "pending") return 1;
	return 2;
}

export function isStartupGateTodo(todo: {
	taskType?: string | null;
	procedureId?: string | null;
}) {
	return (
		isCodingPreparationTodo(todo) ||
		todo.procedureId === "contextstill.initial_instructions" ||
		todo.procedureId === "contextstill.context_compile" ||
		todo.taskType === "initial_instructions" ||
		todo.taskType === "context_compile"
	);
}

export function isCodingPreparationTodo(todo: {
	taskType?: string | null;
	procedureId?: string | null;
}) {
	return (
		todo.taskType === "coding_preparation" ||
		todo.procedureId === "coding_preparation"
	);
}

export function changeTypesForExecutionMode(
	mode: ReturnType<typeof readNativeApiExecutionMode>,
) {
	if (mode === "review") return ["review", "verification"];
	if (mode === "planning") return ["planning"];
	if (mode === "general_answer") return ["investigation"];
	return ["implementation", "verification"];
}

export function summarizeText(value: string, maxLength: number) {
	const normalized = value.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, maxLength - 3)}...`;
}

export function failedToolResult(
	code: string,
	message: string,
	payload?: unknown,
): NativeApiToolResult {
	return capNativeApiToolResultContent({
		ok: false,
		content: JSON.stringify({ ok: false, error: { code, message }, payload }),
		payload,
		error: { code, message },
	});
}

export function isMissingSpecificationFailure(result: NativeApiToolResult) {
	return result.error?.code === "SPECIFICATION_NOT_FOUND";
}

export function successfulTodoAlignment(
	todos: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>,
	transitionPayload: TodoActionPayload | null,
): NativeApiToolResult {
	return capNativeApiToolResultContent({
		ok: true,
		content: JSON.stringify({
			ok: true,
			toolName: "todo_list",
			payload: { todos, transition: transitionPayload?.transition ?? null },
		}),
		payload: { todos, transition: transitionPayload?.transition ?? null },
	});
}

export function renderSpecificationHistory(payload: Record<string, unknown>) {
	const title =
		typeof payload.title === "string" ? payload.title : "Specification";
	const digest = typeof payload.digest === "string" ? payload.digest : "none";
	const content = typeof payload.content === "string" ? payload.content : "";
	const assembledContext = renderAssembledDesignContextHistory(
		payload.assembledDesignContext,
	);
	return [
		"[Startup Specification]",
		`title=${title}`,
		`digest=${digest}`,
		"",
		content.slice(0, 4000),
		assembledContext ? ["", assembledContext].join("\n") : "",
	].join("\n");
}

export function renderAssembledDesignContextHistory(value: unknown) {
	const context = toRecord(value);
	if (Object.keys(context).length === 0) return "";
	const summary = typeof context.summary === "string" ? context.summary : "";
	const questionnaireSessionId =
		typeof context.questionnaireSessionId === "string"
			? context.questionnaireSessionId
			: "";
	const sections = Array.isArray(context.sections) ? context.sections : [];
	const lines = ["[Assembled Design Context]"];
	if (questionnaireSessionId)
		lines.push(`questionnaireSessionId=${questionnaireSessionId}`);
	if (summary) lines.push("summary:", summary.slice(0, 1600));
	for (const section of sections.slice(0, 10)) {
		const record = toRecord(section);
		const content = typeof record.content === "string" ? record.content : "";
		lines.push(
			"",
			`## ${String(record.kind || "section")}: ${String(record.title || "Untitled")}`,
			record.sourceMessageId
				? `sourceMessageId=${String(record.sourceMessageId)}`
				: "",
			record.digest ? `digest=${String(record.digest)}` : "",
			content.slice(0, 1800),
		);
	}
	return lines.filter((line) => line !== "").join("\n");
}

export function renderInitialInstructionsHistory(result: NativeApiToolResult) {
	return [
		"[Startup Initial Instructions]",
		result.ok
			? "contextStill initial_instructions completed."
			: "contextStill initial_instructions failed.",
		summarizePayload(result.payload),
	]
		.filter(Boolean)
		.join("\n");
}

export function renderContextCompileHistory(
	args: Record<string, unknown>,
	result: NativeApiToolResult,
) {
	return [
		"[Startup Context Pack]",
		`goal=${typeof args.goal === "string" ? args.goal : ""}`,
		result.ok
			? "contextStill context_compile completed."
			: "contextStill context_compile failed.",
		summarizePayload(result.payload),
	]
		.filter(Boolean)
		.join("\n");
}

export function renderTodoAlignmentHistory(result: NativeApiToolResult) {
	return [
		"[Startup Todo Alignment]",
		result.ok ? "Todo alignment completed." : "Todo alignment failed.",
		summarizePayload(result.payload),
	]
		.filter(Boolean)
		.join("\n");
}

export function summarizePayload(payload: unknown) {
	if (payload === undefined || payload === null) return "";
	const text = typeof payload === "string" ? payload : JSON.stringify(payload);
	return text.length > 2000 ? `${text.slice(0, 2000)}...` : text;
}

export function isContextStillTool(tool: McpToolSummary) {
	const serverName = tool.serverName.toLowerCase();
	const prefix = tool.toolPrefix.toLowerCase();
	return (
		serverName === "context-still" ||
		serverName === "contextstill" ||
		prefix === "context_still" ||
		prefix === "contextstill"
	);
}

export function isFinalCloseoutTodo(todo: {
	taskType?: string | null;
	procedureId?: string | null;
}) {
	return (
		(todo.taskType === "knowledge_capture" &&
			todo.procedureId === "contextstill.register_candidates") ||
		(todo.taskType === "completion_report" &&
			todo.procedureId === "final_completion_report") ||
		todo.procedureId === "contextstill_closeout"
	);
}

export function toRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
