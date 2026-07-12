import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
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
import { TranscriptItemView } from "./ThreadTimelineActivityTranscript";
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
	findRuntimePromptSnapshotTimelineAnchorId,
	findRuntimePromptSnapshotTranscriptAnchorId,
	isChangedFilesOnlyDiffActivity,
	TimelineDebugFragment,
	toMs,
	transcriptItemTimestamp,
} from "./ThreadTimelineEventModel";
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
import { useExternalPathPermissionController } from "./ThreadTimelinePermission.controller";
import { ThreadTimelinePermissionDialog } from "./ThreadTimelinePermissionDialog";
import {
	buildPersistedStreamingResponsePreview,
	buildStreamingResponsePreview,
	FinalReportCard,
	PersistedStreamingResponse,
	RuntimePromptSnapshotCard,
	StreamingResponsePreview,
	ThinkingIndicator,
} from "./ThreadTimelineStreaming";

export { isUserVisibleChatMessage } from "../messageVisibility";
export {
	findArtifactTaskMessage,
	getActivityCode,
	parseDiffMetadata,
} from "./ThreadTimelineActivityTranscript";
export * from "./ThreadTimelineDiffModel";
export * from "./ThreadTimelineEventModel";
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

const timelineWindowSize = 100;

export function sliceTimelineWindow<T>(
	items: T[],
	input: { count?: number; end?: number | null } = {},
) {
	const count = Math.max(1, input.count ?? timelineWindowSize);
	const end = Math.min(Math.max(input.end ?? items.length, 0), items.length);
	const start = Math.max(0, end - count);
	return { items: items.slice(start, end), start, end, total: items.length };
}

export function findUnprojectedUserMessages(
	messages: TaskMessage[],
	transcriptItems: TranscriptItem[],
) {
	const projectedCounts = new Map<string, number>();
	for (const item of transcriptItems) {
		if (item.kind !== "user_turn") continue;
		const key = item.text.trim();
		if (!key) continue;
		projectedCounts.set(key, (projectedCounts.get(key) ?? 0) + 1);
	}

	return messages.filter((message) => {
		if (message.role !== "user") return false;
		const key = message.content.trim();
		const projectedCount = projectedCounts.get(key) ?? 0;
		if (projectedCount === 0) return true;
		projectedCounts.set(key, projectedCount - 1);
		return false;
	});
}

export type ChronologicalTranscriptItem =
	| { kind: "transcript"; id: string; item: TranscriptItem }
	| { kind: "message"; id: string; message: TaskMessage };

export function mergeUnprojectedMessagesChronologically(
	transcriptItems: TranscriptItem[],
	messages: TaskMessage[],
): ChronologicalTranscriptItem[] {
	return [
		...transcriptItems.map((item, index) => ({
			kind: "transcript" as const,
			id: item.id,
			item,
			ts: transcriptItemTimestamp(item),
			order: index,
		})),
		...messages.map((message, index) => ({
			kind: "message" as const,
			id: `unprojected-${message.id}`,
			message,
			ts: toMs(message.createdAt),
			order: transcriptItems.length + index,
		})),
	]
		.sort((a, b) => a.ts - b.ts || a.order - b.order)
		.map(({ ts: _ts, order: _order, ...item }) => item);
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
	const externalPathPermission = useExternalPathPermissionController({
		events: latestRunEvents,
		onGrant: onGrantExternalPath,
	});
	const [historyWindowCount, setHistoryWindowCount] =
		useState(timelineWindowSize);
	const [historyWindowEnd, setHistoryWindowEnd] = useState<number | null>(null);
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
	const filteredTranscriptItems = useMemo(
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
	const unprojectedUserMessages = useMemo(
		() => findUnprojectedUserMessages(chatMessages, transcriptItems),
		[chatMessages, transcriptItems],
	);
	const chronologicalTranscriptItems = useMemo(
		() =>
			mergeUnprojectedMessagesChronologically(
				filteredTranscriptItems,
				unprojectedUserMessages,
			),
		[filteredTranscriptItems, unprojectedUserMessages],
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
	const transcriptHistoryWindow = useMemo(
		() =>
			sliceTimelineWindow(chronologicalTranscriptItems, {
				count: historyWindowCount,
				end: historyWindowEnd,
			}),
		[chronologicalTranscriptItems, historyWindowCount, historyWindowEnd],
	);
	const timelineHistoryWindow = useMemo(
		() =>
			sliceTimelineWindow(timelineItems, {
				count: historyWindowCount,
				end: historyWindowEnd,
			}),
		[timelineItems, historyWindowCount, historyWindowEnd],
	);
	const historyWindow = hasActivityTranscript
		? transcriptHistoryWindow
		: timelineHistoryWindow;
	const visibleTranscriptItems = hasActivityTranscript
		? transcriptHistoryWindow.items.flatMap((item) =>
				item.kind === "transcript" ? [item.item] : [],
			)
		: [];
	const visibleTimelineItems = !hasActivityTranscript
		? timelineHistoryWindow.items
		: [];

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
			? findRuntimePromptSnapshotTimelineAnchorId(
					visibleTimelineItems,
					latestRun,
				)
			: null;
	const shouldRenderTrailingRuntimeSnapshot =
		showDebugEvents &&
		Boolean(latestRun?.contextSnapshot) &&
		!runtimeSnapshotTranscriptAnchorId &&
		!runtimeSnapshotTimelineAnchorId;
	return (
		<div
			className="nightworkers-chat-window space-y-5 p-6"
			data-timeline-mounted-count={historyWindow.items.length}
			data-timeline-total-count={historyWindow.total}
		>
			{historyWindow.start > 0 ? (
				<div className="flex justify-center">
					<Button
						type="button"
						variant="ghost"
						onClick={() => {
							setHistoryWindowEnd((end) => end ?? historyWindow.total);
							setHistoryWindowCount((count) => count + timelineWindowSize);
						}}
					>
						過去の履歴をさらに表示
					</Button>
				</div>
			) : null}
			{historyWindowEnd !== null && historyWindow.end < historyWindow.total ? (
				<div className="flex justify-center">
					<Button
						type="button"
						variant="ghost"
						onClick={() => {
							setHistoryWindowEnd(null);
							setHistoryWindowCount(timelineWindowSize);
						}}
					>
						最新の履歴へ戻る
					</Button>
				</div>
			) : null}
			{externalPathPermission.isOpen && externalPathPermission.path ? (
				<ThreadTimelinePermissionDialog
					path={externalPathPermission.path}
					isGranting={externalPathPermission.isGranting}
					error={externalPathPermission.error}
					onDismiss={externalPathPermission.dismiss}
					onGrant={externalPathPermission.grant}
				/>
			) : null}
			{showDebugEvents && isAgentWorking && latestEvent ? (
				<div className="rounded-lg border border-slate-700/80 bg-slate-900/50 px-3 py-2 text-xs text-slate-200">
					<span className="mr-2 inline-flex h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
					Live: {latestEvent.message}
				</div>
			) : null}
			{hasActivityTranscript
				? transcriptHistoryWindow.items.map((item) =>
						item.kind === "message" ? (
							<ThreadMessage
								key={item.id}
								messageRole="user"
								timestamp={formatFinishedTime(item.message.createdAt)}
							>
								<MessagePayload
									message={item.message}
									onOpenArtifact={onOpenArtifact}
									onOpenProjectFile={onOpenProjectFile}
									onOpenTestModeArtifact={onOpenTestModeArtifact}
									onOpenReviewModeArtifact={onOpenReviewModeArtifact}
								/>
							</ThreadMessage>
						) : showDebugEvents ? (
							<TimelineDebugFragment
								key={item.item.id}
								insertRuntimeSnapshot={
									item.item.id === runtimeSnapshotTranscriptAnchorId
								}
								latestRun={latestRun}
							>
								<TranscriptItemView
									item={item.item}
									onOpenArtifact={onOpenArtifact}
									onOpenProjectFile={onOpenProjectFile}
									onOpenTestModeArtifact={onOpenTestModeArtifact}
									onOpenReviewModeArtifact={onOpenReviewModeArtifact}
								/>
							</TimelineDebugFragment>
						) : (
							<NormalTranscriptItemView
								key={item.item.id}
								item={item.item}
								onOpenArtifact={onOpenArtifact}
								onOpenProjectFile={onOpenProjectFile}
								onOpenTestModeArtifact={onOpenTestModeArtifact}
								onOpenReviewModeArtifact={onOpenReviewModeArtifact}
							/>
						),
					)
				: visibleTimelineItems.map((item) =>
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
									onOpenReviewModeArtifact={onOpenReviewModeArtifact}
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
						onOpenReviewModeArtifact={onOpenReviewModeArtifact}
					/>
				</ThreadMessage>
			) : null}
			{!hasActivityTranscript && persistedStreamingPreview ? (
				<ThreadMessage messageRole="assistant">
					<PersistedStreamingResponse
						preview={persistedStreamingPreview}
						onOpenProjectFile={onOpenProjectFile}
						onOpenTestModeArtifact={onOpenTestModeArtifact}
						onOpenReviewModeArtifact={onOpenReviewModeArtifact}
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
