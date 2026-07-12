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
					{item.children.map((child, _index) => {
						const event = transcriptChildEvent(child);
						return event ? (
							<NormalVisibleActivityBlock
								key={`${item.id}-activity-${event.id}`}
								event={event}
							/>
						) : null;
					})}
				</div>
			</ThreadMessage>
		);
	}

	if (item.kind === "activity") {
		const block = <NormalVisibleActivityBlock event={item.event} />;
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

function NormalVisibleActivityBlock({ event }: { event: ActivityEvent }) {
	return (
		<>
			<NormalEditDiffBlock event={event} />
			<NormalCodexToolCard event={event} />
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
	return (
		<details className="overflow-hidden rounded-[var(--radius-md)] border border-transparent bg-[#1f2030] font-mono text-sm text-slate-200">
			<summary className="cursor-pointer list-none px-4 py-3">
				<NormalEditSummaryList summary={summary} />
			</summary>
			{code.trim() ? (
				<div className="border-slate-700/60 border-t">
					<DiffCodeBlock code={code} label={activityCodeFilename(event)} />
				</div>
			) : null}
		</details>
	);
}

function NormalCliCommandBlock({ event }: { event: ActivityEvent }) {
	const summary = getVisibleCliCommandSummary(event);
	if (!summary) return null;

	return (
		<details className="overflow-hidden rounded-[var(--radius-md)] border border-transparent bg-[#1f2030] font-mono text-sm text-slate-200">
			<summary className="cursor-pointer list-none px-4 py-3">
				<div className="flex items-baseline justify-between gap-4">
					<span className="min-w-0 truncate text-slate-300">
						{summary.command}
					</span>
					<span className="shrink-0 whitespace-nowrap text-right text-slate-400">
						{summary.toolName}
					</span>
				</div>
			</summary>
			<div className="border-slate-700/60 border-t">
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
			{summary.map((section) => (
				<div
					className="flex items-baseline justify-between gap-4"
					key={section.path}
				>
					<span className="min-w-0 truncate text-slate-300">
						{section.path}
					</span>
					{section.changedOnly ? (
						<span className="shrink-0 whitespace-nowrap text-right text-slate-400">
							changed
						</span>
					) : (
						<span className="shrink-0 whitespace-nowrap text-right">
							<span className="text-emerald-300">+{section.added}</span>
							<span className="px-1 text-slate-500"> </span>
							<span className="text-rose-300">-{section.deleted}</span>
						</span>
					)}
				</div>
			))}
		</div>
	);
}
