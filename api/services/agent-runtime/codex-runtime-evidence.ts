import path from "node:path";
import * as repo from "../../modules/nightworkers/nightworkers.repository";
import {
	appendMapValue,
	createdFileContextDirectories,
	hasEvidenceBefore,
	isCommandBoundary,
	isCreatedFileChange,
	isLikelyPathToken,
	normalizeRepoRelativePath,
	parseJsonRecord,
	readRecord,
	readString,
	tokenizeShellLike,
} from "./codex-runtime-support";
import { normalizeCodexCommand } from "./codex-sdk/codex-sdk-event-adapter";
import type {
	CodexReadEvidence,
	CodexRuntimeAuditState,
	RuntimeTodoEvidence,
	RuntimeTodoEvidenceReadResult,
} from "./codex-sdk/codex-sdk-mcp-audit";
import type { AgentRunContext } from "./types";

export async function readCurrentTodoEvidence(
	context: AgentRunContext,
): Promise<RuntimeTodoEvidenceReadResult> {
	try {
		const todos = await repo.listTaskRunTodosForRun(context.runId);
		const current = todos
			.filter((todo) => todo.status === "running")
			.sort((a, b) => a.seq - b.seq)[0];
		if (!current) return { todo: null, source: "none", dbReadFailed: false };
		return {
			todo: {
				id: current.id,
				seq: current.seq,
				title: current.title,
				procedureId: current.procedureId ?? null,
			},
			source: "db",
			dbReadFailed: false,
		};
	} catch {
		if (context.currentTodo?.status === "running") {
			return {
				todo: {
					id: context.currentTodo.id,
					seq: context.currentTodo.seq,
					title: context.currentTodo.title,
					procedureId: context.currentTodo.procedureId ?? null,
				},
				source: "context",
				dbReadFailed: true,
			};
		}
		if (context.todoPlan?.length) {
			const current = context.todoPlan
				.filter((todo) => todo.status === "running")
				.sort((a, b) => a.seq - b.seq)[0];
			if (current) {
				return {
					todo: {
						id: current.id,
						seq: current.seq,
						title: current.title,
						procedureId: current.procedureId ?? null,
					},
					source: "context",
					dbReadFailed: true,
				};
			}
		}
		return { todo: null, source: "none", dbReadFailed: true };
	}
}

export function readToolOperation(
	payload: Record<string, unknown>,
): string | null {
	const args = payload.arguments;
	if (!args || typeof args !== "object" || Array.isArray(args)) return null;
	const operation = (args as Record<string, unknown>).operation;
	return typeof operation === "string" ? operation : null;
}

export function readTodoTransitionResult(
	payload: Record<string, unknown>,
): string | null {
	const todoPayload = readTodoActionPayload(payload);
	const operation = readToolOperation(payload);
	const nextCurrentSeq = readRecord(todoPayload?.transition)?.nextCurrentSeq;
	if (typeof nextCurrentSeq === "number")
		return `${operation || "todo"}:next:${nextCurrentSeq}`;
	if (todoPayload?.currentTodo)
		return `${operation || "todo"}:current:${todoPayload.currentTodo.seq}`;
	return operation ? `${operation}:no_current` : null;
}

export function isValidTodoProgressOperation(
	operation: string | null,
	payload: Record<string, unknown>,
) {
	if (operation === "start" || operation === "replace") return true;
	if (operation === "done") {
		const todoPayload = readTodoActionPayload(payload);
		return Boolean(todoPayload?.currentTodo || todoPayload?.nextTodo);
	}
	return false;
}

export function readTodoActionPayload(payload: Record<string, unknown>): {
	currentTodo?: RuntimeTodoEvidence | null;
	nextTodo?: RuntimeTodoEvidence | null;
	transition?: Record<string, unknown> | null;
} | null {
	const record = readMcpGenericPayloadRecord(payload.result);
	if (!record) return null;
	const currentTodo = readTodoEvidenceRecord(readRecord(record.currentTodo));
	const nextTodo = readTodoEvidenceRecord(readRecord(record.nextTodo));
	return {
		currentTodo,
		nextTodo,
		transition: readRecord(record.transition),
	};
}

export function readMcpGenericPayloadRecord(
	value: unknown,
): Record<string, unknown> | null {
	const record = readRecord(value);
	if (!record) return null;
	const payload = readRecord(record.payload);
	if (payload) return payload;
	const structuredPayload = readRecord(
		readRecord(record.structuredContent)?.payload,
	);
	if (structuredPayload) return structuredPayload;
	const content = Array.isArray(record.content) ? record.content : [];
	for (const item of content) {
		const text = readString(readRecord(item)?.text);
		if (!text) continue;
		const parsed = parseJsonRecord(text);
		if (!parsed) continue;
		return readRecord(parsed.payload) ?? parsed;
	}
	return record;
}

export function readTodoEvidenceRecord(
	record: Record<string, unknown> | null,
): RuntimeTodoEvidence | null {
	if (!record) return null;
	const id = readString(record.id);
	const title = readString(record.title);
	const seq = record.seq;
	if (!id || !title || typeof seq !== "number") return null;
	return {
		id,
		seq,
		title,
		procedureId: readString(record.procedureId),
	};
}

export function isTodoProgressMutationOperation(value: string | null) {
	return (
		value === "replace" ||
		value === "start" ||
		value === "done" ||
		value === "block" ||
		value === "fail"
	);
}

export function hasValidTodoProgressBeforeFileChange(
	auditState: CodexRuntimeAuditState,
	fileChangeSequence: number,
) {
	if (
		auditState.lastProgressValidSequence === null ||
		auditState.lastProgressValidSequence >= fileChangeSequence
	) {
		return false;
	}
	if (
		auditState.lastNightworkersTodoMutationSequence !== null &&
		auditState.lastNightworkersTodoMutationSequence >
			auditState.lastProgressValidSequence &&
		(auditState.lastNightworkersTodoMutationOperation === "done" ||
			auditState.lastNightworkersTodoMutationOperation === "block" ||
			auditState.lastNightworkersTodoMutationOperation === "fail")
	) {
		return false;
	}
	return true;
}

export function recordCommandReadEvidence(input: {
	auditState: CodexRuntimeAuditState;
	repoRoot: string;
	sequence: number;
	command: string | null;
	commandClass: string | null;
	exitCode: number | null;
	status: string | null;
	providerItemId: string | null;
}) {
	if (!input.command) return;
	if (input.status && input.status !== "completed") return;
	if (input.exitCode !== null && input.exitCode !== 0) return;
	const normalizedCommand = normalizeCodexCommand(input.command);
	const normalizedClass =
		input.commandClass === "inspection" ||
		classifyInspectionCommand(normalizedCommand)
			? "inspection"
			: input.commandClass;
	if (normalizedClass !== "inspection") return;
	const paths = extractReadEvidencePaths(normalizedCommand, input.repoRoot);
	for (const { path: pathValue, kind } of paths) {
		const evidence: CodexReadEvidence = {
			sequence: input.sequence,
			path: pathValue,
			source: "command_execution",
			kind,
			command: input.command,
			normalizedCommand,
			providerItemId: input.providerItemId,
		};
		appendMapValue(input.auditState.readEvidenceByPath, pathValue, evidence);
		appendMapValue(
			input.auditState.createdFileContextEvidenceByDirectory,
			path.posix.dirname(pathValue),
			evidence,
		);
	}
}

export function classifyInspectionCommand(command: string) {
	return (
		/^(?:pwd|ls|find|tree|wc)\b/.test(command) ||
		/^(?:rg|grep|cat|sed|awk|head|tail|nl)\b/.test(command) ||
		/^git\s+(?:status|diff|log|show|branch|rev-parse)\b/.test(command)
	);
}

export function extractReadEvidencePaths(command: string, repoRoot: string) {
	const tokens = tokenizeShellLike(command);
	const paths = new Map<string, CodexReadEvidence["kind"]>();
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (
			token === "cat" ||
			token === "nl" ||
			token === "head" ||
			token === "tail"
		) {
			collectPathArgs(tokens, index + 1, repoRoot, paths, "content");
		}
		if (token === "sed") {
			collectPathArgs(tokens, index + 1, repoRoot, paths, "content");
		}
		if (token === "rg" || token === "grep") {
			collectSearchPathArgs(tokens, index + 1, repoRoot, paths);
		}
		if (token === "git" && tokens[index + 1] === "diff") {
			const separatorIndex = tokens.indexOf("--", index + 2);
			if (separatorIndex >= 0)
				collectPathArgs(tokens, separatorIndex + 1, repoRoot, paths, "diff");
		}
	}
	return [...paths.entries()].map(([path, kind]) => ({ path, kind }));
}

export function collectPathArgs(
	tokens: string[],
	startIndex: number,
	repoRoot: string,
	output: Map<string, CodexReadEvidence["kind"]>,
	kind: CodexReadEvidence["kind"],
) {
	for (let index = startIndex; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (isCommandBoundary(token)) break;
		if (token.startsWith("-")) continue;
		if (!isLikelyPathToken(token)) continue;
		output.set(normalizeRepoRelativePath(token, repoRoot), kind);
	}
}

export function collectSearchPathArgs(
	tokens: string[],
	startIndex: number,
	repoRoot: string,
	output: Map<string, CodexReadEvidence["kind"]>,
) {
	let sawPattern = false;
	for (let index = startIndex; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (isCommandBoundary(token)) break;
		if (token.startsWith("-")) continue;
		if (!sawPattern) {
			sawPattern = true;
			continue;
		}
		if (!isLikelyPathToken(token)) continue;
		output.set(normalizeRepoRelativePath(token, repoRoot), "content");
	}
}

export function hasPriorReadEvidence(
	auditState: CodexRuntimeAuditState,
	repoRoot: string,
	filePath: string,
	fileChangeSequence: number,
	payload: Record<string, unknown>,
) {
	const normalizedPath = normalizeRepoRelativePath(filePath, repoRoot);
	const created = isCreatedFileChange(payload, filePath);
	if (
		!created &&
		hasEvidenceBefore(
			auditState.readEvidenceByPath.get(normalizedPath),
			fileChangeSequence,
		)
	) {
		return true;
	}
	if (!created) return false;
	return createdFileContextDirectories(normalizedPath).some((directory) =>
		hasEvidenceBefore(
			auditState.createdFileContextEvidenceByDirectory.get(directory),
			fileChangeSequence,
			{ allowDiff: false },
		),
	);
}
