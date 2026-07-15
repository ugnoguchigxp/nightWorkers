import path from "node:path";
import type {
	CodexReadEvidence,
	CodexRuntimeAuditState,
	RuntimeTodoEvidence,
} from "./codex-sdk/codex-sdk-mcp-audit";
import {
	addContractWarning,
	normalizeContractWarning,
} from "./codex-sdk/codex-sdk-mcp-audit";
import type { RuntimeSessionStateStore } from "./runtime-session-state";
import type {
	AgentRunContext,
	AgentRuntimeEvent,
	CodexContractWarning,
} from "./types";

export * from "./codex-runtime-evidence";
export async function persistCodexProviderThreadIfPresent(
	store: RuntimeSessionStateStore,
	context: AgentRunContext,
	event: AgentRuntimeEvent,
) {
	const payload = readEventPayload(event);
	if (event.type !== "runtime_started") return;
	const providerThreadId = readString(payload.providerThreadId);
	if (!providerThreadId) return;
	await store.upsertRuntimeSessionState({
		taskId: context.taskId,
		agentModeSessionId: context.agentModeSessionId,
		repositoryId: context.repositoryId,
		runId: context.runId,
		runtimeLane: "codex-sdk",
		provider: "codex",
		providerSessionId: providerThreadId,
		executionMode: readCodexRuntimeExecutionMode(context),
		model: readCodexRuntimeModel(context),
		metadata: {
			source: "thread.started",
			providerThreadId,
		},
	});
}

export function updateCodexSessionKey(
	current: string | null,
	event: AgentRuntimeEvent,
) {
	if (event.type !== "runtime_started") return current;
	return readString(readEventPayload(event).providerThreadId) ?? current;
}

export function normalizeRetryLimit(
	value: number | undefined,
	fallback: number,
) {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.max(0, Math.floor(value));
}

export function normalizeRetryDelayMs(
	value: number | undefined,
	fallback: number,
) {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.max(0, Math.floor(value));
}

export async function sleep(ms: number, signal: AbortSignal) {
	if (ms <= 0 || signal.aborted) return;
	await new Promise<void>((resolve) => {
		const timeout = setTimeout(resolve, ms);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timeout);
				resolve();
			},
			{ once: true },
		);
	});
}

export function readEventPayload(
	event: AgentRuntimeEvent,
): Record<string, unknown> {
	return event.payload && typeof event.payload === "object"
		? (event.payload as Record<string, unknown>)
		: {};
}

export function readString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

export function readExitCode(payload: Record<string, unknown>): number | null {
	if (typeof payload.exitCode === "number") return payload.exitCode;
	if (typeof payload.exit_code === "number") return payload.exit_code;
	return null;
}

export function readChangedFiles(payload: Record<string, unknown>): string[] {
	return Array.isArray(payload.changedFiles)
		? payload.changedFiles.filter(
				(file): file is string => typeof file === "string",
			)
		: [];
}

export function readCodexRuntimeExecutionMode(context: AgentRunContext) {
	void context;
	return "implementation";
}

export function readPromptPartObservabilityEnabled(context: AgentRunContext) {
	const llmUsage =
		context.runtimeOptions?.llmUsage &&
		typeof context.runtimeOptions.llmUsage === "object"
			? (context.runtimeOptions.llmUsage as Record<string, unknown>)
			: null;
	return llmUsage?.promptPartObservabilityEnabled !== false;
}

export function readCodexRuntimeModel(context: AgentRunContext) {
	const codex = readRecord(context.runtimeOptions?.codex);
	return readString(codex?.model);
}

export function toContractWarningEvent(
	auditState: CodexRuntimeAuditState,
	warning: CodexContractWarning,
): AgentRuntimeEvent | null {
	const normalized = normalizeContractWarning({
		...warning,
		sequence: warning.sequence ?? auditState.eventSequence,
		occurredAt: warning.occurredAt ?? new Date().toISOString(),
		count: warning.count ?? 1,
	});
	const added = addContractWarning(auditState, normalized);
	if (!added.isNew && normalized.severity !== "error") return null;
	return {
		type: "runtime_warning",
		message: `[Codex Contract Warning] ${normalized.message}`,
		payload: normalized,
	};
}

export function createdFileContextDirectories(normalizedPath: string) {
	const direct = path.posix.dirname(normalizedPath);
	const parent = path.posix.dirname(direct);
	return [direct, parent].filter(
		(directory, index, directories) =>
			directory !== "." &&
			directory !== "/" &&
			directories.indexOf(directory) === index,
	);
}

export function hasEvidenceBefore(
	evidence: CodexReadEvidence[] | undefined,
	sequence: number,
	input: { allowDiff?: boolean } = {},
) {
	const allowDiff = input.allowDiff ?? true;
	return Boolean(
		evidence?.some(
			(item) => item.sequence < sequence && (allowDiff || item.kind !== "diff"),
		),
	);
}

export function isCreatedFileChange(
	payload: Record<string, unknown>,
	filePath: string,
) {
	const changes = Array.isArray(payload.changes) ? payload.changes : [];
	return changes.some((change) => {
		if (!change || typeof change !== "object") return false;
		const record = change as Record<string, unknown>;
		const changePath =
			readString(record.path) ??
			readString(record.filePath) ??
			readString(record.relativePath);
		if (changePath && !filePathsMatch(changePath, filePath)) return false;
		const value =
			readString(record.type) ??
			readString(record.status) ??
			readString(record.kind);
		return (
			value === "add" ||
			value === "added" ||
			value === "create" ||
			value === "created"
		);
	});
}

function filePathsMatch(observedPath: string, failurePath: string) {
	const normalizedObserved = observedPath.replaceAll("\\", "/");
	const normalizedFailure = failurePath.replaceAll("\\", "/");
	return (
		normalizedObserved === normalizedFailure ||
		normalizedFailure.endsWith(`/${normalizedObserved}`) ||
		normalizedObserved.endsWith(`/${normalizedFailure}`)
	);
}

export function appendMapValue<K, V>(map: Map<K, V[]>, key: K, value: V) {
	const existing = map.get(key);
	if (existing) {
		existing.push(value);
		return;
	}
	map.set(key, [value]);
}

export function tokenizeShellLike(command: string) {
	const tokens: string[] = [];
	let current = "";
	let quote: '"' | "'" | null = null;
	for (let index = 0; index < command.length; index += 1) {
		const char = command[index];
		if (quote) {
			if (char === quote) {
				quote = null;
			} else {
				current += char;
			}
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (/\s/.test(char)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		if (
			(char === "&" && command[index + 1] === "&") ||
			(char === "|" && command[index + 1] === "|")
		) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			tokens.push(`${char}${command[index + 1]}`);
			index += 1;
			continue;
		}
		if (char === ";" || char === "|" || char === "<" || char === ">") {
			if (current) {
				tokens.push(current);
				current = "";
			}
			tokens.push(char);
			continue;
		}
		current += char;
	}
	if (current) tokens.push(current);
	return tokens;
}

export function isCommandBoundary(token: string) {
	return (
		token === "&&" ||
		token === "||" ||
		token === ";" ||
		token === "|" ||
		token === "<" ||
		token === ">"
	);
}

export function isLikelyPathToken(token: string) {
	if (!token || token.includes("$(") || token.includes("`")) return false;
	if (/^[0-9]+(?:,[0-9]+)?p$/.test(token)) return false;
	return (
		token.includes("/") ||
		token.startsWith(".") ||
		/\.(?:[cm]?[jt]sx?|css|scss|md|json|ya?ml|toml|sql|rs|py|go|java|html|txt)$/.test(
			token,
		)
	);
}

export function normalizeRepoRelativePath(value: string, repoRoot: string) {
	const normalizedRoot = path.resolve(repoRoot).replaceAll("\\", "/");
	const normalizedValue = value.replaceAll("\\", "/");
	const absolute = path.isAbsolute(normalizedValue)
		? path.normalize(normalizedValue).replaceAll("\\", "/")
		: path.resolve(repoRoot, normalizedValue).replaceAll("\\", "/");
	const relative = absolute.startsWith(`${normalizedRoot}/`)
		? absolute.slice(normalizedRoot.length + 1)
		: normalizedValue;
	return path.posix.normalize(relative).replace(/^\.\//, "");
}

export function hasTodoProgressWarning(auditState: CodexRuntimeAuditState) {
	return auditState.contractWarnings.some(
		(warning) =>
			warning.code === "codex_todo_progress_missing" ||
			warning.code === "codex_todo_progress_list_only",
	);
}

export function isFailedToolPayload(payload: Record<string, unknown>) {
	return (
		payload.status === "failed" ||
		payload.status === "error" ||
		payload.status === "cancelled" ||
		typeof payload.error === "string" ||
		readMcpResultError(payload.result) !== null
	);
}

export function isTransportFailedToolPayload(payload: Record<string, unknown>) {
	const result = readRecord(payload.result);
	const structuredContent = readRecord(result?.structuredContent) ?? result;
	const outcome = readRecord(structuredContent?.outcome);
	const transportStatus = readString(outcome?.transportStatus);
	if (transportStatus) return transportStatus !== "completed";
	return (
		payload.status === "error" ||
		payload.status === "cancelled" ||
		typeof payload.error === "string"
	);
}

export function isMcpToolPayload(payload: Record<string, unknown>) {
	return (
		typeof payload.mcpServer === "string" && typeof payload.mcpTool === "string"
	);
}

export function isCodexFileChangeEvent(payload: Record<string, unknown>) {
	return payload.provider === "codex" && Array.isArray(payload.changedFiles);
}

export function todoPayload(todo: RuntimeTodoEvidence | null) {
	if (!todo) return {};
	return {
		todoId: todo.id,
		todoSeq: todo.seq,
		todoTitle: todo.title,
		todoProcedureId: todo.procedureId ?? null,
	};
}

export function readImportProjectSuccessPayload(
	payload: Record<string, unknown>,
): {
	recommendedVerificationCommands: string[];
} | null {
	if (isFailedToolPayload(payload)) return null;
	const resultRecord = readMcpPayloadRecord(payload.result);
	if (!resultRecord) return null;
	const postImport = readRecord(resultRecord.postImport);
	const manifest = readRecord(postImport?.manifest);
	const commands = Array.isArray(manifest?.recommendedVerificationCommands)
		? manifest.recommendedVerificationCommands.filter(
				(command): command is string =>
					typeof command === "string" && command.trim().length > 0,
			)
		: [];
	return { recommendedVerificationCommands: commands };
}

function readMcpPayloadRecord(value: unknown): Record<string, unknown> | null {
	const record = readRecord(value);
	if (!record) return null;
	if (isImportProjectPayloadRecord(record)) return record;
	const payload = readRecord(record.payload);
	if (payload && isImportProjectPayloadRecord(payload)) return payload;
	const structuredPayload = readRecord(
		readRecord(record.structuredContent)?.payload,
	);
	if (structuredPayload && isImportProjectPayloadRecord(structuredPayload)) {
		return structuredPayload;
	}
	const content = Array.isArray(record.content) ? record.content : [];
	for (const item of content) {
		const text = readString(readRecord(item)?.text);
		if (!text) continue;
		const parsed = parseJsonRecord(text);
		if (!parsed) continue;
		if (isImportProjectPayloadRecord(parsed)) return parsed;
		const parsedPayload = readRecord(parsed.payload);
		if (parsedPayload && isImportProjectPayloadRecord(parsedPayload))
			return parsedPayload;
	}
	return null;
}

function readMcpResultError(value: unknown): string | null {
	const record = readRecord(value);
	if (!record) return null;
	const directError = readRecord(record.error);
	const structuredError = readRecord(
		readRecord(record.structuredContent)?.error,
	);
	const message =
		readString(directError?.message) ?? readString(structuredError?.message);
	if (message) return message;
	const content = Array.isArray(record.content) ? record.content : [];
	for (const item of content) {
		const text = readString(readRecord(item)?.text);
		if (!text) continue;
		const parsedError = readRecord(parseJsonRecord(text)?.error);
		const parsedMessage = readString(parsedError?.message);
		if (parsedMessage) return parsedMessage;
	}
	return record.isError === true
		? "NightWorkers MCP tool returned an error result."
		: null;
}

function isImportProjectPayloadRecord(value: Record<string, unknown>) {
	return "postImport" in value || ("template" in value && "git" in value);
}

export function parseJsonRecord(text: string): Record<string, unknown> | null {
	try {
		return readRecord(JSON.parse(text));
	} catch {
		return null;
	}
}

export function readRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function changedFilesFromDiff(diff: string): string[] {
	const files = new Set<string>();
	for (const line of diff.split("\n")) {
		const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
		if (match?.[2]) files.add(match[2]);
	}
	return [...files];
}
