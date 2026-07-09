import { useTranslation } from "react-i18next";
import { toDeepRecord } from "../../../../shared/json-record";
import { formatTokenCount } from "../../../i18n/format";
import type { TranscriptChild, TranscriptItem } from "../activityTranscript";
import type {
	ActivityEvent,
	TaskMessage,
	WorkbenchArtifactRef,
} from "../types";
import { formatFinishedTime } from "../utils/time";
import { ThreadMessage } from "./ThreadMessage";
import {
	formatCodexToolActivitySummary,
	getActivityChangedFiles,
	getActivityDiffPayload,
	getCodexCommandOutput,
	getToolActivityModel,
	isChangedFilesOnlyDiffActivity,
} from "./ThreadTimeline";
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
import {
	formatVisibleAssistantText,
	stringValue,
	tryParseJsonObject,
} from "./ThreadTimelineStreaming";
import { sanitizeTerminalText } from "./terminalText";

const UNKNOWN_ACTIVITY_TITLE_KEY = "timeline.unknownActivity";

export { DiffCodeBlock, parseDiffMetadata } from "./ThreadTimelineDiffView";

export function TranscriptItemView({
	item,
	onOpenArtifact,
	onOpenProjectFile,
	onOpenTestModeArtifact,
}: {
	item: TranscriptItem;
	onOpenArtifact: (artifact: WorkbenchArtifactRef) => void;
	onOpenProjectFile?: (path: string) => void;
	onOpenTestModeArtifact?: () => void;
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
						/>
					) : visibleText.trim() ? (
						<ChatMarkdown
							content={visibleText}
							onOpenProjectFile={onOpenProjectFile}
							onOpenTestModeArtifact={onOpenTestModeArtifact}
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
		<details className={`rounded border ${borderClass}`} open={defaultOpen}>
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
		</details>
	);
}

function childEventId(child: TranscriptChild) {
	if (child.kind === "tool")
		return child.events.map((event) => event.id).join("-");
	return child.event.id;
}

export function fallbackEventText(event?: ActivityEvent) {
	if (!event) return "";
	return formatVisibleAssistantText(
		event.text || JSON.stringify(event.payloadJson || {}, null, 2),
	);
}

export function getActivityCode(event: ActivityEvent) {
	const payload = toDeepRecord(event.payloadJson);
	const agentEventType = schemaFirstAgentEventType(event);
	const editToolDiff = getEditToolCallDiff(event);
	if (editToolDiff) return editToolDiff;
	if (isDiffActivity(event)) return getActivityDiffCode(event);
	if (agentEventType === "procedure.loaded") {
		return stringValue(
			payload?.payload?.procedure ||
				payload?.procedure ||
				payload?.runEvent?.data?.procedure,
		);
	}
	if (typeof payload?.rawContent === "string") return payload.rawContent;
	if (typeof payload?.systemPrompt === "string") return payload.systemPrompt;
	if (typeof payload?.userPrompt === "string") return payload.userPrompt;
	if (typeof payload?.payload?.rawContent === "string")
		return payload.payload.rawContent;
	if (typeof payload?.payload?.systemPrompt === "string")
		return payload.payload.systemPrompt;
	if (typeof payload?.payload?.userPrompt === "string")
		return payload.payload.userPrompt;
	if (
		payload?.payload &&
		(event.kind === "llm.schema_result" || event.kind.startsWith("runtime."))
	) {
		return JSON.stringify(payload.payload, null, 2);
	}
	if (typeof payload?.code === "string") return payload.code;
	if (
		typeof payload?.text === "string" &&
		agentEventType === "model.response_delta"
	) {
		return payload.text;
	}
	if (
		typeof payload?.runEvent?.data?.text === "string" &&
		event.kind.includes("delta")
	) {
		return payload.runEvent.data.text;
	}
	if (typeof payload?.runEvent?.data?.rawContent === "string") {
		return payload.runEvent.data.rawContent;
	}
	if (typeof payload?.runEvent?.data?.result?.payload?.stdout === "string") {
		return sanitizeTerminalText(payload.runEvent.data.result.payload.stdout);
	}
	if (typeof payload?.runEvent?.data?.result?.payload?.stderr === "string") {
		return sanitizeTerminalText(payload.runEvent.data.result.payload.stderr);
	}
	const codexOutput = getCodexCommandOutput(event);
	if (codexOutput) return codexOutput;
	return "";
}

export function getActivityDiffCode(event: ActivityEvent) {
	return getActivityDiffPayload(event);
}

function isLlmOutputActivity(event: ActivityEvent) {
	return [
		"assistant.raw_output",
		"llm.schema_result",
		"llm.decision_json",
		"llm.response_delta",
		"llm.response_final",
	].includes(event.kind);
}

export function isDiffActivity(event: ActivityEvent) {
	return event.kind === "file.patch" || event.kind === "file.diff";
}

function formatLlmOutputJson(event: ActivityEvent, payload: unknown): string {
	const activityCode = getActivityCode(event).trim();
	if (activityCode) {
		const parsed = tryParseJsonObject(activityCode);
		return parsed ? JSON.stringify(parsed, null, 2) : activityCode;
	}
	if (event.text?.trim()) {
		const parsed = tryParseJsonObject(event.text);
		return parsed ? JSON.stringify(parsed, null, 2) : event.text;
	}
	const record = toDeepRecord(payload);
	const llmPayload = record?.payload || record?.runEvent?.data || record || {};
	return JSON.stringify(llmPayload, null, 2);
}

export function activityCodeFilename(event: ActivityEvent) {
	const editToolName = getEditToolCall(event)?.name;
	const agentEventType = schemaFirstAgentEventType(event);
	const payload = toDeepRecord(event.payloadJson);
	if (editToolName === "apply_patch") return "apply_patch.patch";
	if (editToolName === "replace_content") return "replace_content.diff";
	if (agentEventType === "procedure.loaded") {
		return (
			stringValue(payload?.payload?.procedurePath || payload?.procedurePath) ||
			"procedure.md"
		);
	}
	if (event.kind.includes("patch")) return "activity.patch";
	if (event.kind.includes("diff")) return "activity.diff";
	if (event.kind.includes("json") || event.kind.startsWith("llm."))
		return "activity.json";
	if (agentEventType === "model.response_finished") return "raw-output.json";
	if (agentEventType?.endsWith("prompt_built")) return "prompt.txt";
	return event.kind;
}

function activityCodeLanguage(event: ActivityEvent) {
	if (schemaFirstAgentEventType(event) === "procedure.loaded")
		return "markdown";
	if (getEditToolCall(event)) return "diff";
	if (event.kind.includes("patch") || event.kind.includes("diff"))
		return "diff";
	if (event.kind.includes("json") || event.kind.startsWith("llm."))
		return "json";
	return "text";
}

type EditToolCall = {
	name: "apply_patch" | "replace_content";
	arguments: Record<string, unknown>;
};

export function getEditToolCall(event: ActivityEvent): EditToolCall | null {
	const payload = toDeepRecord(event.payloadJson);
	const activity = getToolActivityModel(event);
	if (
		(activity?.toolName === "apply_patch" ||
			activity?.toolName === "replace_content") &&
		activity.arguments
	) {
		return { name: activity.toolName, arguments: activity.arguments };
	}

	const candidates = [
		payload?.payload?.toolCall,
		payload?.payload,
		payload?.runEvent?.data?.payload?.toolCall,
		payload?.runEvent?.data?.toolCall,
		payload?.runEvent?.data,
		payload,
	];

	if (event.text?.trim()) {
		candidates.push(toDeepRecord(tryParseJsonObject(event.text)).toolCall);
	}

	for (const candidate of candidates) {
		if (!candidate || typeof candidate !== "object") continue;
		const candidateRecord = toDeepRecord(candidate);
		const name = String(candidateRecord.name);
		if (name !== "apply_patch" && name !== "replace_content") continue;
		const args =
			candidateRecord.arguments &&
			typeof candidateRecord.arguments === "object" &&
			!Array.isArray(candidateRecord.arguments)
				? candidateRecord.arguments
				: {};
		return { name, arguments: args };
	}

	return null;
}

export function getEditToolCallDiff(event: ActivityEvent): string {
	const toolCall = getEditToolCall(event);
	if (!toolCall) return "";

	if (toolCall.name === "apply_patch") {
		return formatApplyPatchDiff(stringValue(toolCall.arguments.patchContent));
	}

	const filePath = stringValue(toolCall.arguments.filePath) || "unknown";
	const needle = stringValue(toolCall.arguments.needle);
	const replacement = stringValue(toolCall.arguments.replacement);
	const content = [
		`--- ${filePath}`,
		`+++ ${filePath}`,
		"# replace_content",
		needle ? `- ${needle}` : "",
		replacement ? `+ ${replacement}` : "",
	]
		.filter(Boolean)
		.join("\n");

	return content.trim();
}

function formatApplyPatchDiff(patchContent: string): string {
	return patchContent
		.split("\n")
		.map((line) => {
			if (line === "*** Begin Patch" || line === "*** End Patch") return "";
			if (line.startsWith("*** Add File: "))
				return `+++ ${line.slice("*** Add File: ".length)}`;
			if (line.startsWith("*** Delete File: "))
				return `--- ${line.slice("*** Delete File: ".length)}`;
			if (line.startsWith("*** Update File: "))
				return `--- ${line.slice("*** Update File: ".length)}`;
			return line;
		})
		.filter((line) => line.trim())
		.join("\n")
		.trimEnd();
}

export function schemaFirstAgentEventType(event: ActivityEvent): string {
	const payload = toDeepRecord(event.payloadJson);
	return typeof payload?.agentEventType === "string"
		? payload.agentEventType
		: "";
}

function activityDisplayTitle(event: ActivityEvent, fallback: string): string {
	const workRecordCard = getWorkRecordCard(event);
	if (workRecordCard?.type === "command") {
		return workRecordCard.executionMode === "background"
			? "Background command"
			: "Command";
	}
	if (workRecordCard?.type === "file") return "File edit";
	if (workRecordCard?.type === "failure") return "Needs attention";
	const agentEventType = schemaFirstAgentEventType(event);
	switch (agentEventType) {
		case "run.started":
			return "Run started";
		case "round1.prompt_built":
			return "Round 1 prompt";
		case "round1.parsed":
			return "Round 1 jobType";
		case "procedure.loaded":
			return "Procedure loaded";
		case "round2.prompt_built":
			return "Round 2 prompt";
		case "round2.parsed":
			return "Round 2 toolCall";
		case "round2.invalid":
			return "Round 2 invalid";
		case "model.request_started":
			return "LLM request";
		case "model.response_finished":
			return "LLM raw output";
		case "tool.started":
			return "Tool started";
		case "tool.finished":
			return "Tool result";
		case "tool.failed":
			return "Tool failed";
		case "tool.validation_failed":
			return "Tool validation failed";
		case "job.switched":
			return "Job switched";
		case "finalize.received":
			return "Final answer";
		case "run.completed":
			return "Run completed";
		case "run.needs_human":
			return "Needs human";
		case "run.failed":
			return "Run failed";
		default:
			return fallback;
	}
}

function activityDisplaySummary(event: ActivityEvent): string {
	const payload = toDeepRecord(event.payloadJson);
	const data = payload?.payload || payload?.runEvent?.data || payload || {};
	if (event.kind === "llm.usage") {
		const usageSummary = formatLlmUsageSummary(data);
		if (usageSummary) return usageSummary;
	}
	const workRecordCard = getWorkRecordCard(event);
	if (workRecordCard) {
		const command = stringValue(data.command || payload.command);
		const status = stringValue(data.status || payload.status || event.status);
		const cwd = stringValue(data.cwd || payload.cwd);
		const exitCode =
			typeof data.exitCode === "number" || typeof payload.exitCode === "number"
				? `exit=${data.exitCode ?? payload.exitCode}`
				: "";
		const stopReason = stringValue(data.stopReason || payload.stopReason);
		const outputSummary = stringValue(
			data.outputSummary || payload.outputSummary,
		);
		return [
			command,
			[status, exitCode, cwd, stopReason].filter(Boolean).join(" · "),
			outputSummary,
		]
			.filter(Boolean)
			.join("\n");
	}
	const agentEventType = schemaFirstAgentEventType(event);
	if (agentEventType === "round1.parsed" && typeof data.jobType === "string") {
		return data.jobType;
	}
	if (agentEventType === "round2.parsed" && data.toolCall) {
		return toolCallSummary(data.toolCall);
	}
	if (agentEventType === "tool.started" && data.toolCall) {
		return toolCallSummary(data.toolCall);
	}
	if (agentEventType === "tool.finished") {
		return typeof data.toolName === "string"
			? data.toolName
			: event.text || "tool finished";
	}
	if (agentEventType === "finalize.received") {
		return formatVisibleAssistantText(
			typeof data.message === "string" ? data.message : event.text || "",
		);
	}
	if (agentEventType === "model.response_finished") {
		return formatVisibleAssistantText(
			typeof data.rawContent === "string" ? data.rawContent : event.text || "",
		);
	}
	if (event.kind === "tool.call" || event.kind === "tool.result") {
		return formatCodexToolActivitySummary(event);
	}
	if (event.kind === "file.diff") {
		const changedFiles = getActivityChangedFiles(event);
		if (changedFiles.length > 0) {
			return [`Changed files (${changedFiles.length})`, ...changedFiles].join(
				"\n",
			);
		}
	}
	if (agentEventType === "procedure.loaded") {
		return typeof data.procedurePath === "string"
			? data.procedurePath
			: event.text || "procedure loaded";
	}
	if (agentEventType.endsWith("prompt_built")) {
		return event.text || "prompt built";
	}
	return event.text || event.ingestError || event.status || event.kind;
}

function formatLlmUsageSummary(data: Record<string, unknown>): string {
	const inputTokens = tokenValue(data.inputTokens);
	const cachedInputTokens = tokenValue(data.cachedInputTokens);
	const outputTokens = tokenValue(data.outputTokens);
	if (
		inputTokens === null &&
		cachedInputTokens === null &&
		outputTokens === null
	) {
		return "";
	}
	return [
		`Input: ${formatLlmUsageToken(inputTokens)}`,
		`Cached input: ${formatLlmUsageToken(cachedInputTokens)}`,
		`Output: ${formatLlmUsageToken(outputTokens)}`,
	].join("\n");
}

function tokenValue(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return Math.max(0, Math.floor(value));
	}
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
	}
	return null;
}

function formatLlmUsageToken(value: number | null): string {
	return value === null ? "N/A" : formatTokenCount(value);
}

function getWorkRecordCard(
	event: ActivityEvent,
): { type?: string; executionMode?: string } | null {
	const payload = toDeepRecord(event.payloadJson);
	const candidate =
		payload?.workRecordCard ||
		payload?.payload?.workRecordCard ||
		payload?.runEvent?.data?.workRecordCard;
	if (!candidate || typeof candidate !== "object") return null;
	return candidate;
}

function toolCallSummary(toolCall: unknown): string {
	if (!toolCall || typeof toolCall !== "object") return "";
	const toolCallRecord = toDeepRecord(toolCall);
	const name =
		typeof toolCallRecord.name === "string" ? toolCallRecord.name : "toolCall";
	const args =
		toolCallRecord.arguments && typeof toolCallRecord.arguments === "object"
			? toDeepRecord(toolCallRecord.arguments)
			: {};
	const filePath = typeof args.filePath === "string" ? args.filePath : "";
	const command = typeof args.command === "string" ? args.command : "";
	const query = typeof args.query === "string" ? args.query : "";
	const detail = filePath || command || query;
	return detail ? `${name}: ${detail}` : name;
}

function isHighVolumeActivity(event: ActivityEvent): boolean {
	const agentEventType = schemaFirstAgentEventType(event);
	return (
		agentEventType === "model.response_finished" ||
		agentEventType.endsWith("prompt_built") ||
		event.kind === "assistant.raw_output"
	);
}
