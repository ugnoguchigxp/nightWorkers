import type { TranscriptChild, TranscriptItem } from "../activityTranscript";
import type { ActivityEvent } from "../types";
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
	getActivityDiffCode,
	getEditToolCall,
	getEditToolCallDiff,
	isDiffActivity,
} from "./ThreadTimelineActivityTranscript";
import { getCodexToolCardModel } from "./ThreadTimelineCodexToolCard";
import { getContextStillToolCardModel } from "./ThreadTimelineContextStillCards";
import { getImportProjectToolCardModel } from "./ThreadTimelineImportProjectCard";
import { getInspectionToolCardModel } from "./ThreadTimelineInspectionToolCard";
import { stringValue } from "./ThreadTimelineStreaming";

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

export function transcriptChildEvent(
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

export function getVisibleEditDiffCode(event: ActivityEvent): string {
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
