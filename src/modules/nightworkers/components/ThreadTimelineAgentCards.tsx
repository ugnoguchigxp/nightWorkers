import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CodeBlockData } from "@/components/ui/CodeBlock";
import type { ReviewResult, TaskEvent } from "../types";
import {
	asNumber,
	asRecord,
	asString,
	buildApplyPatchCodeBlockData,
	buildReplaceContentCodeBlockData,
	estimateReplacementStats,
	getActivityDiffPayload,
	getApplyPatchContent,
	getChangedFilesFromResult,
	getToolActivityModel,
	getToolName,
	parseApplyPatchSections,
	parseUnifiedDiffSections,
} from "./ThreadTimeline";
import { NightWorkersCodeBlock } from "./ThreadTimelineMarkdown";

export function AgentEditSummaryCard({ event }: { event: TaskEvent }) {
	const summary = getAgentEditSummary(event);
	if (!summary) return null;

	return (
		<details className="nightworkers-chat-card rounded border">
			<summary className="nightworkers-chat-card-header cursor-pointer list-none px-3 py-2 text-xs">
				コード変更 ({summary.sections.length}){" "}
				<span className="nightworkers-chat-card-meta">
					{editSummaryToolLabel(summary.toolName)}
				</span>
			</summary>
			<div className="nightworkers-chat-card-body space-y-3 border-t px-3 py-2 text-xs">
				<div className="space-y-1">
					{summary.sections.map((section, _idx) => (
						<div
							key={`${event.id}-section-${section.path}-${section.detail || ""}`}
							className="nightworkers-chat-card-item rounded border px-2 py-1"
						>
							<div className="nightworkers-chat-card-title truncate">
								{section.path}
							</div>
							<div className="nightworkers-chat-card-meta">
								{typeof section.added === "number" ||
								typeof section.deleted === "number" ? (
									<>
										<span className="nightworkers-chat-card-success">
											+{section.added || 0}
										</span>{" "}
										<span className="nightworkers-chat-card-danger-text">
											-{section.deleted || 0}
										</span>
									</>
								) : null}
								{section.detail ? (
									<span className="ml-2">{section.detail}</span>
								) : null}
							</div>
						</div>
					))}
				</div>
				{summary.codeBlocks?.length ? (
					<NightWorkersCodeBlock data={summary.codeBlocks} maxHeight={320} />
				) : null}
			</div>
		</details>
	);
}

function editSummaryToolLabel(toolName: AgentEditSummary["toolName"]) {
	return toolName === "git_diff" ? "workspace diff" : toolName;
}

export function ReviewerEvaluationCard({ event }: { event: TaskEvent }) {
	const payload = asRecord(event.payloadJson);
	const runEvent = asRecord(payload.runEvent);
	if (!isReviewerEvaluationEvent(event)) return null;
	const data = asRecord(runEvent.data);
	const eventType = runEvent.type || event.eventType || event.type;
	const status =
		data.status ||
		(eventType === "review.evaluation_started" ? "started" : "loaded");
	const verdict = data.finalReviewerVerdict || data.deterministicVerdict;
	const blockingCount = data.blockingFindingCount;
	const degradedReasons = Array.isArray(data.degradedReasons)
		? data.degradedReasons
		: [];

	return (
		<details
			className="nightworkers-chat-card rounded border"
			data-tone="warning"
		>
			<summary className="nightworkers-chat-card-header cursor-pointer list-none px-3 py-2 text-xs">
				<span className="nightworkers-chat-card-badge mr-2 rounded border px-1.5 py-0.5">
					agent reviewer
				</span>
				{String(status)}
				{verdict ? (
					<span className="nightworkers-chat-card-warning ml-2">
						verdict {String(verdict)}
					</span>
				) : null}
				{typeof blockingCount === "number" ? (
					<span className="nightworkers-chat-card-warning ml-2">
						blocking {blockingCount}
					</span>
				) : null}
			</summary>
			<div className="nightworkers-chat-card-body space-y-2 border-t px-3 py-2 text-[11px]">
				<div>{event.message}</div>
				{degradedReasons.length > 0 ? (
					<div className="nightworkers-chat-card-warning">
						degraded: {degradedReasons.join(", ")}
					</div>
				) : null}
				<pre className="nightworkers-chat-card-code max-h-[220px] overflow-auto whitespace-pre-wrap break-all rounded p-2 text-[10px]">
					{JSON.stringify(data, null, 2)}
				</pre>
			</div>
		</details>
	);
}

export function isReviewerEvaluationEvent(event: TaskEvent): boolean {
	const payload = asRecord(event.payloadJson);
	const runEvent = asRecord(payload.runEvent);
	const type = runEvent.type || event.eventType || event.type;
	return (
		type === "review.rubric_loaded" ||
		type === "review.evaluation_started" ||
		type === "review.llm_started" ||
		type === "review.llm_finished" ||
		type === "review.evaluation_finished"
	);
}

export function hasAgentEditSummary(event: TaskEvent): boolean {
	return getAgentEditSummary(event) !== null;
}

export function AgentDebugEventCard({
	event,
	variant = "default",
	timestamp,
}: {
	event: TaskEvent;
	variant?: "default" | "dock";
	timestamp?: string;
}) {
	const { t } = useTranslation();
	const [copiedEventId, setCopiedEventId] = useState<string | null>(null);
	const payload = asRecord(event.payloadJson);
	const runEvent = asRecord(payload.runEvent);
	const toolCall = asRecord(payload.toolCall);
	const correctionRequest = asRecord(payload.correctionRequest);
	const correctionInstruction = asString(correctionRequest.instruction);
	const runEventType = asString(runEvent.type);
	const reviewResult =
		payload.reviewResult &&
		typeof payload.reviewResult === "object" &&
		!Array.isArray(payload.reviewResult)
			? (asRecord(payload.reviewResult) as ReviewResult)
			: null;
	const toolName = asString(payload.toolName || toolCall.name);
	const patchContent = getApplyPatchContent(payload);
	const round = payload.round;
	const phase = asString(payload.phase);
	const patchLines =
		typeof patchContent === "string" ? patchContent.split("\n") : [];

	return (
		<div
			className={
				variant === "dock"
					? "nightworkers-pilot-thought-event w-full border-b px-3 py-2"
					: "nightworkers-chat-card rounded border p-3"
			}
		>
			<div className="mb-1 flex flex-wrap items-center gap-2 text-[10px]">
				<span className="nightworkers-chat-card-badge rounded border px-1.5 py-0.5">
					{runEventType || event.eventType || event.type || "event"}
				</span>
				{event.actor ? (
					<span className="nightworkers-chat-card-badge rounded border px-1.5 py-0.5">
						{event.actor}
					</span>
				) : null}
				{typeof round === "number" ? (
					<span className="nightworkers-chat-card-badge rounded border px-1.5 py-0.5">
						{t("timeline.roundLabel", { round })}
					</span>
				) : null}
				{phase ? (
					<span className="nightworkers-chat-card-badge rounded border px-1.5 py-0.5">
						{phase}
					</span>
				) : null}
				{toolName ? (
					<span className="nightworkers-chat-card-badge rounded border px-1.5 py-0.5">
						{t("timeline.toolLabel", { tool: toolName })}
					</span>
				) : null}
				{timestamp ? (
					<span className="nightworkers-chat-card-subtle ml-auto">
						{timestamp}
					</span>
				) : null}
			</div>
			<div className="nightworkers-chat-card-title mb-2 text-xs">
				{event.message}
			</div>
			{correctionInstruction ? (
				<section
					className="nightworkers-chat-card-item mt-2 rounded border px-3 py-2"
					aria-label="Plan Mode agentへの依頼内容"
				>
					<div className="nightworkers-chat-card-meta text-[10px] font-medium">
						依頼内容
					</div>
					<div className="nightworkers-chat-card-title mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed">
						{correctionInstruction}
					</div>
				</section>
			) : null}
			{reviewResult ? (
				<ReviewResultSummary reviewResult={reviewResult} />
			) : null}
			{typeof patchContent === "string" && patchContent.trim() ? (
				<div className="nightworkers-code-block mt-2 overflow-hidden rounded border">
					<div className="flex items-center border-b px-3 py-2 text-xs">
						apply_patch.patch
					</div>
					<div className="max-h-[320px] overflow-auto p-3 font-mono text-[12px] leading-6">
						{patchLines.map((line, _idx) => {
							const lineClass = line.startsWith("+")
								? "nightworkers-diff-line-add"
								: line.startsWith("-")
									? "nightworkers-diff-line-remove"
									: "text-[var(--nw-code-text)]";
							return (
								<div
									key={`${event.id}-patch-${line}`}
									className={`whitespace-pre-wrap break-all rounded px-2 ${lineClass}`}
								>
									{line.length > 0 ? line : " "}
								</div>
							);
						})}
					</div>
				</div>
			) : null}
			{payload ? (
				<details className="nightworkers-debug-payload mt-2 overflow-hidden rounded border">
					<summary className="nightworkers-debug-payload-summary cursor-pointer list-none px-2 py-1.5 text-[11px] font-medium">
						{t("timeline.debugDetails")}
					</summary>
					<div className="nightworkers-debug-payload-content border-t px-2 py-2">
						<div className="mb-2 flex justify-end">
							<button
								type="button"
								className="nightworkers-debug-copy inline-flex items-center gap-1 rounded border px-2 py-1 text-[10px]"
								onClick={async () => {
									const text = JSON.stringify(payload, null, 2);
									await navigator.clipboard.writeText(text);
									setCopiedEventId(event.id);
									setTimeout(
										() =>
											setCopiedEventId((current) =>
												current === event.id ? null : current,
											),
										1200,
									);
								}}
								aria-label={t("timeline.copyDebugJson")}
							>
								{copiedEventId === event.id ? (
									<>
										<Check className="h-3 w-3" />
										{t("timeline.copied")}
									</>
								) : (
									<>
										<Copy className="h-3 w-3" />
										{t("timeline.copy")}
									</>
								)}
							</button>
						</div>
						<pre className="nightworkers-debug-json max-h-80 overflow-auto whitespace-pre-wrap break-all rounded p-2 text-[10px]">
							{JSON.stringify(payload, null, 2)}
						</pre>
					</div>
				</details>
			) : null}
		</div>
	);
}

export function ReviewResultSummary({
	reviewResult,
}: {
	reviewResult: ReviewResult;
}) {
	return (
		<div className="nightworkers-review-result mt-2 rounded border px-3 py-2 text-[11px]">
			<div className="flex flex-wrap items-center gap-2">
				<span className="nightworkers-review-result-label rounded border px-1.5 py-0.5">
					review_result
				</span>
				<span>{reviewResult.action}</span>
				<span>→ {reviewResult.verdict}</span>
				<span>status {reviewResult.statusAfter}</span>
			</div>
			{reviewResult.note ? (
				<div className="mt-1">{reviewResult.note}</div>
			) : null}
			{reviewResult.outcome?.summary ? (
				<div className="mt-1">{reviewResult.outcome.summary}</div>
			) : null}
		</div>
	);
}

export type AgentEditSummary = {
	toolName: "apply_patch" | "replace_content" | "git_diff";
	sections: Array<{
		path: string;
		added?: number;
		deleted?: number;
		detail?: string;
	}>;
	codeBlocks?: CodeBlockData[];
};

export function getAgentEditSummary(event: TaskEvent): AgentEditSummary | null {
	const payload = event.payloadJson;
	const diffContent = getActivityDiffPayload(event);
	if (diffContent.trim()) {
		const sections = parseUnifiedDiffSections(diffContent);
		if (sections.length > 0) {
			return {
				toolName: "git_diff",
				sections,
				codeBlocks: [
					{
						code: diffContent.trimEnd(),
						filename: "workspace.diff",
						language: "diff",
					},
				],
			};
		}
	}

	const activity = getToolActivityModel(event) ?? getToolActivityModel(payload);
	const toolName = activity?.toolName ?? getToolName(payload);
	const args = activity?.arguments ?? {};
	const result = activity?.rawResult ?? {};
	const resultPayload = activity?.resultPayload ?? {};

	if (toolName === "apply_patch") {
		const patchContent = asString(
			args?.patchContent || getApplyPatchContent(payload),
		);
		if (patchContent.trim()) {
			const sections = parseApplyPatchSections(patchContent);
			if (sections.length > 0) {
				return {
					toolName,
					sections,
					codeBlocks: buildApplyPatchCodeBlockData(patchContent),
				};
			}
		}
		const changedFiles = getChangedFilesFromResult(result);
		if (changedFiles.length > 0) {
			return {
				toolName,
				sections: changedFiles.map((path) => ({
					path,
					detail:
						activity?.status === "failed" || result.ok === false
							? "failed"
							: "applied",
				})),
			};
		}
		return null;
	}

	if (toolName === "replace_content") {
		const filePath = asString(args.filePath || resultPayload.filePath);
		if (!filePath.trim()) return null;
		const occurrences = asNumber(resultPayload.occurrences);
		const estimate = estimateReplacementStats({
			needle: asString(args?.needle),
			replacement: asString(args?.replacement),
			occurrences,
		});
		return {
			toolName,
			sections: [
				{
					path: filePath,
					added: estimate?.added,
					deleted: estimate?.deleted,
					detail:
						typeof occurrences === "number"
							? `${occurrences} occurrence${occurrences === 1 ? "" : "s"}`
							: "replacement requested",
				},
			],
			codeBlocks: buildReplaceContentCodeBlockData({
				filePath,
				needle: asString(args?.needle),
				replacement: asString(args?.replacement),
				occurrences,
			}),
		};
	}

	return null;
}
