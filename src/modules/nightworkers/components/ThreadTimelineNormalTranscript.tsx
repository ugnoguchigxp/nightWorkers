import type { TranscriptChild, TranscriptItem } from "../activityTranscript";
import type { ActivityEvent, WorkbenchArtifactRef } from "../types";
import { formatFinishedTime } from "../utils/time";
import { ThreadMessage } from "./ThreadMessage";
import {
	asNumber,
	asRecord,
	asString,
	estimateReplacementStats,
	getActivityChangedFiles,
	getCodexCommandOutput,
	getToolActivityModel,
	getToolArguments,
	getToolName,
	getToolResult,
	isChangedFilesOnlyDiffActivity,
	parseApplyPatchSections,
	parseUnifiedDiffSections,
} from "./ThreadTimeline";
import {
	activityCodeFilename,
	DiffCodeBlock,
	fallbackEventText,
	findArtifactTaskMessage,
	getActivityDiffCode,
	getEditToolCall,
	getEditToolCallDiff,
	isDiffActivity,
} from "./ThreadTimelineActivityTranscript";
import {
	getCodexToolCardModel,
	NormalCodexToolCard,
} from "./ThreadTimelineCodexToolCard";
import {
	getContextStillToolCardModel,
	NormalContextStillToolCard,
} from "./ThreadTimelineContextStillCards";
import {
	getImportProjectToolCardModel,
	NormalImportProjectToolCard,
} from "./ThreadTimelineImportProjectCard";
import {
	getInspectionToolCardModel,
	NormalInspectionToolCard,
} from "./ThreadTimelineInspectionToolCard";
import { ChatMarkdown, NightWorkersCodeBlock } from "./ThreadTimelineMarkdown";
import { MessagePayload } from "./ThreadTimelineMessagePayload";
import {
	formatVisibleAssistantText,
	stringValue,
} from "./ThreadTimelineStreaming";

export function buildNormalTranscriptItems(
	items: TranscriptItem[],
): TranscriptItem[] {
	const filtered: TranscriptItem[] = [];
	const seenEditDiffs = new Set<string>();
	const seenCliCommands = new Set<string>();
	const seenContextStillCards = new Set<string>();
	const seenImportProjectCards = new Set<string>();
	const seenInspectionToolCards = new Set<string>();
	const seenCodexToolCards = new Set<string>();

	for (const item of items) {
		if (item.kind === "user_turn") {
			filtered.push(item);
			continue;
		}

		if (item.kind === "assistant_turn") {
			const text = isPatchEnvelopeText(item.text) ? "" : item.text;
			const children = item.children.filter((child) => {
				const event = transcriptChildEvent(child);
				return event
					? rememberVisibleActivityEvent(event, {
							seenEditDiffs,
							seenCliCommands,
							seenContextStillCards,
							seenImportProjectCards,
							seenInspectionToolCards,
							seenCodexToolCards,
						})
					: false;
			});
			if (text.trim() || children.length > 0)
				filtered.push({ ...item, text, children });
			continue;
		}

		if (
			item.kind === "activity" &&
			rememberVisibleActivityEvent(item.event, {
				seenEditDiffs,
				seenCliCommands,
				seenContextStillCards,
				seenImportProjectCards,
				seenInspectionToolCards,
				seenCodexToolCards,
			})
		) {
			filtered.push(item);
		}
	}

	return filtered;
}

function transcriptChildEvent(
	child: TranscriptChild,
): ActivityEvent | undefined {
	if (child.kind === "tool") return child.events[0];
	return child.event;
}

function rememberVisibleActivityEvent(
	event: ActivityEvent,
	seen: {
		seenEditDiffs: Set<string>;
		seenCliCommands: Set<string>;
		seenContextStillCards: Set<string>;
		seenImportProjectCards: Set<string>;
		seenInspectionToolCards: Set<string>;
		seenCodexToolCards: Set<string>;
	},
): boolean {
	const codexCard = getCodexToolCardModel(event);
	if (codexCard) {
		return rememberVisibleCodexToolCard(
			event,
			codexCard,
			seen.seenCodexToolCards,
		);
	}
	return (
		rememberVisibleEditDiff(event, seen.seenEditDiffs) ||
		rememberVisibleCliCommand(event, seen.seenCliCommands) ||
		rememberVisibleContextStillCard(event, seen.seenContextStillCards) ||
		rememberVisibleImportProjectCard(event, seen.seenImportProjectCards) ||
		rememberVisibleInspectionToolCard(event, seen.seenInspectionToolCards)
	);
}

function rememberVisibleEditDiff(
	event: ActivityEvent,
	seenEditDiffs: Set<string>,
): boolean {
	const key = visibleEditDiffKey(event);
	if (!key) return false;
	if (seenEditDiffs.has(key)) return false;
	seenEditDiffs.add(key);
	return true;
}

function rememberVisibleCliCommand(
	event: ActivityEvent,
	seenCliCommands: Set<string>,
): boolean {
	const summary = getVisibleCliCommandSummary(event);
	if (!summary) return false;
	const key = visibleCliCommandKey(event, summary);
	if (seenCliCommands.has(key)) return false;
	seenCliCommands.add(key);
	return true;
}

function rememberVisibleContextStillCard(
	event: ActivityEvent,
	seenContextStillCards: Set<string>,
): boolean {
	const card = getContextStillToolCardModel(event);
	if (!card) return false;
	const key = visibleContextStillCardKey(event, card.kind);
	if (seenContextStillCards.has(key)) return false;
	seenContextStillCards.add(key);
	return true;
}

function rememberVisibleImportProjectCard(
	event: ActivityEvent,
	seenImportProjectCards: Set<string>,
): boolean {
	const card = getImportProjectToolCardModel(event);
	if (!card) return false;
	const key = visibleImportProjectCardKey(
		event,
		card.targetPath || card.sourceSummary,
	);
	if (seenImportProjectCards.has(key)) return false;
	seenImportProjectCards.add(key);
	return true;
}

function rememberVisibleInspectionToolCard(
	event: ActivityEvent,
	seenInspectionToolCards: Set<string>,
): boolean {
	const card = getInspectionToolCardModel(event);
	if (!card) return false;
	const key = visibleInspectionToolCardKey(
		event,
		card.toolName,
		card.lifecycle,
		card.target || card.query || "",
	);
	if (seenInspectionToolCards.has(key)) return false;
	seenInspectionToolCards.add(key);
	return true;
}

function rememberVisibleCodexToolCard(
	event: ActivityEvent,
	card: NonNullable<ReturnType<typeof getCodexToolCardModel>>,
	seenCodexToolCards: Set<string>,
): boolean {
	const key = visibleCodexToolCardKey(event, card);
	if (seenCodexToolCards.has(key)) return false;
	seenCodexToolCards.add(key);
	return true;
}

function visibleCliCommandKey(
	event: ActivityEvent,
	summary: VisibleCliCommandSummary,
): string {
	const payload = asRecord(event.payloadJson);
	const runEvent = asRecord(payload.runEvent);
	const runEventData = asRecord(runEvent.data);
	const nestedPayload = asRecord(payload.payload);
	const step =
		asNumber(runEventData.iteration) ||
		asNumber(runEventData.step) ||
		asNumber(nestedPayload.step);
	if (typeof step === "number") {
		return `${event.runId || runEvent.runId || "run"}:${step}:${summary.toolName}:${summary.command}`;
	}
	return `${summary.toolName}:${summary.command}`;
}

function visibleContextStillCardKey(
	event: ActivityEvent,
	kind: string,
): string {
	const payload = asRecord(event.payloadJson);
	const runEvent = asRecord(payload.runEvent);
	const runEventData = asRecord(runEvent.data);
	const providerItemId = asString(runEventData.providerItemId);
	if (providerItemId) return `${providerItemId}:${kind}`;
	return `${event.runId || "run"}:${event.seq}:${kind}`;
}

function visibleImportProjectCardKey(
	event: ActivityEvent,
	target: string,
): string {
	const payload = asRecord(event.payloadJson);
	const runEvent = asRecord(payload.runEvent);
	const runEventData = asRecord(runEvent.data);
	const providerItemId = asString(runEventData.providerItemId);
	if (providerItemId) return `${providerItemId}:import_project`;
	return `${event.runId || "run"}:${event.seq}:import_project:${target}`;
}

function visibleInspectionToolCardKey(
	event: ActivityEvent,
	toolName: string,
	lifecycle: string,
	target: string,
): string {
	const payload = asRecord(event.payloadJson);
	const runEvent = asRecord(payload.runEvent);
	const runEventData = asRecord(runEvent.data);
	const nestedPayload = asRecord(payload.payload);
	const step =
		asNumber(runEventData.iteration) ||
		asNumber(runEventData.step) ||
		asNumber(nestedPayload.step);
	if (typeof step === "number") {
		return `${event.runId || runEvent.runId || "run"}:${step}:${toolName}:${lifecycle}:${target}`;
	}
	return `${event.runId || "run"}:${event.seq}:${toolName}:${lifecycle}:${target}`;
}

function visibleCodexToolCardKey(
	event: ActivityEvent,
	card: NonNullable<ReturnType<typeof getCodexToolCardModel>>,
): string {
	if (card.providerItemId)
		return `${card.providerItemId}:${card.lifecycle}:${card.toolName}`;
	return `${event.runId || "run"}:${event.seq}:${card.lifecycle}:${card.toolName}:${card.summary}`;
}

function visibleEditDiffKey(event: ActivityEvent): string {
	const code = getVisibleEditDiffCode(event).trim();
	if (code) return code;
	const summary = buildVisibleEditDiffSummary(event);
	return summary.length > 0
		? summary
				.map(
					(section) =>
						`${section.path}:${section.added}:${section.deleted}:${section.changedOnly}`,
				)
				.join("|")
		: "";
}

function getVisibleEditDiffCode(event: ActivityEvent): string {
	return (
		getEditToolCallDiff(event) ||
		(isDiffActivity(event) ? getActivityDiffCode(event) : "")
	);
}

function isPatchEnvelopeText(text: string): boolean {
	const trimmed = text.trim();
	return (
		trimmed.startsWith("*** Begin Patch") || trimmed.startsWith("diff --git ")
	);
}

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

export type VisibleEditDiffSummary = Array<{
	path: string;
	added: number;
	deleted: number;
	changedOnly?: boolean;
}>;

export function buildVisibleEditDiffSummary(
	event: ActivityEvent,
): VisibleEditDiffSummary {
	const activity = getToolActivityModel(event);
	const toolCall = getEditToolCall(event);

	if (toolCall?.name === "apply_patch") {
		const sections = mergeEditSections(
			parseApplyPatchSections(stringValue(toolCall.arguments.patchContent)),
		);
		if (sections.length > 0) return sections;
		return getActivityChangedFiles(event).map((path) => ({
			path,
			added: 0,
			deleted: 0,
			changedOnly: true,
		}));
	}

	if (toolCall?.name === "replace_content") {
		const filePath =
			stringValue(toolCall.arguments.filePath) ||
			stringValue(activity?.resultPayload.filePath) ||
			"unknown";
		const estimate = estimateReplacementStats({
			needle: stringValue(toolCall.arguments.needle),
			replacement: stringValue(toolCall.arguments.replacement),
		});
		return [
			{
				path: filePath,
				added: estimate?.added || 0,
				deleted: estimate?.deleted || 0,
			},
		];
	}

	if (isDiffActivity(event)) {
		const diff = getVisibleEditDiffCode(event);
		const sections = diff
			? mergeEditSections(parseUnifiedDiffSections(diff))
			: [];
		if (sections.length > 0) return sections;
		if (isChangedFilesOnlyDiffActivity(event)) return [];
		return getActivityChangedFiles(event).map((path) => ({
			path,
			added: 0,
			deleted: 0,
			changedOnly: true,
		}));
	}

	return [];
}

export type VisibleCliCommandSummary = {
	toolName: "run_command" | "run_verification" | "command_execution";
	command: string;
	output?: string;
};

export function getVisibleCliCommandSummary(
	event: ActivityEvent,
): VisibleCliCommandSummary | null {
	const activity = getToolActivityModel(event);
	const payload = asRecord(event.payloadJson);
	const toolName = activity?.toolName ?? getToolName(payload);
	if (
		toolName !== "run_command" &&
		toolName !== "run_verification" &&
		toolName !== "command_execution"
	) {
		return null;
	}

	const args = activity?.arguments ?? asRecord(getToolArguments(payload));
	const result = activity?.rawResult ?? asRecord(getToolResult(payload));
	const resultPayload = activity?.resultPayload ?? asRecord(result.payload);
	const runEvent = asRecord(payload.runEvent);
	const runEventData = asRecord(runEvent.data);
	const payloadPayload = asRecord(payload.payload);
	const command =
		asString(args.command) ||
		asString(resultPayload.command) ||
		asString(runEventData.command) ||
		asString(payloadPayload.command);
	if (!command.trim()) return null;
	const output = getCodexCommandOutput(event);
	return output ? { toolName, command, output } : { toolName, command };
}

function mergeEditSections(
	sections: Array<{ path: string; added: number; deleted: number }>,
): Array<{ path: string; added: number; deleted: number }> {
	const byPath = new Map<
		string,
		{ path: string; added: number; deleted: number }
	>();
	for (const section of sections) {
		const current = byPath.get(section.path);
		if (current) {
			current.added += section.added;
			current.deleted += section.deleted;
		} else {
			byPath.set(section.path, { ...section });
		}
	}
	return [...byPath.values()].filter(
		(section) => section.added > 0 || section.deleted > 0,
	);
}
