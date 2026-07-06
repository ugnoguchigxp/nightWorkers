import {
	readChangedFiles,
	readEventPayload,
	readString,
} from "./codex-runtime-support";
import type { AgentRuntimeEvent, AgentRuntimeResult } from "./types";

export const DEFAULT_RESULT: AgentRuntimeResult = {
	terminalState: "failed",
	summary: "Codex Agent Runtime failed.",
	finalReport: "",
	stoppedBy: "llm_error",
	riskLevel: "high",
};
export const DEFAULT_PROVIDER_CAPACITY_RETRY_LIMIT = 1;
export const DEFAULT_PROVIDER_CAPACITY_RETRY_DELAY_MS = 5000;

export type CodexTerminalReason =
	| "provider_capacity"
	| "codex_exec_nonzero"
	| "unrecovered_tool_failure"
	| "unknown_runtime_error";

export type CodexRuntimeFailureEvidence = {
	reason: CodexTerminalReason;
	message: string;
	source: "runtime_error" | "turn_failed" | "stream_error" | "exec_exit";
	rawMessage?: string;
};

export type CodexExecExitError = {
	detail: string | null;
	message: string;
	stderr: string;
};

export type CodexObservedFileChange = {
	filePath: string;
	providerItemId: string | null;
	observedAtMs: number;
};

export type CodexToolFailureDiagnostic = {
	kind: "apply_patch_verification_failed";
	filePath: string | null;
	recovered: boolean;
	reason: CodexTerminalReason;
	message: string;
};

export type CodexFailureReport = {
	reason: CodexTerminalReason;
	summary: string;
	diagnostics: string[];
	execExitError: CodexExecExitError | null;
	recoveredToolFailures: CodexToolFailureDiagnostic[];
	unrecoveredToolFailures: CodexToolFailureDiagnostic[];
};

export function readRuntimeFailureEvidence(
	event: AgentRuntimeEvent,
): CodexRuntimeFailureEvidence {
	const payload = readEventPayload(event);
	const rawMessage = readString(payload.error) ?? event.message;
	const providerEventType = readString(payload.providerEventType);
	return {
		reason: classifyTerminalRuntimeError(rawMessage),
		message: sanitizeSingleLine(rawMessage),
		source:
			providerEventType === "turn.failed"
				? "turn_failed"
				: providerEventType === "error"
					? "stream_error"
					: "runtime_error",
		rawMessage,
	};
}

export function readCompletedFileChanges(
	event: AgentRuntimeEvent,
): CodexObservedFileChange[] {
	const payload = readEventPayload(event);
	if (payload.status !== "completed") return [];
	const observedAtMs = Date.now();
	return readChangedFiles(payload).map((filePath) => ({
		filePath,
		providerItemId: readString(payload.providerItemId),
		observedAtMs,
	}));
}

export function parseCodexExecExitError(
	message: string,
): CodexExecExitError | null {
	const match = /^Codex Exec exited with ([^:]+):\s*([\s\S]*)$/.exec(message);
	if (!match) return null;
	return {
		detail: match[1]?.trim() || null,
		message,
		stderr: match[2] || "",
	};
}

function classifyTerminalRuntimeError(message: string): CodexTerminalReason {
	const clean = stripAnsi(message);
	if (/Selected model is at capacity/i.test(clean)) return "provider_capacity";
	if (/^Codex Exec exited with\b/.test(clean)) return "codex_exec_nonzero";
	return "unknown_runtime_error";
}

export function buildCodexFailureReport(input: {
	terminalError: CodexRuntimeFailureEvidence | null;
	execExitError: CodexExecExitError | null;
	unknownErrorMessage?: string | null;
	completedFileChanges: CodexObservedFileChange[];
}): CodexFailureReport {
	const toolFailures = input.execExitError
		? detectApplyPatchFailures(
				input.execExitError.stderr,
				input.completedFileChanges,
			)
		: [];
	const unrecoveredToolFailures = toolFailures.filter(
		(failure) => !failure.recovered,
	);
	const recoveredToolFailures = toolFailures.filter(
		(failure) => failure.recovered,
	);
	const reason: CodexTerminalReason =
		input.terminalError?.reason ??
		(unrecoveredToolFailures.length > 0
			? "unrecovered_tool_failure"
			: input.execExitError
				? "codex_exec_nonzero"
				: "unknown_runtime_error");
	const terminalMessage =
		input.terminalError?.message ??
		unrecoveredToolFailures[0]?.message ??
		(input.execExitError
			? `Codex exec exited with ${input.execExitError.detail || "non-zero status"}.`
			: input.unknownErrorMessage
				? sanitizeSingleLine(input.unknownErrorMessage)
				: "Unknown runtime error.");
	const diagnostics: string[] = [];
	for (const failure of recoveredToolFailures)
		diagnostics.push(failure.message);
	if (input.execExitError) {
		diagnostics.push(
			`Codex exec exited with ${input.execExitError.detail || "non-zero status"}; stderr retained in diagnostics.`,
		);
		if (input.execExitError.stderr.trim())
			diagnostics.push(input.execExitError.stderr.trim());
	}
	return {
		reason,
		summary: `Codex Agent Runtime failed: ${reason}: ${terminalMessage}`,
		diagnostics,
		execExitError: input.execExitError,
		recoveredToolFailures,
		unrecoveredToolFailures,
	};
}

function detectApplyPatchFailures(
	stderr: string,
	completedFileChanges: CodexObservedFileChange[],
): CodexToolFailureDiagnostic[] {
	const clean = stripAnsi(stderr);
	if (!/apply_patch verification failed/i.test(clean)) return [];
	const filePath = extractApplyPatchFailurePath(clean);
	if (!filePath) return [];
	const failureOccurredAtMs = extractFirstIsoTimestampMs(clean);
	const recovered = completedFileChanges.some(
		(change) =>
			filePathsMatch(change.filePath, filePath) &&
			(failureOccurredAtMs === null ||
				change.observedAtMs >= failureOccurredAtMs),
	);
	const shortPath = filePath;
	return [
		{
			kind: "apply_patch_verification_failed",
			filePath,
			recovered,
			reason: recovered ? "codex_exec_nonzero" : "unrecovered_tool_failure",
			message: recovered
				? `Recovered tool failure: apply_patch verification failed in ${shortPath}.`
				: `Unrecovered tool failure: apply_patch verification failed in ${shortPath}.`,
		},
	];
}

function extractApplyPatchFailurePath(stderr: string): string | null {
	const match = /Failed to find expected lines in ([^\n:]+):/.exec(stderr);
	return match?.[1]?.trim() || null;
}

function extractFirstIsoTimestampMs(value: string): number | null {
	const match = /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?Z\b/.exec(
		value,
	);
	if (!match) return null;
	const fractional = match[2] ? match[2].slice(0, 4).padEnd(4, "0") : "";
	const timestamp = Date.parse(`${match[1]}${fractional}Z`);
	return Number.isFinite(timestamp) ? timestamp : null;
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

function stripAnsi(value: string) {
	return value.replace(
		new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"),
		"",
	);
}

function sanitizeSingleLine(value: string) {
	return stripAnsi(value).replace(/\s+/g, " ").trim();
}
