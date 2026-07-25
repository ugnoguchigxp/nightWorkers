import type { VerificationEvidenceHistoryContext } from "../../codingAgent";
import type { TranscriptItem } from "../activityTranscript";
import type { ActivityEvent, WorkbenchArtifactRef } from "../types";
import { formatFinishedTime } from "../utils/time";
import { ThreadMessage } from "./ThreadMessage";
import {
	activityCodeFilename,
	DiffCodeBlock,
	fallbackEventText,
	findArtifactTaskMessage,
} from "./ThreadTimelineActivityTranscript";
import {
	getCodexToolCardModel,
	NormalCodexToolCard,
} from "./ThreadTimelineCodexToolCard";
import { NormalContextStillToolCard } from "./ThreadTimelineContextStillCards";
import { NormalImportProjectToolCard } from "./ThreadTimelineImportProjectCard";
import { NormalInspectionToolCard } from "./ThreadTimelineInspectionToolCard";
import { ChatMarkdown, NightWorkersCodeBlock } from "./ThreadTimelineMarkdown";
import { MessagePayload } from "./ThreadTimelineMessagePayload";
import {
	buildVisibleEditDiffSummary,
	getVisibleCliCommandSummary,
	getVisibleEditDiffCode,
	transcriptChildEvent,
	type VisibleEditDiffSummary,
} from "./ThreadTimelineNormalTranscriptModel";
import { formatVisibleAssistantText } from "./ThreadTimelineStreaming";

export {
	buildNormalTranscriptItems,
	buildVisibleEditDiffSummary,
	getVisibleCliCommandSummary,
} from "./ThreadTimelineNormalTranscriptModel";
export function NormalTranscriptItemView({
	item,
	onOpenArtifact,
	onOpenProjectFile,
	onOpenEvidenceCheckArtifact,
	onOpenReviewModeArtifact,
	verificationHistoryByEventId,
}: {
	item: TranscriptItem;
	onOpenArtifact: (artifact: WorkbenchArtifactRef) => void;
	onOpenProjectFile?: (path: string) => void;
	onOpenEvidenceCheckArtifact?: () => void;
	onOpenReviewModeArtifact?: () => void;
	verificationHistoryByEventId?: Map<
		string,
		VerificationEvidenceHistoryContext
	>;
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
					{item.children.map((child, _index) => {
						const event = transcriptChildEvent(child);
						return event ? (
							<NormalVisibleActivityBlock
								key={`${item.id}-activity-${event.id}`}
								event={event}
								verificationHistory={verificationHistoryByEventId?.get(
									event.id,
								)}
							/>
						) : null;
					})}
				</div>
			</ThreadMessage>
		);
	}

	if (item.kind === "activity") {
		const block = (
			<NormalVisibleActivityBlock
				event={item.event}
				verificationHistory={verificationHistoryByEventId?.get(item.event.id)}
			/>
		);
		return isVisibleEditDiffActivity(item.event) ? (
			<ThreadMessage
				messageRole="assistant"
				timestamp={formatFinishedTime(item.event.createdAt)}
			>
				<div className="space-y-3">{block}</div>
			</ThreadMessage>
		) : (
			block
		);
	}

	return null;
}

function isVisibleEditDiffActivity(event: ActivityEvent) {
	return buildVisibleEditDiffSummary(event).length > 0;
}

function NormalVisibleActivityBlock({
	event,
	verificationHistory,
}: {
	event: ActivityEvent;
	verificationHistory?: VerificationEvidenceHistoryContext;
}) {
	return (
		<>
			<NormalEditDiffBlock event={event} />
			<NormalCodexToolCard
				event={event}
				verificationHistory={verificationHistory}
			/>
			{!getCodexToolCardModel(event) ? (
				<NormalCliCommandBlock event={event} />
			) : null}
			<NormalContextStillToolCard event={event} />
			<NormalImportProjectToolCard event={event} />
			<NormalInspectionToolCard event={event} />
		</>
	);
}

function NormalEditDiffBlock({ event }: { event: ActivityEvent }) {
	const summary = buildVisibleEditDiffSummary(event);
	const code = getVisibleEditDiffCode(event);
	if (summary.length === 0) return null;
	const displaySummary = compactEditSummaryPaths(summary);
	if (!code.trim()) {
		return (
			<div className="nightworkers-chat-card overflow-hidden rounded-[var(--radius-md)] border font-mono text-sm">
				<div className="nightworkers-chat-card-header px-4 py-3">
					<NormalEditSummaryList summary={displaySummary} />
				</div>
			</div>
		);
	}
	return (
		<details
			className="nightworkers-chat-card overflow-hidden rounded-[var(--radius-md)] border font-mono text-sm"
			open
		>
			<summary className="nightworkers-chat-card-header cursor-pointer list-none px-4 py-3">
				<NormalEditSummaryList summary={displaySummary} />
			</summary>
			<div className="nightworkers-chat-card-body border-t">
				<DiffCodeBlock code={code} label={activityCodeFilename(event)} />
			</div>
		</details>
	);
}

function compactEditSummaryPaths(
	summary: VisibleEditDiffSummary,
): VisibleEditDiffSummary {
	const paths = summary.map((section) => section.path);
	if (!paths.every((path) => path.startsWith("/"))) return summary;
	const segments = paths.map((path) => path.split("/").filter(Boolean));
	if (segments.length === 1) {
		return summary.map((section) => ({
			...section,
			path: segments[0].slice(-3).join("/"),
		}));
	}
	let commonLength = 0;
	const shortestPathLength = Math.min(...segments.map((parts) => parts.length));
	while (
		commonLength < shortestPathLength &&
		segments.every((parts) => parts[commonLength] === segments[0][commonLength])
	) {
		commonLength += 1;
	}
	if (commonLength === 0) return summary;
	return summary.map((section, index) => ({
		...section,
		path: segments[index].slice(commonLength).join("/") || section.path,
	}));
}

function NormalCliCommandBlock({ event }: { event: ActivityEvent }) {
	const summary = getVisibleCliCommandSummary(event);
	if (!summary) return null;

	return (
		<details className="nightworkers-chat-card overflow-hidden rounded-[var(--radius-md)] border font-mono text-sm">
			<summary className="nightworkers-chat-card-header cursor-pointer list-none px-4 py-3">
				<div className="flex items-baseline justify-between gap-4">
					<span className="nightworkers-chat-card-title min-w-0 truncate">
						{summary.command}
					</span>
					<span className="nightworkers-chat-card-meta shrink-0 whitespace-nowrap text-right">
						{summary.toolName}
					</span>
				</div>
			</summary>
			<div className="nightworkers-chat-card-body border-t">
				<NightWorkersCodeBlock
					code={
						summary.output
							? [`$ ${summary.command}`, "", summary.output].join("\n")
							: summary.command
					}
					filename="command.sh"
					language="shell"
					maxHeight={160}
					syntaxHighlighting={false}
				/>
			</div>
		</details>
	);
}

function NormalEditSummaryList({
	summary,
}: {
	summary: VisibleEditDiffSummary;
}) {
	return (
		<div className="space-y-4">
			<div className="flex items-baseline justify-between gap-4">
				<span className="nightworkers-chat-card-title font-medium">
					{summary.every((section) => section.changedOnly)
						? "コード変更"
						: "コード差分"}
				</span>
				<span className="nightworkers-chat-card-meta">
					{summary.length}ファイル
				</span>
			</div>
			{summary.map((section) => (
				<div
					className="flex items-baseline justify-between gap-4"
					key={section.path}
				>
					<span className="nightworkers-chat-card-title min-w-0 truncate">
						{section.path}
					</span>
					{section.changedOnly ? (
						<span className="nightworkers-chat-card-meta shrink-0 whitespace-nowrap text-right">
							{changeKindLabel(section.changeKind)}
						</span>
					) : (
						<span className="shrink-0 whitespace-nowrap text-right">
							<span className="nightworkers-chat-card-success">
								+{section.added}
							</span>
							<span className="nightworkers-chat-card-subtle px-1"> </span>
							<span className="nightworkers-chat-card-danger-text">
								-{section.deleted}
							</span>
						</span>
					)}
				</div>
			))}
		</div>
	);
}

function changeKindLabel(kind: VisibleEditDiffSummary[number]["changeKind"]) {
	if (kind === "add") return "追加";
	if (kind === "delete") return "削除";
	return "変更";
}
