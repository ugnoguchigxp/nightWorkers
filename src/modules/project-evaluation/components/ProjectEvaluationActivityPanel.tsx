import { Bot, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { buildTranscriptItems } from "../../nightworkers/activityTranscript";
import { TranscriptItemView } from "../../nightworkers/components/ThreadTimelineActivityTranscript";
import type { ActivityEvent } from "../../nightworkers/types";
import type { ProjectEvaluationActivityEvent } from "../model/projectEvaluationTypes";

function formatElapsed(ms: number) {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes === 0) return `${seconds}秒`;
	return `${minutes}分${seconds.toString().padStart(2, "0")}秒`;
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function projectEvaluationEventKind(event: ProjectEvaluationActivityEvent) {
	const payload = asRecord(event.payload);
	const type = typeof payload.type === "string" ? payload.type : "";
	if (type === "model.response_delta") return "llm.response_delta";
	if (type === "model.response_finished") return "llm.response_final";
	if (type === "model.response_parse_failed") return "llm.schema_result";
	if (type === "model.response_repaired") return "llm.schema_result";
	if (type.startsWith("model.")) return `llm.${type.slice("model.".length)}`;
	if (event.phase === "llm") return "llm.event";
	if (event.level === "error" || event.status === "failed")
		return "system.error";
	return "run.status";
}

function projectEvaluationEventText(event: ProjectEvaluationActivityEvent) {
	const payload = asRecord(event.payload);
	const data = asRecord(payload.data);
	const deltaText = typeof data.text === "string" ? data.text : "";
	if (deltaText && projectEvaluationEventKind(event) === "llm.response_delta")
		return deltaText;
	return event.message;
}

function toActivityEvent(event: ProjectEvaluationActivityEvent): ActivityEvent {
	const payload = asRecord(event.payload);
	const type = typeof payload.type === "string" ? payload.type : "";
	const data = asRecord(payload.data);
	return {
		id: event.id,
		taskId: event.evaluationId,
		runId: event.evaluationId,
		seq: event.seq,
		kind: projectEvaluationEventKind(event),
		source: event.source,
		status: event.status,
		text: projectEvaluationEventText(event),
		payloadJson: {
			...data,
			projectEvaluation: true,
			agentEventType: type,
			phase: event.phase,
			level: event.level,
			message: event.message,
			payload: data,
			llmDebugEvent: event.payload,
		},
		visibility: "debug",
		createdAt: event.createdAt,
	};
}

export function ProjectEvaluationActivityPanel({
	events,
	isRunning,
}: {
	events: ProjectEvaluationActivityEvent[];
	isRunning: boolean;
}) {
	const sortedEvents = useMemo(
		() => events.slice().sort((a, b) => a.seq - b.seq),
		[events],
	);
	const transcriptItems = useMemo(
		() => buildTranscriptItems({ events: sortedEvents.map(toActivityEvent) }),
		[sortedEvents],
	);
	const [now, setNow] = useState(() => Date.now());
	const startedAt = sortedEvents[0]?.createdAt
		? new Date(sortedEvents[0].createdAt).getTime()
		: 0;

	useEffect(() => {
		if (!isRunning) return;
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [isRunning]);

	return (
		<section className="rounded-md border border-[var(--nw-border)] bg-[var(--nw-panel)] shadow-sm">
			<div className="flex min-h-12 items-center justify-between gap-3 border-[var(--nw-border)] border-b px-3 py-2">
				<div className="min-w-0">
					<div className="flex min-w-0 items-center gap-2 font-semibold text-[var(--nw-muted-text)] text-xs uppercase">
						<Bot className="h-4 w-4 text-[var(--nw-primary)]" />
						LLM アクティビティ
					</div>
					<div className="mt-1 truncate text-[var(--nw-subtle-text)] text-xs">
						{isRunning && startedAt > 0
							? `evaluation role からの応答待ち: ${formatElapsed(now - startedAt)}`
							: `${sortedEvents.length} events`}
					</div>
				</div>
				{isRunning ? (
					<span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--nw-strong-border)] bg-[var(--nw-surface-soft)] px-2.5 text-[var(--nw-text)] text-xs">
						<Loader2 className="h-3.5 w-3.5 animate-spin" />
						LLMに依頼中
					</span>
				) : null}
			</div>
			<div className="space-y-3 p-4">
				{transcriptItems.length === 0 ? (
					<div className="rounded-md border border-[var(--nw-border)] bg-[var(--nw-surface-soft)] px-3 py-4 text-center text-[var(--nw-subtle-text)] text-sm">
						{isRunning
							? "実 LLM アクティビティを待っています。"
							: "まだ LLM アクティビティはありません。"}
					</div>
				) : (
					transcriptItems.map((item) => (
						<TranscriptItemView
							key={item.id}
							item={item}
							onOpenArtifact={() => undefined}
						/>
					))
				)}
			</div>
		</section>
	);
}
