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
	onOpenEvidenceCheckArtifact,
	onOpenReviewModeArtifact,
}: {
	item: TranscriptItem;
	onOpenArtifact: (artifact: WorkbenchArtifactRef) => void;
	onOpenProjectFile?: (path: string) => void;
	onOpenEvidenceCheckArtifact?: () => void;
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
					onOpenEvidenceCheckArtifact={onOpenEvidenceCheckArtifact}
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
							onOpenEvidenceCheckArtifact={onOpenEvidenceCheckArtifact}
							onOpenReviewModeArtifact={onOpenReviewModeArtifact}
						/>
					) : visibleText.trim() ? (
						<ChatMarkdown
							content={visibleText}
							onOpenProjectFile={onOpenProjectFile}
							onOpenEvidenceCheckArtifact={onOpenEvidenceCheckArtifact}
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
	const toneClass =
		tone === "warning" ? "nightworkers-chat-card-tone-warning" : "";
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
			className={`nightworkers-chat-card rounded border ${toneClass}`.trim()}
			defaultOpen={defaultOpen}
			summary={
				<summary className="nightworkers-chat-card-header cursor-pointer list-none px-3 py-2 text-xs">
					<span className="nightworkers-chat-card-badge mr-2 rounded border px-1.5 py-0.5">
						{displayTitle}
					</span>
					<span className="nightworkers-chat-card-meta">{event.source}</span>
					{event.status ? (
						<span className="nightworkers-chat-card-meta ml-2">
							{event.status}
						</span>
					) : null}
					<span className="nightworkers-chat-card-subtle ml-2">
						#{event.seq}
					</span>
				</summary>
			}
		>
			<div className="nightworkers-chat-card-body space-y-2 border-t px-3 py-2 text-xs">
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
					<pre className="nightworkers-chat-card-code max-h-[280px] overflow-auto whitespace-pre-wrap break-all rounded p-2 font-mono text-[10px]">
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
