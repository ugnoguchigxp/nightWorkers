import type { AgentRuntimeEvent } from "../types";

const RETRYABLE_IMPORT_CANCEL_ERROR = "user cancelled MCP tool call";

export type ProjectImportOutcome =
	| {
			kind: "cancelled";
			toolName: string;
			providerItemId: string | null;
	  }
	| {
			kind: "failed";
			toolName: string;
			providerItemId: string | null;
			error: string;
			retryableTransportCancel: boolean;
	  };

export function getProjectImportOutcome(
	event: AgentRuntimeEvent,
): ProjectImportOutcome | null {
	if (event.type !== "tool_call_finished") return null;
	const payload = readEventPayload(event);
	const toolName =
		payload.toolName === "nightworkers.import_project"
			? payload.toolName
			: null;
	if (!toolName) {
		return null;
	}
	const providerItemId =
		typeof payload.providerItemId === "string" ? payload.providerItemId : null;
	if (payload.status === "cancelled") {
		return {
			kind: "cancelled",
			toolName,
			providerItemId,
		};
	}
	const resultError = readMcpResultError(payload.result);
	if (
		payload.status === "failed" ||
		typeof payload.error === "string" ||
		resultError
	) {
		const error =
			typeof payload.error === "string"
				? payload.error
				: resultError || "nightworkers.import_project failed";
		return {
			kind: "failed",
			toolName,
			providerItemId,
			error,
			retryableTransportCancel: isRetryableProjectImportTransportCancel(
				payload,
				error,
			),
		};
	}
	return null;
}

export function buildProjectImportFailureReport(
	outcome: Extract<ProjectImportOutcome, { kind: "failed" }>,
): string {
	const providerItem = outcome.providerItemId
		? ` providerItemId=${outcome.providerItemId}.`
		: "";
	if (outcome.retryableTransportCancel) {
		return `Project import failed before the MCP server returned a tool result: ${outcome.error}.${providerItem} Stopping without retry or fallback implementation.`;
	}
	return `Project import failed: ${outcome.error}.${providerItem} Stopping without fallback implementation.`;
}

export function buildProjectImportCancelledReport(
	outcome: Extract<ProjectImportOutcome, { kind: "cancelled" }>,
): string {
	const providerItem = outcome.providerItemId
		? ` providerItemId=${outcome.providerItemId}.`
		: "";
	return `Project import was cancelled by the user.${providerItem} Stopping without fallback implementation.`;
}

function isRetryableProjectImportTransportCancel(
	payload: Record<string, unknown>,
	error: string,
): boolean {
	return (
		error === RETRYABLE_IMPORT_CANCEL_ERROR &&
		payload.status === "failed" &&
		(payload.result === null || typeof payload.result === "undefined")
	);
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

function readEventPayload(event: AgentRuntimeEvent): Record<string, unknown> {
	return event.payload && typeof event.payload === "object"
		? (event.payload as Record<string, unknown>)
		: {};
}

function readString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
	try {
		return readRecord(JSON.parse(text));
	} catch {
		return null;
	}
}

function readRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
