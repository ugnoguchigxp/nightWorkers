import type { ActivityEvent, TaskEvent } from "../types";
import {
	asRecord,
	asString,
	getActivityChangedFiles,
	getToolActivityModel,
	isChangedFilesOnlyDiffActivity,
	type ToolActivityLifecycle,
} from "./ThreadTimeline";
import { DiffCodeBlock } from "./ThreadTimelineDiffView";
import { NightWorkersCodeBlock } from "./ThreadTimelineMarkdown";
import {
	sanitizeTerminalPreviewValue,
	sanitizeTerminalText,
} from "./terminalText";

type CodexToolLifecycle = "started" | "progress" | "result" | "failed";
type CodexToolStatus = "started" | "running" | "ok" | "failed";
const CODEX_TOOL_RESULT_HEIGHT_REDUCTION = 104;

export type CodexToolCardModel = {
	lifecycle: CodexToolLifecycle;
	status: CodexToolStatus;
	providerItemId?: string;
	toolName: string;
	codexKind: "mcp" | "command" | "edit_command" | "file_change";
	title: string;
	summary: string;
	metadata: Array<{ label: string; value: string }>;
	argumentsPreview?: string;
	editDiffPreview?: { diff: string; label: string };
	resultPreview?: string;
	outputPreview?: string;
	detailsFilename?: string;
	errorMessage?: string;
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
		return buildMcpCard({
			data,
			activityArguments: activity?.arguments ?? {},
			activityRawResult: activity?.rawResult ?? {},
			lifecycle,
			status,
			providerItemId,
			toolName,
			errorMessage,
		});
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

export function CodexToolCard({ event }: { event: TaskEvent | ActivityEvent }) {
	const card = getCodexToolCardModel(event);
	if (!card) return null;

	return (
		<details
			className="rounded border border-cyan-700/60 bg-cyan-950/20 text-slate-100"
			open
		>
			<summary className="cursor-pointer list-none px-3 py-2 text-xs">
				<span className="mr-2 rounded border border-current/30 px-1.5 py-0.5">
					{card.title}
				</span>
				<span className="text-current/80">{card.summary}</span>
				{typeof event.seq === "number" ? (
					<span className="ml-2 text-current/50">#{event.seq}</span>
				) : null}
			</summary>
			<CodexToolCardBody card={card} debug />
		</details>
	);
}

export function NormalCodexToolCard({
	event,
}: {
	event: TaskEvent | ActivityEvent;
}) {
	const card = getCodexToolCardModel(event);
	if (!card) return null;

	return (
		<details className="overflow-hidden rounded-[var(--radius-md)] border border-transparent bg-[#1f2030] text-sm text-slate-200">
			<summary className="cursor-pointer list-none px-4 py-3">
				<div className="flex items-baseline justify-between gap-4">
					<span className="min-w-0 truncate text-slate-200">
						{card.summary}
					</span>
					<span className="shrink-0 whitespace-nowrap text-right text-slate-400">
						{card.title}
					</span>
				</div>
				<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
					<span>{statusLabel(card)}</span>
					{card.metadata.slice(0, 3).map((item) => (
						<span key={`${item.label}:${item.value}`}>
							{item.label}: {item.value}
						</span>
					))}
				</div>
			</summary>
			<CodexToolCardBody card={card} />
		</details>
	);
}

function CodexToolCardBody({
	card,
	debug = false,
}: {
	card: CodexToolCardModel;
	debug?: boolean;
}) {
	const detailLines = [
		`toolName: ${card.toolName}`,
		`lifecycle: ${card.lifecycle}`,
		`status: ${card.status}`,
		card.providerItemId ? `providerItemId: ${card.providerItemId}` : "",
		...card.metadata.map((item) => `${item.label}: ${item.value}`),
		card.errorMessage ? `error: ${card.errorMessage}` : "",
	].filter(Boolean);
	const blocks = [
		detailLines.join("\n"),
		card.argumentsPreview ? `arguments:\n${card.argumentsPreview}` : "",
		card.resultPreview ? `result:\n${card.resultPreview}` : "",
		card.outputPreview ? `output:\n${card.outputPreview}` : "",
	].filter(Boolean);
	if (blocks.length === 0) return null;

	return (
		<div className="border-slate-700/60 border-t">
			{card.editDiffPreview ? (
				<div className="space-y-2 p-3">
					<DiffCodeBlock
						code={card.editDiffPreview.diff}
						label={card.editDiffPreview.label}
					/>
					{card.outputPreview ? (
						<NightWorkersCodeBlock
							code={card.outputPreview}
							filename={card.detailsFilename || `${card.toolName}.output.txt`}
							language="text"
							maxHeight={codexToolCodeBlockMaxHeight(card, debug, "output")}
							syntaxHighlighting={false}
						/>
					) : null}
				</div>
			) : (
				<NightWorkersCodeBlock
					code={blocks.join("\n\n")}
					filename={card.detailsFilename || `${card.toolName}.txt`}
					language="text"
					maxHeight={codexToolCodeBlockMaxHeight(card, debug, "details")}
					syntaxHighlighting={false}
				/>
			)}
		</div>
	);
}

function codexToolCodeBlockMaxHeight(
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
		title: "Codex MCP",
		summary: summaryParts.join(" | "),
		metadata: compactMetadata([
			["server", server],
			["tool", tool],
			["provider status", asString(input.data.status)],
		]),
		argumentsPreview: stringifyPreview(args),
		resultPreview: stringifyPreview(result),
		errorMessage: input.errorMessage,
	};
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

function statusLabel(card: CodexToolCardModel) {
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
