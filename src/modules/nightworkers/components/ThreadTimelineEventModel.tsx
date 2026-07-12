import type { ReactNode } from "react";
import type { TranscriptItem } from "../activityTranscript";
import type { ActivityEvent, TaskEvent, TaskMessage, TaskRun } from "../types";
import { schemaFirstAgentEventType } from "./ThreadTimelineActivityTranscript";
import { asNumber, asString } from "./ThreadTimelineDiffModel";
import { RuntimePromptSnapshotCard } from "./ThreadTimelineStreaming";
import { sanitizeTerminalText } from "./terminalText";

export function TimelineDebugFragment({
	children,
	insertRuntimeSnapshot,
	latestRun,
}: {
	children: ReactNode;
	insertRuntimeSnapshot: boolean;
	latestRun?: TaskRun;
}) {
	return (
		<>
			{children}
			{insertRuntimeSnapshot ? (
				<RuntimePromptSnapshotCard latestRun={latestRun} />
			) : null}
		</>
	);
}

export function findRuntimePromptSnapshotTranscriptAnchorId(
	items: TranscriptItem[],
	latestRun?: TaskRun,
) {
	if (!latestRun?.contextSnapshot) return null;
	const item = items.find((candidate) =>
		transcriptItemEvents(candidate).some((event) =>
			isRuntimePromptSnapshotAnchorEvent(event, latestRun),
		),
	);
	return item?.id ?? null;
}

export function findRuntimePromptSnapshotTimelineAnchorId(
	items: Array<
		| { kind: "message"; id: string; ts: number; message: TaskMessage }
		| { kind: "event"; id: string; ts: number; event: TaskEvent }
	>,
	latestRun?: TaskRun,
) {
	if (!latestRun?.contextSnapshot) return null;
	const item = items.find(
		(candidate) =>
			candidate.kind === "event" &&
			isRuntimePromptSnapshotAnchorTaskEvent(candidate.event, latestRun),
	);
	return item?.id ?? null;
}

export function transcriptItemEvents(item: TranscriptItem): ActivityEvent[] {
	if (item.kind === "user_turn" || item.kind === "assistant_turn")
		return item.events;
	if (item.kind === "activity" || item.kind === "unknown") return [item.event];
	return [];
}

export function isRuntimePromptSnapshotAnchorEvent(
	event: ActivityEvent,
	latestRun: TaskRun,
) {
	return (
		event.runId === latestRun.id &&
		schemaFirstAgentEventType(event) === "run.started"
	);
}

export function isRuntimePromptSnapshotAnchorTaskEvent(
	event: TaskEvent,
	latestRun: TaskRun,
) {
	const agentEventType =
		typeof event.payloadJson?.agentEventType === "string"
			? event.payloadJson.agentEventType
			: typeof event.payloadJson?.runEvent?.data?.agentEventType === "string"
				? event.payloadJson.runEvent.data.agentEventType
				: "";
	const runId =
		event.runId || event.taskRunId || event.payloadJson?.runEvent?.runId;
	return runId === latestRun.id && agentEventType === "run.started";
}

export function getApplyPatchContent(payload: unknown): string | null {
	return firstString(
		nestedValue(payload, ["arguments", "patchContent"]),
		nestedValue(payload, ["args", "patchContent"]),
		nestedValue(payload, ["toolCall", "arguments", "patchContent"]),
		nestedValue(payload, ["decision", "toolCall", "arguments", "patchContent"]),
		nestedValue(payload, ["runEvent", "data", "arguments", "patchContent"]),
		nestedValue(payload, [
			"runEvent",
			"data",
			"toolCall",
			"arguments",
			"patchContent",
		]),
	);
}

export type ToolActivityLifecycle =
	| "started"
	| "progress"
	| "result"
	| "failed"
	| "other";

export type ToolActivityModel = {
	toolName: string;
	lifecycle: ToolActivityLifecycle;
	callId?: string;
	status: "started" | "running" | "ok" | "failed";
	arguments: Record<string, unknown>;
	resultPayload: Record<string, unknown>;
	rawResult: Record<string, unknown>;
	error: Record<string, unknown>;
	eventSeq?: number;
};

type ToolActivityEventLike = {
	kind?: string;
	eventType?: string | null;
	payloadJson?: unknown;
	seq?: number;
	status?: string | null;
};

export function getToolActivityModel(input: unknown): ToolActivityModel | null {
	const event = asRecord(input);
	const payload = Object.hasOwn(event, "payloadJson")
		? asRecord((input as ToolActivityEventLike).payloadJson)
		: asRecord(input);
	const runEvent = asRecord(payload.runEvent);
	const runEventData = asRecord(runEvent.data);
	const payloadPayload = asRecord(payload.payload);
	const toolCall = asRecord(payload.toolCall);
	const payloadToolCall = asRecord(payloadPayload.toolCall);
	const runEventToolCall = asRecord(runEventData.toolCall);
	const decision = asRecord(payload.decision);
	const decisionToolCall = asRecord(decision.toolCall);
	const rawResult = normalizeToolRawResult(
		payload,
		payloadPayload,
		runEventData,
	);
	const toolName = firstString(
		payload.toolName,
		toolCall.name,
		decisionToolCall.name,
		payloadPayload.toolName,
		payloadToolCall.name,
		runEventData.toolName,
		runEventToolCall.name,
		nestedValue(runEventData, ["result", "toolName"]),
		rawResult.toolName,
	);
	if (!toolName) return null;

	const args = firstRecord(
		payload.arguments,
		payload.args,
		toolCall.arguments,
		decisionToolCall.arguments,
		payloadPayload.arguments,
		payloadPayload.args,
		payloadToolCall.arguments,
		runEventData.arguments,
		runEventToolCall.arguments,
		runEventData.toolArgs,
	);
	const error = firstRecord(
		payload.error,
		payloadPayload.error,
		runEventData.error,
		rawResult.error,
	);
	const resultPayload = normalizeToolResultPayload(
		rawResult,
		payload,
		payloadPayload,
		runEventData,
	);
	const lifecycle = inferToolActivityLifecycle({
		kind: asString(event.kind),
		eventType: asString(event.eventType),
		eventStatus: asString(event.status),
		runEventType: asString(runEvent.type),
		ok: firstBoolean(
			payload.ok,
			payloadPayload.ok,
			runEventData.ok,
			rawResult.ok,
		),
		hasError: Object.keys(error).length > 0,
	});
	const status = inferToolActivityStatus(lifecycle);
	const callId = firstString(
		payload.callId,
		payloadPayload.callId,
		runEventData.callId,
	);
	const seq =
		asNumber(event.seq) ??
		asNumber(payload.seq) ??
		asNumber(runEvent.seq) ??
		asNumber(runEventData.seq);

	return {
		toolName,
		lifecycle,
		...(callId ? { callId } : {}),
		status,
		arguments: args,
		resultPayload,
		rawResult,
		error,
		...(seq === undefined ? {} : { eventSeq: seq }),
	};
}

export function getToolName(payload: unknown): string | null {
	const activity = getToolActivityModel(payload);
	if (activity) return activity.toolName;
	return firstString(
		nestedValue(payload, ["toolName"]),
		nestedValue(payload, ["toolCall", "name"]),
		nestedValue(payload, ["decision", "toolCall", "name"]),
		nestedValue(payload, ["runEvent", "data", "toolName"]),
		nestedValue(payload, ["runEvent", "data", "result", "toolName"]),
		nestedValue(payload, ["result", "toolName"]),
		nestedValue(payload, ["payload", "toolName"]),
	);
}

export function getToolArguments(payload: unknown): unknown {
	const activity = getToolActivityModel(payload);
	if (activity && Object.keys(activity.arguments).length > 0)
		return activity.arguments;
	return firstDefined(
		nestedValue(payload, ["arguments"]),
		nestedValue(payload, ["args"]),
		nestedValue(payload, ["toolCall", "arguments"]),
		nestedValue(payload, ["decision", "toolCall", "arguments"]),
		nestedValue(payload, ["payload", "arguments"]),
		nestedValue(payload, ["runEvent", "data", "arguments"]),
		nestedValue(payload, ["runEvent", "data", "toolCall", "arguments"]),
		nestedValue(payload, ["runEvent", "data", "toolArgs"]),
	);
}

export function getToolResult(payload: unknown): unknown {
	const activity = getToolActivityModel(payload);
	if (
		activity &&
		(Object.keys(activity.rawResult).length > 0 ||
			Object.keys(activity.resultPayload).length > 0)
	) {
		return Object.keys(activity.rawResult).length > 0
			? activity.rawResult
			: { payload: activity.resultPayload };
	}
	const directResult = nestedValue(payload, ["result"]);
	if (directResult) return directResult;
	const runResult = nestedValue(payload, ["runEvent", "data", "result"]);
	if (runResult) return runResult;
	const runToolResult = nestedValue(payload, [
		"runEvent",
		"data",
		"toolResult",
	]);
	if (runToolResult) return runToolResult;
	const record = asRecord(payload);
	const nestedPayload = asRecord(record.payload);
	if (typeof nestedPayload.ok === "boolean" && nestedPayload.payload)
		return nestedPayload;
	if (typeof record.ok === "boolean" && record.payload) return record;
	return null;
}

export function getChangedFilesFromResult(result: unknown): string[] {
	return normalizeStringArray(
		firstDefined(
			nestedValue(result, ["payload", "changedFiles"]),
			nestedValue(result, ["changedFiles"]),
		),
	);
}

export function formatCodexToolActivitySummary(event: ActivityEvent): string {
	const data = codexActivityData(event.payloadJson);
	const toolName = asString(data.toolName) || event.kind;
	const command = asString(data.command);
	const status = asString(data.status) || event.status || "";
	const exitCode =
		typeof data.exitCode === "number" || data.exitCode === null
			? `exit=${data.exitCode ?? "pending"}`
			: "";
	const output = getCodexCommandOutput(event);
	const header = [toolName, command, status, exitCode]
		.filter(Boolean)
		.join(" | ");
	return output
		? [header || event.text || toolName, output].join("\n")
		: header || event.text || toolName;
}

export function getCodexCommandOutput(event: ActivityEvent): string {
	const data = codexActivityData(event.payloadJson);
	return sanitizeTerminalText(asString(data.aggregatedOutput)).trim();
}

export function getActivityDiffPayload(
	event: ActivityEvent | TaskEvent,
): string {
	const payload = asRecord(event.payloadJson);
	const data = codexActivityData(event.payloadJson);
	return asString(
		firstDefined(
			data.diff,
			payload.code,
			nestedValue(payload, ["payload", "diff"]),
			nestedValue(payload, ["runEvent", "data", "diff"]),
		),
	);
}

export function isChangedFilesOnlyDiffActivity(
	event: ActivityEvent | TaskEvent,
): boolean {
	const eventKind = "kind" in event ? event.kind : "";
	return (
		eventKind === "file.diff" &&
		getActivityDiffPayload(event).trim().length === 0 &&
		getActivityChangedFiles(event).length > 0
	);
}

export function getActivityChangedFiles(
	event: ActivityEvent | TaskEvent,
): string[] {
	const activity = getToolActivityModel(event);
	const activityFiles = normalizeStringArray(
		activity?.resultPayload.changedFiles,
	);
	if (activityFiles.length > 0) return activityFiles;

	const data = codexActivityData(event.payloadJson);
	if (Array.isArray(data.changedFiles)) {
		return data.changedFiles.filter(
			(file: unknown): file is string => typeof file === "string",
		);
	}
	const result = asRecord(data.result);
	const resultPayload = asRecord(result.payload);
	const resultFiles = resultPayload.changedFiles;
	if (Array.isArray(resultFiles)) {
		return resultFiles.filter(
			(file: unknown): file is string => typeof file === "string",
		);
	}
	return [];
}

export function normalizeToolRawResult(
	payload: Record<string, unknown>,
	payloadPayload: Record<string, unknown>,
	runEventData: Record<string, unknown>,
): Record<string, unknown> {
	return firstRecord(
		payload.result,
		payloadPayload.result,
		runEventData.result,
		runEventData.toolResult,
	);
}

export function normalizeToolResultPayload(
	rawResult: Record<string, unknown>,
	payload: Record<string, unknown>,
	payloadPayload: Record<string, unknown>,
	runEventData: Record<string, unknown>,
): Record<string, unknown> {
	const rawPayload = asRecord(rawResult.payload);
	if (Object.keys(rawPayload).length > 0) return rawPayload;

	const nestedRawResult = asRecord(rawResult.result);
	const nestedRawPayload = asRecord(nestedRawResult.payload);
	if (Object.keys(nestedRawPayload).length > 0) return nestedRawPayload;
	if (Object.keys(nestedRawResult).length > 0) return nestedRawResult;

	const directPayload = asRecord(payload.payload);
	if (
		typeof payload.ok === "boolean" &&
		Object.keys(directPayload).length > 0
	) {
		return directPayload;
	}
	if (typeof directPayload.ok === "boolean") {
		const directWorkerPayload = asRecord(directPayload.payload);
		if (Object.keys(directWorkerPayload).length > 0) return directWorkerPayload;
	}

	const runPayload = asRecord(runEventData.payload);
	if (Object.keys(runPayload).length > 0) return runPayload;
	if (Object.keys(rawResult).length > 0) return rawResult;

	const payloadResult = asRecord(payload.result);
	if (Object.keys(payloadResult).length > 0) return payloadResult;
	const nestedPayloadResult = asRecord(payloadPayload.result);
	if (Object.keys(nestedPayloadResult).length > 0) return nestedPayloadResult;
	return {};
}

export function inferToolActivityLifecycle(input: {
	kind: string;
	eventType: string;
	eventStatus: string;
	runEventType: string;
	ok?: boolean;
	hasError: boolean;
}): ToolActivityLifecycle {
	if (
		input.eventStatus === "failed" ||
		input.eventType === "tool_failed" ||
		input.ok === false
	) {
		return "failed";
	}
	if (input.hasError && input.runEventType === "tool.call_finished")
		return "failed";
	if (
		input.runEventType === "tool.call_finished" ||
		input.kind === "tool.result"
	)
		return "result";
	if (input.eventType === "tool_result") return "result";
	if (input.runEventType === "tool.call_progress") return "progress";
	if (
		input.runEventType === "tool.call_started" ||
		input.kind === "tool.call" ||
		input.eventType === "tool_call"
	) {
		return "started";
	}
	return "other";
}

export function inferToolActivityStatus(
	lifecycle: ToolActivityLifecycle,
): ToolActivityModel["status"] {
	if (lifecycle === "failed") return "failed";
	if (lifecycle === "started") return "started";
	if (lifecycle === "progress") return "running";
	return "ok";
}

export function codexActivityData(
	payloadJson: unknown,
): Record<string, unknown> {
	const payload = asRecord(payloadJson);
	if (isRecord(payload.payload)) return payload.payload;
	const runEvent = asRecord(payload.runEvent);
	if (isRecord(runEvent.data)) return runEvent.data;
	return payload;
}

export function firstString(...values: unknown[]) {
	const found = values.find(
		(value) => typeof value === "string" && value.length > 0,
	);
	return typeof found === "string" ? found : null;
}

export function firstDefined(...values: unknown[]) {
	return values.find((value) => value !== undefined && value !== null) ?? null;
}

export function firstBoolean(...values: unknown[]): boolean | undefined {
	const found = values.find((value) => typeof value === "boolean");
	return typeof found === "boolean" ? found : undefined;
}

export function firstRecord(...values: unknown[]): Record<string, unknown> {
	const found = values.find(isRecord);
	return found ? { ...found } : {};
}

export function normalizeStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((file): file is string => typeof file === "string")
		: [];
}

export function nestedValue(value: unknown, path: string[]): unknown {
	let current: unknown = value;
	for (const key of path) {
		const record = asRecord(current);
		if (!record) return undefined;
		current = record[key];
	}
	return current;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function asRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

export function transcriptItemTimestamp(item: TranscriptItem): number {
	if (item.kind === "user_turn" || item.kind === "assistant_turn") {
		return toMs(item.events[0]?.createdAt);
	}
	return toMs(item.event.createdAt);
}

export function toMs(value: unknown): number {
	if (!value) return Number.MAX_SAFE_INTEGER;
	const n = Date.parse(String(value));
	return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}
