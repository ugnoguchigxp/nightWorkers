import { type ReactNode, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { CodeBlockData } from "@/components/ui/CodeBlock";
import {
	buildTranscriptItems,
	type TranscriptItem,
} from "../activityTranscript";
import { measureArtifactPerf } from "../artifactPerformance";
import { isUserVisibleChatMessage } from "../messageVisibility";
import type {
	ActivityArtifact,
	ActivityEvent,
	Task,
	TaskEvent,
	TaskMessage,
	TaskRun,
	WorkbenchArtifactRef,
} from "../types";
import { formatFinishedTime } from "../utils/time";
import { ThreadMessage } from "./ThreadMessage";
import {
	schemaFirstAgentEventType,
	TranscriptItemView,
} from "./ThreadTimelineActivityTranscript";
import {
	AgentDebugEventCard,
	AgentEditSummaryCard,
	hasAgentEditSummary,
	isReviewerEvaluationEvent,
	ReviewerEvaluationCard,
} from "./ThreadTimelineAgentCards";
import {
	CodexToolCard,
	hasCodexToolCard,
	NormalCodexToolCard,
} from "./ThreadTimelineCodexToolCard";
import {
	hasContextStillToolCard,
	NormalContextStillToolCard,
} from "./ThreadTimelineContextStillCards";
import {
	hasImportProjectToolCard,
	NormalImportProjectToolCard,
} from "./ThreadTimelineImportProjectCard";
import {
	hasInspectionToolCard,
	NormalInspectionToolCard,
} from "./ThreadTimelineInspectionToolCard";
import { MessagePayload } from "./ThreadTimelineMessagePayload";
import {
	buildNormalTranscriptItems,
	NormalTranscriptItemView,
} from "./ThreadTimelineNormalTranscript";
import {
	buildPersistedStreamingResponsePreview,
	buildStreamingResponsePreview,
	FinalReportCard,
	PersistedStreamingResponse,
	RuntimePromptSnapshotCard,
	StreamingResponsePreview,
	ThinkingIndicator,
} from "./ThreadTimelineStreaming";
import { sanitizeTerminalText } from "./terminalText";

export { isUserVisibleChatMessage } from "../messageVisibility";
export {
	findArtifactTaskMessage,
	getActivityCode,
	parseDiffMetadata,
} from "./ThreadTimelineActivityTranscript";
export {
	buildNormalTranscriptItems,
	buildVisibleEditDiffSummary,
} from "./ThreadTimelineNormalTranscript";
export {
	buildPersistedStreamingResponsePreview,
	buildStreamingResponsePreview,
	formatVisibleAssistantText,
} from "./ThreadTimelineStreaming";

type ThreadTimelineProps = {
	session: Task;
	runs: TaskRun[];
	latestRun?: TaskRun;
	taskMessages: TaskMessage[];
	latestRunEvents: TaskEvent[];
	activityEvents: ActivityEvent[];
	activityArtifacts: ActivityArtifact[];
	activeStreamingResponse: string;
	isAgentWorking: boolean;
	showDebugEvents: boolean;
	onOpenArtifact: (artifact: WorkbenchArtifactRef) => void;
	onOpenProjectFile?: (path: string) => void;
	onOpenTestModeArtifact?: () => void;
	onOpenReviewModeArtifact?: () => void;
	onGrantExternalPath?: (path: string) => Promise<void>;
};

function findExternalPathPermissionRequest(events: TaskEvent[]): string | null {
	for (const event of [...events].reverse()) {
		const payload = asRecord(event.payloadJson);
		if (payload.agentEventType !== "run.needs_human") continue;
		const data = asRecord(payload.payload);
		if (data.reason !== "path_access_denied") continue;
		const args = asRecord(data.arguments);
		const candidate =
			typeof args.sourcePath === "string"
				? args.sourcePath
				: typeof args.filePath === "string"
					? args.filePath
					: typeof args.relativePath === "string"
						? args.relativePath
						: null;
		if (candidate && (candidate.startsWith("/") || candidate.startsWith("..")))
			return candidate;
	}
	return null;
}

export function ThreadTimeline({
	latestRun,
	taskMessages,
	latestRunEvents,
	activityEvents,
	activityArtifacts,
	activeStreamingResponse,
	isAgentWorking,
	showDebugEvents,
	onOpenArtifact,
	onOpenProjectFile,
	onOpenTestModeArtifact,
	onOpenReviewModeArtifact,
	onGrantExternalPath,
}: ThreadTimelineProps) {
	const [isGrantingExternalPath, setIsGrantingExternalPath] = useState(false);
	const [dismissedPermissionPath, setDismissedPermissionPath] = useState<
		string | null
	>(null);
	const [grantExternalPathError, setGrantExternalPathError] = useState<
		string | null
	>(null);
	const transcriptItems = useMemo(
		() =>
			measureArtifactPerf(
				"threadTimeline.buildTranscriptItems",
				() =>
					buildTranscriptItems({
						events: activityEvents,
						artifacts: activityArtifacts,
					}),
				{
					activityEventCount: activityEvents.length,
					activityArtifactCount: activityArtifacts.length,
				},
			),
		[activityArtifacts, activityEvents],
	);
	const visibleTranscriptItems = useMemo(
		() =>
			showDebugEvents
				? transcriptItems
				: measureArtifactPerf(
						"threadTimeline.buildNormalTranscriptItems",
						() => buildNormalTranscriptItems(transcriptItems),
						{ transcriptItemCount: transcriptItems.length },
					),
		[showDebugEvents, transcriptItems],
	);
	const hasActivityTranscript = transcriptItems.length > 0;
	const chatMessages = useMemo(
		() => taskMessages.filter(isUserVisibleChatMessage),
		[taskMessages],
	);
	const timelineItems = useMemo(
		() =>
			measureArtifactPerf(
				"threadTimeline.buildTimelineItems",
				() =>
					[
						...chatMessages.map((message) => ({
							kind: "message" as const,
							id: `msg-${message.id}`,
							ts: toMs(message.createdAt),
							message,
						})),
						...latestRunEvents.map((event) => ({
							kind: "event" as const,
							id: `evt-${event.id}`,
							ts: toMs(event.timestamp || event.createdAt),
							event,
						})),
					].sort((a, b) => a.ts - b.ts),
				{
					chatMessageCount: chatMessages.length,
					latestRunEventCount: latestRunEvents.length,
				},
			),
		[chatMessages, latestRunEvents],
	);

	const latestEvent = latestRunEvents[latestRunEvents.length - 1];
	const streamingPreview = useMemo(
		() =>
			isAgentWorking
				? measureArtifactPerf(
						"threadTimeline.buildStreamingResponsePreview",
						() =>
							buildStreamingResponsePreview({
								events: latestRunEvents,
								activeStreamingResponse,
							}),
						{
							latestRunEventCount: latestRunEvents.length,
							streamingLength: activeStreamingResponse.length,
						},
					)
				: null,
		[activeStreamingResponse, isAgentWorking, latestRunEvents],
	);
	const persistedStreamingPreview = useMemo(
		() =>
			!isAgentWorking
				? measureArtifactPerf(
						"threadTimeline.buildPersistedStreamingResponsePreview",
						() =>
							buildPersistedStreamingResponsePreview({
								events: latestRunEvents,
								taskMessages,
								runId: latestRun?.id,
							}),
						{
							latestRunEventCount: latestRunEvents.length,
							taskMessageCount: taskMessages.length,
						},
					)
				: null,
		[isAgentWorking, latestRun?.id, latestRunEvents, taskMessages],
	);
	const runtimeSnapshotTranscriptAnchorId =
		showDebugEvents && hasActivityTranscript
			? findRuntimePromptSnapshotTranscriptAnchorId(
					visibleTranscriptItems,
					latestRun,
				)
			: null;
	const runtimeSnapshotTimelineAnchorId =
		showDebugEvents && !hasActivityTranscript
			? findRuntimePromptSnapshotTimelineAnchorId(timelineItems, latestRun)
			: null;
	const shouldRenderTrailingRuntimeSnapshot =
		showDebugEvents &&
		Boolean(latestRun?.contextSnapshot) &&
		!runtimeSnapshotTranscriptAnchorId &&
		!runtimeSnapshotTimelineAnchorId;
	const permissionPath = findExternalPathPermissionRequest(latestRunEvents);
	const showPermissionDialog =
		Boolean(permissionPath) &&
		permissionPath !== dismissedPermissionPath &&
		Boolean(onGrantExternalPath);

	return (
		<div className="nightworkers-chat-window space-y-5 p-6">
			{showPermissionDialog && permissionPath ? (
				<ThreadMessage messageRole="assistant">
					<div className="max-w-2xl rounded-lg border border-slate-700 bg-slate-950/80 p-4">
						<div className="text-sm font-semibold text-slate-100">
							外部フォルダへのアクセス許可
						</div>
						<div className="mt-2 text-xs leading-5 text-slate-300">
							続行するには、このフォルダの読み取り許可が必要です。
						</div>
						<div className="mt-3 break-all rounded-md border border-slate-800 bg-slate-900 px-3 py-2 font-mono text-[11px] text-slate-200">
							{permissionPath}
						</div>
						<div className="mt-4 flex justify-end gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => setDismissedPermissionPath(permissionPath)}
							>
								閉じる
							</Button>
							<Button
								type="button"
								size="sm"
								disabled={isGrantingExternalPath}
								onClick={async () => {
									if (!onGrantExternalPath) return;
									setIsGrantingExternalPath(true);
									setGrantExternalPathError(null);
									try {
										await onGrantExternalPath(permissionPath);
										setDismissedPermissionPath(permissionPath);
									} catch (error) {
										setGrantExternalPathError(
											error instanceof Error
												? error.message
												: "外部フォルダの許可に失敗しました。",
										);
									} finally {
										setIsGrantingExternalPath(false);
									}
								}}
							>
								フォルダを許可
							</Button>
						</div>
						{grantExternalPathError ? (
							<div className="mt-3 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-200">
								{grantExternalPathError}
							</div>
						) : null}
					</div>
				</ThreadMessage>
			) : null}
			{showDebugEvents && isAgentWorking && latestEvent ? (
				<div className="rounded-lg border border-slate-700/80 bg-slate-900/50 px-3 py-2 text-xs text-slate-200">
					<span className="mr-2 inline-flex h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
					Live: {latestEvent.message}
				</div>
			) : null}
			{hasActivityTranscript
				? visibleTranscriptItems.map((item) =>
						showDebugEvents ? (
							<TimelineDebugFragment
								key={item.id}
								insertRuntimeSnapshot={
									item.id === runtimeSnapshotTranscriptAnchorId
								}
								latestRun={latestRun}
							>
								<TranscriptItemView
									item={item}
									onOpenArtifact={onOpenArtifact}
									onOpenProjectFile={onOpenProjectFile}
									onOpenTestModeArtifact={onOpenTestModeArtifact}
								/>
							</TimelineDebugFragment>
						) : (
							<NormalTranscriptItemView
								key={item.id}
								item={item}
								onOpenArtifact={onOpenArtifact}
								onOpenProjectFile={onOpenProjectFile}
								onOpenTestModeArtifact={onOpenTestModeArtifact}
							/>
						),
					)
				: timelineItems.map((item) =>
						item.kind === "message" ? (
							<ThreadMessage
								key={item.id}
								messageRole={
									item.message.role === "assistant"
										? "assistant"
										: item.message.role === "user"
											? "user"
											: "system"
								}
								timestamp={formatFinishedTime(item.message.createdAt)}
							>
								<MessagePayload
									message={item.message}
									onOpenArtifact={onOpenArtifact}
									onOpenProjectFile={onOpenProjectFile}
									onOpenTestModeArtifact={onOpenTestModeArtifact}
								/>
							</ThreadMessage>
						) : (showDebugEvents &&
								!isChangedFilesOnlyDiffActivity(item.event)) ||
							hasAgentEditSummary(item.event) ||
							isReviewerEvaluationEvent(item.event) ||
							hasContextStillToolCard(item.event) ||
							hasImportProjectToolCard(item.event) ||
							hasInspectionToolCard(item.event) ||
							hasCodexToolCard(item.event) ? (
							<TimelineDebugFragment
								key={item.id}
								insertRuntimeSnapshot={
									item.id === runtimeSnapshotTimelineAnchorId
								}
								latestRun={latestRun}
							>
								{!showDebugEvents && hasAgentEditSummary(item.event) ? (
									<ThreadMessage
										messageRole="assistant"
										timestamp={formatFinishedTime(
											item.event.timestamp || item.event.createdAt,
										)}
									>
										<div className="space-y-2">
											<AgentEditSummaryCard event={item.event} />
										</div>
									</ThreadMessage>
								) : (
									<div className="space-y-2">
										<ReviewerEvaluationCard event={item.event} />
										<AgentEditSummaryCard event={item.event} />
										{!showDebugEvents ? (
											<NormalContextStillToolCard event={item.event} />
										) : null}
										{!showDebugEvents ? (
											<NormalImportProjectToolCard event={item.event} />
										) : null}
										{!showDebugEvents ? (
											<NormalInspectionToolCard event={item.event} />
										) : null}
										{!showDebugEvents ? (
											<NormalCodexToolCard event={item.event} />
										) : null}
										{showDebugEvents ? (
											<CodexToolCard event={item.event} />
										) : null}
										{showDebugEvents ? (
											<AgentDebugEventCard event={item.event} />
										) : null}
									</div>
								)}
							</TimelineDebugFragment>
						) : null,
					)}
			{shouldRenderTrailingRuntimeSnapshot ? (
				<RuntimePromptSnapshotCard latestRun={latestRun} />
			) : null}
			{!hasActivityTranscript && streamingPreview ? (
				<ThreadMessage messageRole="assistant">
					<StreamingResponsePreview
						preview={streamingPreview}
						onOpenProjectFile={onOpenProjectFile}
						onOpenTestModeArtifact={onOpenTestModeArtifact}
					/>
				</ThreadMessage>
			) : null}
			{!hasActivityTranscript && persistedStreamingPreview ? (
				<ThreadMessage messageRole="assistant">
					<PersistedStreamingResponse
						preview={persistedStreamingPreview}
						onOpenProjectFile={onOpenProjectFile}
						onOpenTestModeArtifact={onOpenTestModeArtifact}
					/>
				</ThreadMessage>
			) : null}
			{isAgentWorking ? (
				<ThreadMessage messageRole="assistant">
					<ThinkingIndicator />
				</ThreadMessage>
			) : null}
			{!hasActivityTranscript ? (
				<FinalReportCard
					latestRun={latestRun}
					onOpenProjectFile={onOpenProjectFile}
					onOpenTestModeArtifact={onOpenTestModeArtifact}
					onOpenReviewModeArtifact={onOpenReviewModeArtifact}
				/>
			) : null}
		</div>
	);
}

function TimelineDebugFragment({
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

function findRuntimePromptSnapshotTimelineAnchorId(
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

function transcriptItemEvents(item: TranscriptItem): ActivityEvent[] {
	if (item.kind === "user_turn" || item.kind === "assistant_turn")
		return item.events;
	if (item.kind === "activity" || item.kind === "unknown") return [item.event];
	return [];
}

function isRuntimePromptSnapshotAnchorEvent(
	event: ActivityEvent,
	latestRun: TaskRun,
) {
	return (
		event.runId === latestRun.id &&
		schemaFirstAgentEventType(event) === "run.started"
	);
}

function isRuntimePromptSnapshotAnchorTaskEvent(
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

function normalizeToolRawResult(
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

function normalizeToolResultPayload(
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

function inferToolActivityLifecycle(input: {
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

function inferToolActivityStatus(
	lifecycle: ToolActivityLifecycle,
): ToolActivityModel["status"] {
	if (lifecycle === "failed") return "failed";
	if (lifecycle === "started") return "started";
	if (lifecycle === "progress") return "running";
	return "ok";
}

function codexActivityData(payloadJson: unknown): Record<string, unknown> {
	const payload = asRecord(payloadJson);
	if (isRecord(payload.payload)) return payload.payload;
	const runEvent = asRecord(payload.runEvent);
	if (isRecord(runEvent.data)) return runEvent.data;
	return payload;
}

function firstString(...values: unknown[]) {
	const found = values.find(
		(value) => typeof value === "string" && value.length > 0,
	);
	return typeof found === "string" ? found : null;
}

function firstDefined(...values: unknown[]) {
	return values.find((value) => value !== undefined && value !== null) ?? null;
}

function firstBoolean(...values: unknown[]): boolean | undefined {
	const found = values.find((value) => typeof value === "boolean");
	return typeof found === "boolean" ? found : undefined;
}

function firstRecord(...values: unknown[]): Record<string, unknown> {
	const found = values.find(isRecord);
	return found ? { ...found } : {};
}

function normalizeStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((file): file is string => typeof file === "string")
		: [];
}

function nestedValue(value: unknown, path: string[]): unknown {
	let current: unknown = value;
	for (const key of path) {
		const record = asRecord(current);
		if (!record) return undefined;
		current = record[key];
	}
	return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function asRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

export function buildApplyPatchCodeBlockData(
	patchContent: string,
): CodeBlockData[] {
	return [
		{
			code: patchContent.trimEnd() || "No patch",
			filename: "apply_patch.patch",
			language: "diff",
		},
	];
}

export function buildReplaceContentCodeBlockData(input: {
	filePath: string;
	needle: string;
	replacement: string;
	occurrences?: number;
}): CodeBlockData[] | undefined {
	if (!input.needle && !input.replacement) return undefined;
	const occurrenceLabel =
		typeof input.occurrences === "number"
			? `# occurrences: ${input.occurrences}`
			: "# replacement requested";
	return [
		{
			code: [
				`--- ${input.filePath}`,
				`+++ ${input.filePath}`,
				occurrenceLabel,
				input.needle ? `- ${input.needle}` : "",
				input.replacement ? `+ ${input.replacement}` : "",
			]
				.filter(Boolean)
				.join("\n"),
			filename: `${input.filePath}.replace.diff`,
			language: "diff",
		},
	];
}

export function estimateReplacementStats(input: {
	needle: string;
	replacement: string;
	occurrences?: number;
}): { added: number; deleted: number } | null {
	if (!input.needle && !input.replacement) return null;
	const occurrences =
		typeof input.occurrences === "number" && input.occurrences > 0
			? input.occurrences
			: 1;
	return {
		added: countContentLines(input.replacement) * occurrences,
		deleted: countContentLines(input.needle) * occurrences,
	};
}

export function countContentLines(value: string): number {
	if (!value) return 0;
	return value.split("\n").length;
}

export function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

export function parseApplyPatchSections(
	patchContent: string,
): Array<{ path: string; added: number; deleted: number }> {
	const lines = patchContent.split("\n");
	const sections: Array<{ path: string; added: number; deleted: number }> = [];
	let activePath: string | null = null;
	let activeSection: { path: string; added: number; deleted: number } | null =
		null;
	let hasApplyPatchDirective = false;

	const pushSection = () => {
		if (activeSection) sections.push(activeSection);
	};

	for (const line of lines) {
		if (line.startsWith("*** Update File: ")) {
			hasApplyPatchDirective = true;
			pushSection();
			activePath = line.replace("*** Update File: ", "").trim();
			activeSection = null;
			continue;
		}
		if (line.startsWith("*** Add File: ")) {
			hasApplyPatchDirective = true;
			pushSection();
			activePath = line.replace("*** Add File: ", "").trim();
			activeSection = { path: activePath || "unknown", added: 0, deleted: 0 };
			continue;
		}
		if (line.startsWith("*** Delete File: ")) {
			hasApplyPatchDirective = true;
			pushSection();
			const deletedPath = line.replace("*** Delete File: ", "").trim();
			sections.push({ path: deletedPath, added: 0, deleted: 0 });
			activePath = null;
			activeSection = null;
			continue;
		}
		if (line.startsWith("@@")) {
			pushSection();
			activeSection = { path: activePath || "unknown", added: 0, deleted: 0 };
			continue;
		}
		if (!activeSection) continue;
		if (line.startsWith("+") && !line.startsWith("+++"))
			activeSection.added += 1;
		if (line.startsWith("-") && !line.startsWith("---"))
			activeSection.deleted += 1;
	}
	pushSection();

	return hasApplyPatchDirective && sections.length > 0
		? sections
		: parseUnifiedDiffSections(patchContent);
}

export function parseUnifiedDiffSections(
	diffContent: string,
): Array<{ path: string; added: number; deleted: number }> {
	const sections: Array<{ path: string; added: number; deleted: number }> = [];
	let current: { path: string; added: number; deleted: number } | null = null;
	let pendingOldPath: string | null = null;

	for (const line of diffContent.split("\n")) {
		if (line.startsWith("--- ")) {
			const oldPath = normalizeDiffPath(line.slice(4).trim());
			pendingOldPath = oldPath === "/dev/null" ? null : oldPath;
			continue;
		}

		if (line.startsWith("+++ ")) {
			if (current) sections.push(current);
			const newPath = normalizeDiffPath(line.slice(4).trim());
			current = {
				path: newPath === "/dev/null" ? pendingOldPath || "unknown" : newPath,
				added: 0,
				deleted: 0,
			};
			pendingOldPath = null;
			continue;
		}

		if (!current) continue;
		if (line.startsWith("+") && !line.startsWith("+++")) current.added += 1;
		if (line.startsWith("-") && !line.startsWith("---")) current.deleted += 1;
	}

	if (current) sections.push(current);
	return sections;
}

function normalizeDiffPath(path: string): string {
	if (path.startsWith("a/") || path.startsWith("b/")) return path.slice(2);
	return path;
}

function toMs(value: unknown): number {
	if (!value) return Number.MAX_SAFE_INTEGER;
	const n = Date.parse(String(value));
	return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}
