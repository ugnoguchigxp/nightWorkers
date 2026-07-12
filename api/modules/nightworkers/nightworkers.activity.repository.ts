import { isJsonRecord, type JsonRecord } from "./nightworkers.json-adapters";
import type { ActivitySource } from "./nightworkers.repository";

export * from "./nightworkers.activity-persistence.repository";

const KNOWN_ACTIVITY_KINDS = new Set([
	"user.message",
	"assistant.delta",
	"assistant.message",
	"assistant.pause",
	"assistant.resume",
	"assistant.raw_output",
	"llm.request",
	"llm.response_delta",
	"llm.response_final",
	"llm.decision_json",
	"llm.schema_result",
	"llm.error",
	"llm.usage",
	"llm.provider_activity",
	"runtime.decision",
	"runtime.state",
	"tool.call",
	"tool.result",
	"tool.error",
	"command.output",
	"file.diff",
	"file.patch",
	"file.write",
	"verification.output",
	"run.status",
	"todo.status",
	"transport.subscribe",
	"transport.replay",
	"transport.publish",
	"ui.optimistic",
	"system.info",
	"system.error",
	"unknown.activity",
]);

export function normalizeActivityKind(kind: string) {
	return KNOWN_ACTIVITY_KINDS.has(kind) ? kind : "unknown.activity";
}

export function taskMessageRoleToActivityKind(role: string) {
	if (role === "user") return "user.message";
	if (role === "assistant") return "assistant.message";
	if (role === "tool") return "tool.result";
	return "system.info";
}

export function getToolDiffActivityKind(payload: unknown) {
	if (!isJsonRecord(payload) || payload.intent !== "tool_diff") return null;
	if (payload.toolName === "apply_patch") return "file.patch";
	if (payload.toolName === "replace_content") return "file.diff";
	return "file.diff";
}

export function taskMessageRoleToActivitySource(role: string): ActivitySource {
	if (role === "user") return "user";
	if (role === "assistant") return "assistant";
	if (role === "tool") return "tool";
	return "system";
}

export function runEventToActivityKind(
	eventType?: string | null,
	legacyType?: string | null,
	agentEventType?: string | null,
) {
	if (agentEventType === "model.response_finished")
		return "assistant.raw_output";
	if (
		agentEventType === "round1.parsed" ||
		agentEventType === "round2.parsed"
	) {
		return "llm.schema_result";
	}
	if (
		agentEventType === "round1.prompt_built" ||
		agentEventType === "round2.prompt_built"
	) {
		return "llm.request";
	}
	if (agentEventType === "procedure.loaded") return "runtime.state";
	if (agentEventType === "tool.validation_failed") return "tool.error";
	if (agentEventType === "run.started" || agentEventType === "run.completed")
		return "run.status";
	if (agentEventType === "run.needs_human" || agentEventType === "run.failed") {
		return agentEventType === "run.failed" ? "system.error" : "run.status";
	}
	if (eventType === "model.response_delta") return "assistant.delta";
	if (eventType === "model.response_finished") return "llm.response_final";
	if (eventType === "model.request_started") return "llm.request";
	if (
		eventType === "model.provider_activity_detected" ||
		eventType === "model.provider_tool_call_detected" ||
		eventType === "model.provider_activity_rejected"
	) {
		return "llm.provider_activity";
	}
	if (eventType === "model.response_parse_failed") return "llm.error";
	if (eventType === "supervisor.decision") return "llm.decision_json";
	if (eventType === "tool.call_started" || eventType === "tool.call_progress")
		return "tool.call";
	if (eventType === "tool.call_finished") return "tool.result";
	if (eventType === "tool.policy_blocked") return "tool.error";
	if (eventType === "git.diff_collected") return "file.diff";
	if (
		eventType === "verification.started" ||
		eventType === "verification.finished"
	) {
		return "verification.output";
	}
	if (eventType?.startsWith("run.") || eventType?.startsWith("turn."))
		return "run.status";
	if (eventType?.startsWith("safety.")) return "runtime.decision";
	if (eventType?.startsWith("system."))
		return eventType === "system.error" ? "system.error" : "system.info";
	if (legacyType === "error") return "system.error";
	if (legacyType === "state_change" || legacyType === "checkpoint")
		return "runtime.state";
	return "unknown.activity";
}

export function schemaFirstAgentEventType(payload: unknown): string | null {
	if (!isJsonRecord(payload)) return null;
	const direct = payload.agentEventType;
	if (typeof direct === "string") return direct;
	const runEvent = isJsonRecord(payload.runEvent) ? payload.runEvent : {};
	const runEventData = isJsonRecord(runEvent.data) ? runEvent.data : {};
	const dataEventType = runEventData.agentEventType;
	if (typeof dataEventType === "string") return dataEventType;
	return null;
}

export function schemaFirstPayload(payload: unknown): JsonRecord {
	if (!isJsonRecord(payload)) return {};
	const runEvent = isJsonRecord(payload.runEvent) ? payload.runEvent : {};
	const runEventData = isJsonRecord(runEvent.data) ? runEvent.data : {};
	const nestedPayload = isJsonRecord(payload.payload)
		? payload.payload
		: isJsonRecord(runEventData.payload)
			? runEventData.payload
			: null;
	return nestedPayload ?? runEventData;
}

export function shouldProjectRunEventToActivity(input: {
	eventType?: string | null;
	agentEventType?: string | null;
}) {
	if (
		input.agentEventType === "round1.prompt_built" ||
		input.agentEventType === "round2.prompt_built" ||
		input.agentEventType === "round1.parsed" ||
		input.agentEventType === "round2.parsed" ||
		input.agentEventType === "procedure.loaded" ||
		input.agentEventType === "model.response_finished" ||
		input.agentEventType === "tool.started" ||
		input.agentEventType === "tool.finished" ||
		input.agentEventType === "tool.failed" ||
		input.agentEventType === "tool.validation_failed" ||
		input.agentEventType === "job.switched"
	) {
		return true;
	}
	return (
		input.eventType === "model.request_started" ||
		input.eventType === "model.response_finished" ||
		input.eventType === "model.response_parse_failed" ||
		input.eventType === "supervisor.decision" ||
		input.eventType === "tool.call_started" ||
		input.eventType === "tool.call_progress" ||
		input.eventType === "tool.call_finished" ||
		input.eventType === "tool.policy_blocked" ||
		input.eventType === "git.diff_collected" ||
		input.eventType === "run.runtime_started" ||
		input.eventType === "run.runtime_finished" ||
		input.eventType === "turn.started" ||
		input.eventType === "turn.finished"
	);
}

export function runEventToActivityText(input: {
	eventType?: string | null;
	agentEventType?: string | null;
	message: string;
	payload: unknown;
}) {
	const payload = schemaFirstPayload(input.payload);
	const inputPayload = isJsonRecord(input.payload) ? input.payload : {};
	const runEvent = isJsonRecord(inputPayload.runEvent)
		? inputPayload.runEvent
		: {};
	const runEventData = isJsonRecord(runEvent.data) ? runEvent.data : {};
	if (input.agentEventType === "model.response_finished") {
		return String(
			inputPayload.rawContent || runEventData.rawContent || input.message || "",
		);
	}
	if (
		input.agentEventType === "round1.parsed" ||
		input.agentEventType === "round2.parsed"
	) {
		return JSON.stringify(payload, null, 2);
	}
	if (
		input.agentEventType === "round1.prompt_built" ||
		input.agentEventType === "round2.prompt_built"
	) {
		return String(payload.systemPrompt || input.message || "");
	}
	if (input.agentEventType === "procedure.loaded") {
		return String(payload.procedurePath || "procedure.loaded");
	}
	if (input.agentEventType === "tool.validation_failed") {
		return String(payload.summary || input.message || "tool validation failed");
	}
	if (input.agentEventType === "tool.started") {
		return `${String(payload.toolName || "tool")} started`;
	}
	if (
		input.agentEventType === "tool.finished" ||
		input.agentEventType === "tool.failed"
	) {
		return String(payload.summary || input.message || input.agentEventType);
	}
	if (
		input.eventType === "tool.call_started" ||
		input.eventType === "tool.call_progress" ||
		input.eventType === "tool.call_finished"
	) {
		return formatToolRunEventActivityText(input.message, payload);
	}
	if (input.eventType === "git.diff_collected") {
		return formatDiffRunEventActivityText(input.message, payload);
	}
	if (input.agentEventType === "job.switched") {
		return `jobType -> ${String(payload.nextJobType || "")}`;
	}
	if (input.agentEventType === "finalize.received") {
		return String(payload.message || input.message || "");
	}
	if (input.agentEventType?.startsWith("run.")) {
		return String(
			payload.finalReport ||
				payload.reason ||
				payload.error ||
				input.message ||
				input.agentEventType,
		);
	}
	return input.message;
}

function formatToolRunEventActivityText(message: string, payload: JsonRecord) {
	const toolName = String(payload.toolName || "tool");
	const command = typeof payload.command === "string" ? payload.command : "";
	const status = typeof payload.status === "string" ? payload.status : "";
	const argumentsPreview = previewToolArguments(payload.arguments);
	const error = typeof payload.error === "string" ? payload.error.trim() : "";
	const resultPreview = previewToolResult(payload.result);
	const exitCode =
		typeof payload.exitCode === "number" || payload.exitCode === null
			? `exit=${payload.exitCode ?? "pending"}`
			: "";
	const output =
		typeof payload.aggregatedOutput === "string"
			? payload.aggregatedOutput.trim()
			: "";
	const header = [toolName, command, status, exitCode]
		.filter(Boolean)
		.join(" | ");
	const details = [
		argumentsPreview,
		error ? `error: ${error}` : "",
		resultPreview,
	].filter(Boolean);
	if (output || details.length > 0) {
		return [header || message, ...details, output].filter(Boolean).join("\n");
	}
	return header || message;
}

function previewToolArguments(value: unknown) {
	if (!value || typeof value !== "object") return "";
	const record = value as JsonRecord;
	if (
		typeof record.runId === "string" &&
		typeof record.operation === "string" &&
		(typeof record.seq === "number" ||
			typeof record.todoId === "string" ||
			typeof record.title === "string")
	) {
		const parts = [
			`runId=${record.runId}`,
			`operation=${String(record.operation)}`,
			typeof record.seq === "number" ? `seq=${record.seq}` : "",
			typeof record.todoId === "string" ? `todoId=${record.todoId}` : "",
			typeof record.title === "string" ? `title=${record.title}` : "",
			typeof record.status === "string" ? `status=${record.status}` : "",
			typeof record.autoStartNext === "boolean"
				? `autoStartNext=${record.autoStartNext}`
				: "",
		].filter(Boolean);
		return parts.length > 0 ? `args: ${parts.join(" ")}` : "";
	}
	return `args: ${stringifyPreview(value, 280)}`;
}

function previewToolResult(value: unknown) {
	if (!value || typeof value !== "object") return "";
	const preview = stringifyPreview(value, 320);
	return preview ? `result: ${preview}` : "";
}

function stringifyPreview(value: unknown, limit: number) {
	try {
		const text = JSON.stringify(value);
		if (!text) return "";
		return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
	} catch {
		return "";
	}
}

function formatDiffRunEventActivityText(message: string, payload: JsonRecord) {
	const changedFiles = Array.isArray(payload.changedFiles)
		? payload.changedFiles.filter(
				(file: unknown): file is string => typeof file === "string",
			)
		: [];
	if (!changedFiles.length) return message;
	return [`Changed files (${changedFiles.length})`, ...changedFiles].join("\n");
}

export function runEventToActivityStatus(input: {
	eventType?: string | null;
	legacyType?: string | null;
	agentEventType?: string | null;
}) {
	if (input.agentEventType?.endsWith(".started")) return "started";
	if (input.agentEventType?.endsWith(".failed")) return "failed";
	if (
		input.agentEventType === "round1.invalid" ||
		input.agentEventType === "round2.invalid"
	) {
		return "failed";
	}
	if (input.agentEventType === "tool.validation_failed") return "failed";
	if (input.eventType === "model.response_delta") return "delta";
	if (input.legacyType === "error") return "failed";
	return "completed";
}

export function runEventToActivityTurnId(input: {
	runId: string;
	eventType?: string | null;
	agentEventType?: string | null;
}) {
	if (input.agentEventType) return `assistant:${input.runId}`;
	if (
		input.eventType === "model.response_delta" ||
		input.eventType === "model.response_finished"
	) {
		return `assistant:${input.runId}`;
	}
	return undefined;
}
