import { useTranslation } from "react-i18next";
import { toDeepRecord } from "../../../../shared/json-record";
import type { TranscriptChild, TranscriptItem } from "../activityTranscript";
import type {
	ActivityEvent,
	TaskMessage,
	WorkbenchArtifactRef,
} from "../types";
import { formatFinishedTime } from "../utils/time";
import { LazyDetails } from "./LazyDetails";
import { ThreadMessage } from "./ThreadMessage";
import { isChangedFilesOnlyDiffActivity } from "./ThreadTimeline";
import { CodexToolCard, hasCodexToolCard } from "./ThreadTimelineCodexToolCard";
import {
	ContextStillToolCard,
	hasContextStillToolCard,
} from "./ThreadTimelineContextStillCards";
import { DiffCodeBlock } from "./ThreadTimelineDiffView";
import {
	hasImportProjectToolCard,
	ImportProjectToolCard,
} from "./ThreadTimelineImportProjectCard";
import {
	hasInspectionToolCard,
	InspectionToolCard,
} from "./ThreadTimelineInspectionToolCard";
import { ChatMarkdown, NightWorkersCodeBlock } from "./ThreadTimelineMarkdown";
import { MessagePayload } from "./ThreadTimelineMessagePayload";
import { formatVisibleAssistantText } from "./ThreadTimelineStreaming";

const UNKNOWN_ACTIVITY_TITLE_KEY = "timeline.unknownActivity";

export { DiffCodeBlock, parseDiffMetadata } from "./ThreadTimelineDiffView";

export function TranscriptItemView({
	item,
	onOpenArtifact,
	onOpenProjectFile,
	onOpenTestModeArtifact,
	onOpenReviewModeArtifact,
}: {
	item: TranscriptItem;
	onOpenArtifact: (artifact: WorkbenchArtifactRef) => void;
	onOpenProjectFile?: (path: string) => void;
	onOpenTestModeArtifact?: () => void;
	onOpenReviewModeArtifact?: () => void;
}) {
	if (item.kind === "user_turn") {
		const timestamp = item.events.at(-1)?.createdAt;
		return (
			<ThreadMessage
				messageRole="user"
				timestamp={formatFinishedTime(timestamp)}
			>
				<ChatMarkdown
					content={item.text || fallbackEventText(item.events.at(-1))}
					onOpenProjectFile={onOpenProjectFile}
					onOpenTestModeArtifact={onOpenTestModeArtifact}
					onOpenReviewModeArtifact={onOpenReviewModeArtifact}
				/>
			</ThreadMessage>
		);
	}

	if (item.kind === "assistant_turn") {
		const timestamp = item.events.at(-1)?.createdAt;
		const artifactMessage = findArtifactTaskMessage(item.events);
		const visibleText = formatVisibleAssistantText(item.text);
		return (
			<ThreadMessage
				messageRole="assistant"
				timestamp={formatFinishedTime(timestamp)}
			>
				<div className="space-y-3">
					{artifactMessage ? (
						<MessagePayload
							message={artifactMessage}
							onOpenArtifact={onOpenArtifact}
							onOpenProjectFile={onOpenProjectFile}
							onOpenTestModeArtifact={onOpenTestModeArtifact}
							onOpenReviewModeArtifact={onOpenReviewModeArtifact}
						/>
					) : visibleText.trim() ? (
						<ChatMarkdown
							content={visibleText}
							onOpenProjectFile={onOpenProjectFile}
							onOpenTestModeArtifact={onOpenTestModeArtifact}
							onOpenReviewModeArtifact={onOpenReviewModeArtifact}
						/>
					) : null}
					{item.children.map((child, _index) => (
						<TranscriptChildView
							key={`${item.id}-child-${childEventId(child)}`}
							child={child}
						/>
					))}
				</div>
			</ThreadMessage>
		);
	}

	if ("event" in item && isChangedFilesOnlyDiffActivity(item.event)) {
		return null;
	}

	if (item.kind === "activity" && isVisibleDiffActivity(item.event)) {
		return (
			<ThreadMessage
				messageRole="assistant"
				timestamp={formatFinishedTime(item.event.createdAt)}
			>
				<TranscriptActivityBlock
					event={item.event}
					title={item.event.kind}
					showJson={true}
				/>
			</ThreadMessage>
		);
	}

	if (item.kind === "unknown") {
		return (
			<TranscriptActivityBlock
				event={item.event}
				title={UNKNOWN_ACTIVITY_TITLE_KEY}
				tone="warning"
				artifactText={item.artifact?.contentText}
				showJson={true}
			/>
		);
	}

	return (
		<TranscriptActivityBlock
			event={item.event}
			title={item.event.kind}
			showJson={true}
		/>
	);
}

function isVisibleDiffActivity(event: ActivityEvent) {
	return isDiffActivity(event) && getActivityCode(event).trim().length > 0;
}

export function findArtifactTaskMessage(
	events: ActivityEvent[],
): TaskMessage | null {
	for (const event of events) {
		const payload = toDeepRecord(event.payloadJson);
		const message = payload?.message;
		const metadata = toDeepRecord(payload?.metadata ?? message?.metadataJson);
		if (
			event.kind === "assistant.message" &&
			message &&
			(metadata?.appBlueprint ||
				metadata?.mockBlueprint ||
				metadata?.artifactRef) &&
			String(message.messageType) === "markdown_document"
		) {
			return {
				...message,
				metadataJson: message.metadataJson ?? metadata,
			} as TaskMessage;
		}
	}
	return null;
}

function TranscriptChildView({ child }: { child: TranscriptChild }) {
	if (
		"event" in child &&
		child.event &&
		isChangedFilesOnlyDiffActivity(child.event)
	) {
		return null;
	}
	if (child.kind === "tool") {
		return (
			<TranscriptActivityBlock
				event={child.events[0]}
				title={child.events[0]?.kind || "tool"}
				showJson={true}
			/>
		);
	}
	if (child.kind === "diff") {
		return (
			<TranscriptActivityBlock
				event={child.event}
				title={child.event.kind}
				artifactText={child.artifact?.contentText}
				showJson={true}
			/>
		);
	}
	if (child.kind === "json") {
		return (
			<TranscriptActivityBlock
				event={child.event}
				title={child.event.kind}
				showJson={true}
			/>
		);
	}
	if (child.kind === "log") {
		return (
			<TranscriptActivityBlock
				event={child.event}
				title={child.event.kind}
				artifactText={child.artifact?.contentText}
				showJson={true}
			/>
		);
	}
	if (child.kind === "unknown") {
		return (
			<TranscriptActivityBlock
				event={child.event}
				title={UNKNOWN_ACTIVITY_TITLE_KEY}
				tone="warning"
				artifactText={child.artifact?.contentText}
				showJson={true}
			/>
		);
	}
	return (
		<TranscriptActivityBlock
			event={child.event}
			title={child.event.kind}
			compact={true}
			showJson={true}
		/>
	);
}

function TranscriptActivityBlock({
	event,
	title,
	tone = "default",
	compact = false,
	artifactText,
	codeOverride,
	showSummary = true,
	showJson,
}: {
	event?: ActivityEvent;
	title: string;
	tone?: "default" | "warning";
	compact?: boolean;
	artifactText?: string | null;
	codeOverride?: string;
	showSummary?: boolean;
	showJson?: boolean;
}) {
	const { t } = useTranslation();
	if (!event) return null;
	const borderClass =
		tone === "warning"
			? "border-amber-700/60 bg-amber-950/20 text-amber-50"
			: "border-slate-700/80 bg-slate-900/30 text-slate-100";
	const payload = event.payloadJson || {};
	const titleText = title.startsWith("timeline.") ? t(title) : title;
	const displayTitle = activityDisplayTitle(event, titleText);
	const summary = activityDisplaySummary(event);
	const showLlmDetails = showJson && isLlmOutputActivity(event);
	const code = codeOverride || artifactText || getActivityCode(event);
	const codeFilename = activityCodeFilename(event);
	const codeLanguage = activityCodeLanguage(event);
	const defaultOpen = !compact && !isHighVolumeActivity(event);
	if (hasImportProjectToolCard(event)) {
		return <ImportProjectToolCard event={event} />;
	}
	if (hasContextStillToolCard(event)) {
		return <ContextStillToolCard event={event} />;
	}
	if (hasInspectionToolCard(event)) {
		return <InspectionToolCard event={event} />;
	}
	if (hasCodexToolCard(event)) {
		return <CodexToolCard event={event} />;
	}

	return (
		<LazyDetails
			className={`rounded border ${borderClass}`}
			defaultOpen={defaultOpen}
			summary={
				<summary className="cursor-pointer list-none px-3 py-2 text-xs">
					<span className="mr-2 rounded border border-current/30 px-1.5 py-0.5">
						{displayTitle}
					</span>
					<span className="text-current/80">{event.source}</span>
					{event.status ? (
						<span className="ml-2 text-current/70">{event.status}</span>
					) : null}
					<span className="ml-2 text-current/50">#{event.seq}</span>
				</summary>
			}
		>
			<div className="space-y-2 border-current/10 border-t px-3 py-2 text-xs">
				{showSummary && summary ? (
					<div className="whitespace-pre-wrap break-words">{summary}</div>
				) : null}
				{code && codeLanguage === "diff" ? (
					<DiffCodeBlock code={code} label={codeFilename} />
				) : code ? (
					<NightWorkersCodeBlock
						code={code}
						filename={codeFilename}
						language={codeLanguage}
					/>
				) : null}
				{showLlmDetails && !code ? (
					<pre className="max-h-[280px] overflow-auto whitespace-pre-wrap break-all rounded bg-slate-950/40 p-2 font-mono text-[10px] text-slate-300">
						{formatLlmOutputJson(event, payload)}
					</pre>
				) : null}
			</div>
		</LazyDetails>
	);
}

import {
	activityCodeFilename,
	activityCodeLanguage,
	activityDisplaySummary,
	activityDisplayTitle,
	childEventId,
	fallbackEventText,
	formatLlmOutputJson,
	getActivityCode,
	isDiffActivity,
	isHighVolumeActivity,
	isLlmOutputActivity,
} from "./ThreadTimelineActivityModel";

export {
	activityCodeFilename,
	fallbackEventText,
	getActivityCode,
	getActivityDiffCode,
	getEditToolCall,
	getEditToolCallDiff,
	isDiffActivity,
	schemaFirstAgentEventType,
} from "./ThreadTimelineActivityModel";
