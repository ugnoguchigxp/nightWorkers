import type { ActivityEvent } from "../types";
import {
	asNumber,
	asRecord,
	asString,
	getActivityChangedFiles,
	getToolActivityModel,
	isChangedFilesOnlyDiffActivity,
	type ToolActivityLifecycle,
} from "./ThreadTimeline";
import {
	sanitizeTerminalPreviewValue,
	sanitizeTerminalText,
} from "./terminalText";

type CodexToolLifecycle = "started" | "progress" | "result" | "failed";
type CodexToolStatus = "started" | "running" | "ok" | "failed";
const CODEX_TOOL_RESULT_HEIGHT_REDUCTION = 104;

export type CodexVerificationSummary = {
	checkKind: string;
	label: string;
	headline: string;
	state: "running" | "passed" | "failed" | "unknown";
	command?: string;
	resultText?: string;
	exitCode?: number | null;
	evidence: "saved" | "not_saved" | "unknown";
	conditionIds: string[];
	checklist?: {
		complete: boolean;
		failedRequired: number;
		unknownRequired: number;
	} | null;
};

export type CodexToolCardModel = {
	lifecycle: CodexToolLifecycle;
	status: CodexToolStatus;
	providerItemId?: string;
	toolName: string;
	codexKind: "mcp" | "command" | "edit_command" | "file_change";
	title: string;
	summary: string;
	metadata: Array<{ label: string; value: string }>;
	command?: string;
	commandClass?: string;
	exitCode?: number | null;
	argumentsPreview?: string;
	editDiffPreview?: { diff: string; label: string };
	resultPreview?: string;
	outputPreview?: string;
	detailsFilename?: string;
	errorMessage?: string;
	verification?: CodexVerificationSummary;
};

type CodexToolCardEvent = {
	kind?: string;
	eventType?: string | null;
	payloadJson?: unknown;
	seq?: number;
	runId?: string | null;
	source?: string;
	status?: string | null;
};

export function hasCodexToolCard(event: CodexToolCardEvent): boolean {
	return getCodexToolCardModel(event) !== null;
}

export function isNormalCodexToolCardVisible(
	card: CodexToolCardModel,
): boolean {
	return !card.verification;
}

export function getCodexToolCardModel(
	event: CodexToolCardEvent,
): CodexToolCardModel | null {
	const payload = asRecord(event.payloadJson ?? event);
	const data = getCodexActivityData(payload);
	if (asString(data.provider) !== "codex") return null;
	if (isChangedFilesOnlyDiffActivity(event as ActivityEvent)) return null;

	const activity = getToolActivityModel(event);
	const toolName = activity?.toolName || asString(data.toolName);
	const lifecycle = normalizeLifecycle({
		lifecycle: activity?.lifecycle,
		eventKind: event.kind,
		eventType: event.eventType,
		providerEventType: asString(data.providerEventType),
	});
	if (!toolName || !lifecycle) return null;

	if (isIgnoredByDedicatedCard(toolName)) return null;

	const providerItemId = asString(data.providerItemId);
	const status = normalizeStatus(
		lifecycle,
		asString(data.status) || event.status,
	);
	const errorMessage = getErrorMessage(data, activity?.error);

	if (isCodexMcpTool(data, toolName)) {
		const card = buildMcpCard({
			data,
			activityArguments: activity?.arguments ?? {},
			activityRawResult: activity?.rawResult ?? {},
			lifecycle,
			status,
			providerItemId,
			toolName,
			errorMessage,
		});
		if (card.verification?.state === "failed") card.status = "failed";
		return card;
	}

	if (toolName === "command_execution") {
		return buildCommandCard({
			data,
			lifecycle,
			status,
			providerItemId,
			errorMessage,
		});
	}

	const changedFiles = getActivityChangedFiles(event as ActivityEvent);
	if (changedFiles.length > 0) {
		return buildFileChangeCard({
			data,
			lifecycle,
			status,
			providerItemId,
			changedFiles,
		});
	}

	return null;
}

export function codexToolCodeBlockMaxHeight(
	card: CodexToolCardModel,
	debug: boolean,
	block: "details" | "output",
) {
	const baseHeight =
		block === "output" ? (debug ? 240 : 140) : debug ? 320 : 220;
	if (card.lifecycle === "result") {
		return baseHeight - CODEX_TOOL_RESULT_HEIGHT_REDUCTION;
	}
	return baseHeight;
}

function buildMcpCard(input: {
	data: Record<string, unknown>;
	activityArguments: Record<string, unknown>;
	activityRawResult: Record<string, unknown>;
	lifecycle: CodexToolLifecycle;
	status: CodexToolStatus;
	providerItemId?: string;
	toolName: string;
	errorMessage?: string;
}): CodexToolCardModel {
	const server =
		asString(input.data.mcpServer) || serverFromToolName(input.toolName);
	const tool = asString(input.data.mcpTool) || toolFromToolName(input.toolName);
	const args = pickNonEmptyRecord(
		asRecord(input.data.arguments),
		input.activityArguments,
	);
	const result = pickNonEmptyRecord(
		asRecord(input.data.result),
		input.activityRawResult,
	);
	const verification =
		tool === "run_check"
			? buildVerificationSummary({
					args,
					result,
					lifecycle: input.lifecycle,
				})
			: undefined;
	const operation = asString(args.operation);
	const seq = typeof args.seq === "number" ? String(args.seq) : "";
	const summaryParts = [
		input.toolName,
		operation ? `operation=${operation}` : "",
		seq ? `seq=${seq}` : "",
	].filter(Boolean);

	return {
		lifecycle: input.lifecycle,
		status: input.status,
		providerItemId: input.providerItemId || undefined,
		toolName: input.toolName,
		codexKind: "mcp",
		title: verification ? "検証" : "Codex MCP",
		summary: verification?.headline ?? summaryParts.join(" | "),
		metadata: compactMetadata([
			["server", server],
			["tool", tool],
			["provider status", asString(input.data.status)],
		]),
		argumentsPreview: stringifyPreview(args),
		resultPreview: stringifyPreview(result),
		errorMessage: input.errorMessage,
		verification,
	};
}

function buildVerificationSummary(input: {
	args: Record<string, unknown>;
	result: Record<string, unknown>;
	lifecycle: CodexToolLifecycle;
}): CodexVerificationSummary {
	const resultView = parseMcpWorkerResult(input.result);
	const payload = resultView.payload;
	const checkKind =
		asString(payload.checkKind) || asString(input.args.checkKind) || "other";
	const label = verificationLabel(checkKind);
	const exitCode =
		typeof payload.exitCode === "number" || payload.exitCode === null
			? (payload.exitCode as number | null)
			: undefined;
	const state = resolveVerificationState({
		lifecycle: input.lifecycle,
		ok: resultView.ok,
		exitCode,
	});
	const evidence =
		payload.managedEvidence === true || asString(payload.evidenceRunId) !== ""
			? "saved"
			: payload.managedEvidence === false
				? "not_saved"
				: "unknown";
	const conditionIds = normalizeStringArray(
		payload.conditionIds ?? input.args.conditionIds,
	);
	const checklist = asRecord(payload.checklist);
	const checklistSummary =
		typeof checklist.complete === "boolean"
			? {
					complete: checklist.complete,
					failedRequired: asNumber(checklist.failedRequired) ?? 0,
					unknownRequired: asNumber(checklist.unknownRequired) ?? 0,
				}
			: null;
	const command =
		asString(payload.command) || asString(input.args.command) || undefined;
	const resultText = buildVerificationResultText({
		state,
		checkKind,
		exitCode,
		llmSummary: asString(payload.llmSummary),
		stdout: asString(payload.stdout),
		stderr: asString(payload.stderr),
	});
	const stateLabel =
		state === "passed"
			? "完了しました"
			: state === "failed"
				? "失敗しました"
				: state === "running"
					? "実行中です"
					: "結果を受け取りました";

	return {
		checkKind,
		label,
		state,
		command,
		resultText,
		exitCode,
		evidence,
		conditionIds,
		checklist: checklistSummary,
		headline: `${label}が${stateLabel}`,
	};
}

function buildVerificationResultText(input: {
	state: CodexVerificationSummary["state"];
	checkKind: string;
	exitCode?: number | null;
	llmSummary: string;
	stdout: string;
	stderr: string;
}) {
	const status =
		input.state === "passed"
			? "OK"
			: input.state === "failed"
				? "ERROR"
				: input.state === "running"
					? "RUNNING"
					: "RESULT";
	const rawOutput = [
		sanitizeTerminalText(input.stdout).trim(),
		input.stderr.trim()
			? `stderr\n${sanitizeTerminalText(input.stderr).trim()}`
			: "",
	]
		.filter(Boolean)
		.join("\n\n");
	return [
		`${status} ${input.checkKind}`,
		input.exitCode === undefined
			? ""
			: `exitCode=${input.exitCode ?? "pending"}`,
		sanitizeTerminalText(input.llmSummary).trim(),
		rawOutput,
	]
		.filter(Boolean)
		.join("\n");
}

function parseMcpWorkerResult(result: Record<string, unknown>): {
	payload: Record<string, unknown>;
	ok?: boolean;
} {
	const structured = asRecord(
		result.structuredContent ?? result.structured_content,
	);
	const structuredPayload = asRecord(structured.payload);
	const parsedText = firstJsonContent(result);
	const parsedPayload = asRecord(parsedText?.payload);
	const payload =
		Object.keys(structuredPayload).length > 0
			? structuredPayload
			: Object.keys(parsedPayload).length > 0
				? parsedPayload
				: asRecord(result.payload);
	const domainOutcome = asString(asRecord(structured.outcome).domainOutcome);
	const ok =
		typeof parsedText?.ok === "boolean"
			? parsedText.ok
			: domainOutcome === "failed"
				? false
				: typeof result.ok === "boolean"
					? result.ok
					: undefined;
	return { payload, ok };
}

function firstJsonContent(result: Record<string, unknown>) {
	if (!Array.isArray(result.content)) return null;
	for (const item of result.content) {
		const text = asString(asRecord(item).text).trim();
		if (!text) continue;
		try {
			const parsed = asRecord(JSON.parse(text));
			if (Object.keys(parsed).length > 0) return parsed;
		} catch {
			// Some MCP results contain human-readable text instead of JSON.
		}
	}
	return null;
}

function resolveVerificationState(input: {
	lifecycle: CodexToolLifecycle;
	ok?: boolean;
	exitCode?: number | null;
}): CodexVerificationSummary["state"] {
	if (input.lifecycle === "started" || input.lifecycle === "progress")
		return "running";
	if (
		input.ok === false ||
		(input.exitCode !== undefined && input.exitCode !== 0)
	)
		return "failed";
	if (input.ok === true || input.exitCode === 0) return "passed";
	if (input.lifecycle === "failed") return "failed";
	return "unknown";
}

function verificationLabel(checkKind: string) {
	const labels: Record<string, string> = {
		lint: "Lintチェック",
		format_check: "フォーマットチェック",
		typecheck: "型チェック",
		test: "テスト",
		coverage: "カバレッジチェック",
		build: "ビルドチェック",
		verify: "総合検証",
		completion_check: "完了条件の確認",
	};
	return labels[checkKind] || "検証チェック";
}

function normalizeStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function buildCommandCard(input: {
	data: Record<string, unknown>;
	lifecycle: CodexToolLifecycle;
	status: CodexToolStatus;
	providerItemId?: string;
	errorMessage?: string;
}): CodexToolCardModel | null {
	const command = asString(input.data.command);
	if (!command) return null;
	const commandClass = asString(input.data.commandClass);
	const editDiffPreview = buildEditCommandDiffPreview(command);
	const exitCode =
		typeof input.data.exitCode === "number" || input.data.exitCode === null
			? String(input.data.exitCode ?? "pending")
			: "";

	return {
		lifecycle: input.lifecycle,
		status: input.status,
		providerItemId: input.providerItemId || undefined,
		toolName: "command_execution",
		command,
		commandClass: commandClass || undefined,
		exitCode:
			typeof input.data.exitCode === "number" || input.data.exitCode === null
				? (input.data.exitCode as number | null)
				: undefined,
		codexKind: editDiffPreview ? "edit_command" : "command",
		title: editDiffPreview ? "Codex edit" : "Codex command",
		summary: editDiffPreview?.summary ?? `command_execution | ${command}`,
		metadata: compactMetadata([
			["class", commandClass],
			["exit", exitCode],
			["file", editDiffPreview?.filePath],
			["provider status", asString(input.data.status)],
		]),
		editDiffPreview: editDiffPreview
			? { diff: editDiffPreview.diff, label: editDiffPreview.label }
			: undefined,
		outputPreview:
			sanitizeTerminalText(asString(input.data.aggregatedOutput)) || undefined,
		detailsFilename: "command result",
		errorMessage: input.errorMessage,
	};
}

type EditCommandDiffPreview = {
	diff: string;
	filePath: string;
	label: string;
	summary: string;
};

function buildEditCommandDiffPreview(
	command: string,
): EditCommandDiffPreview | null {
	const tokens = tokenizeShellLike(command);
	if (tokens[0] !== "sed") return null;
	return buildSedEditDiffPreview(tokens);
}

function buildSedEditDiffPreview(
	tokens: string[],
): EditCommandDiffPreview | null {
	if (!tokens.some((token) => token === "-i" || /^-i.+/.test(token)))
		return null;

	const script = findSedScript(tokens);
	if (!script) return null;
	const substitution = parseSedSubstitution(script);
	if (!substitution) return null;

	const filePath = findSedTargetFile(tokens, script);
	if (!filePath) return null;

	const before = substitution.before || "<matched text>";
	const after = substitution.after || "<empty>";
	const diff = [
		`--- ${filePath}`,
		`+++ ${filePath}`,
		"@@ sed in-place edit @@",
		`- ${before}`,
		`+ ${after}`,
	].join("\n");

	return {
		diff,
		filePath,
		label: "sed edit preview",
		summary: `sed edit | ${filePath} | ${truncatePreview(before)} -> ${truncatePreview(after)}`,
	};
}

function findSedScript(tokens: string[]): string | null {
	for (let index = 1; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (isCommandBoundary(token)) return null;
		if (token === "-e" || token === "-f") {
			const next = tokens[index + 1];
			if (token === "-e" && next && parseSedSubstitution(next)) return next;
			index += 1;
			continue;
		}
		if (token === "-i") {
			const next = tokens[index + 1];
			if (next === "") index += 1;
			continue;
		}
		if (token.startsWith("-")) continue;
		if (parseSedSubstitution(token)) return token;
	}
	return null;
}

function findSedTargetFile(tokens: string[], script: string): string | null {
	const scriptIndex = tokens.indexOf(script);
	if (scriptIndex < 0) return null;
	for (let index = scriptIndex + 1; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (isCommandBoundary(token)) break;
		if (!token || token.startsWith("-")) continue;
		return token;
	}
	return null;
}

function parseSedSubstitution(
	script: string,
): { before: string; after: string } | null {
	if (script.length < 4 || script[0] !== "s") return null;
	const separator = script[1];
	if (!separator || /\w|\s/.test(separator)) return null;

	const beforeEnd = findUnescaped(script, separator, 2);
	if (beforeEnd < 0) return null;
	const afterEnd = findUnescaped(script, separator, beforeEnd + 1);
	if (afterEnd < 0) return null;

	return {
		before: unescapeSedPart(script.slice(2, beforeEnd), separator),
		after: unescapeSedPart(script.slice(beforeEnd + 1, afterEnd), separator),
	};
}

function findUnescaped(
	value: string,
	target: string,
	startIndex: number,
): number {
	let escaped = false;
	for (let index = startIndex; index < value.length; index += 1) {
		const char = value[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = true;
			continue;
		}
		if (char === target) return index;
	}
	return -1;
}

function unescapeSedPart(value: string, separator: string): string {
	return value.replaceAll(`\\${separator}`, separator).replaceAll("\\\\", "\\");
}

function tokenizeShellLike(command: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: '"' | "'" | null = null;
	let escaped = false;

	for (const char of command) {
		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}
		if (char === "\\" && quote !== "'") {
			escaped = true;
			continue;
		}
		if ((char === '"' || char === "'") && (!quote || quote === char)) {
			quote = quote ? null : char;
			continue;
		}
		if (!quote && /\s/.test(char)) {
			tokens.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	tokens.push(current);
	return tokens.filter(
		(token, index, list) => token !== "" || list[index - 1] === "-i",
	);
}

function isCommandBoundary(token: string): boolean {
	return token === "&&" || token === "||" || token === ";" || token === "|";
}

function truncatePreview(value: string): string {
	const compact = value.replace(/\s+/g, " ").trim();
	return compact.length > 42 ? `${compact.slice(0, 39)}...` : compact;
}

function buildFileChangeCard(input: {
	data: Record<string, unknown>;
	lifecycle: CodexToolLifecycle;
	status: CodexToolStatus;
	providerItemId?: string;
	changedFiles: string[];
}): CodexToolCardModel {
	return {
		lifecycle: input.lifecycle,
		status: input.status,
		providerItemId: input.providerItemId || undefined,
		toolName: "file_change",
		codexKind: "file_change",
		title: "Codex file change",
		summary: `Changed files (${input.changedFiles.length})`,
		metadata: compactMetadata([
			["provider status", asString(input.data.status)],
		]),
		resultPreview: input.changedFiles.map((file) => `- ${file}`).join("\n"),
	};
}

function getCodexActivityData(payload: Record<string, unknown>) {
	const directPayload = asRecord(payload.payload);
	if (Object.keys(directPayload).length > 0) return directPayload;
	const runEvent = asRecord(payload.runEvent);
	const runEventData = asRecord(runEvent.data);
	if (Object.keys(runEventData).length > 0) return runEventData;
	return payload;
}

function normalizeLifecycle(input: {
	lifecycle: ToolActivityLifecycle | undefined;
	eventKind?: string;
	eventType?: string | null;
	providerEventType?: string;
}): CodexToolLifecycle | null {
	const { lifecycle } = input;
	if (
		lifecycle === "started" ||
		lifecycle === "progress" ||
		lifecycle === "failed"
	) {
		return lifecycle;
	}
	if (lifecycle === "result") return "result";
	if (input.eventType === "tool.call_started") return "started";
	if (input.eventType === "tool.call_progress") return "progress";
	if (input.eventType === "tool.call_finished") return "result";
	if (input.providerEventType === "item.started") return "started";
	if (input.providerEventType === "item.updated") return "progress";
	if (input.providerEventType === "item.completed") return "result";
	if (input.eventKind === "file.diff") return "result";
	return null;
}

function normalizeStatus(
	lifecycle: CodexToolLifecycle,
	providerStatus?: string | null,
) {
	if (
		providerStatus === "failed" ||
		providerStatus === "error" ||
		providerStatus === "cancelled"
	) {
		return "failed";
	}
	if (lifecycle === "failed") return "failed";
	if (lifecycle === "started") return "started";
	if (lifecycle === "progress") return "running";
	return "ok";
}

export function statusLabel(card: CodexToolCardModel) {
	const lifecycle =
		card.lifecycle === "result"
			? "finished"
			: card.lifecycle === "progress"
				? "running"
				: card.lifecycle;
	return card.status === "failed" ? `${lifecycle} failed` : lifecycle;
}

function isCodexMcpTool(data: Record<string, unknown>, toolName: string) {
	return Boolean(
		asString(data.mcpServer) ||
			asString(data.mcpTool) ||
			toolName.startsWith("nightworkers.") ||
			toolName.startsWith("context-still."),
	);
}

function isIgnoredByDedicatedCard(toolName: string) {
	return (
		toolName === "nightworkers.import_project" ||
		toolName.startsWith("context-still.")
	);
}

function getErrorMessage(
	data: Record<string, unknown>,
	activityError?: Record<string, unknown>,
) {
	const direct = asString(data.error);
	if (direct) return direct;
	const error = asRecord(activityError);
	return asString(error.message) || asString(error.code) || undefined;
}

function serverFromToolName(toolName: string) {
	return toolName.includes(".") ? toolName.split(".")[0] : "";
}

function toolFromToolName(toolName: string) {
	const index = toolName.indexOf(".");
	return index >= 0 ? toolName.slice(index + 1) : toolName;
}

function compactMetadata(
	entries: Array<[string, string | undefined]>,
): CodexToolCardModel["metadata"] {
	return entries
		.filter(
			(entry): entry is [string, string] =>
				typeof entry[1] === "string" && entry[1] !== "",
		)
		.map(([label, value]) => ({ label, value }));
}

function pickNonEmptyRecord(
	preferred: Record<string, unknown>,
	fallback: Record<string, unknown>,
) {
	return Object.keys(preferred).length > 0 ? preferred : fallback;
}

function stringifyPreview(value: unknown) {
	if (!value || typeof value !== "object") return undefined;
	if (Object.keys(asRecord(value)).length === 0) return undefined;
	try {
		return JSON.stringify(sanitizeTerminalPreviewValue(value), null, 2);
	} catch {
		return undefined;
	}
}
