import type { TaskLlmUsageSummary, WorkbenchSessionView } from "../types";

export function WorkbenchStateBanner({
	sessionView,
	model,
	onRemoveQueueEntry,
	onRequeueQueueEntry,
}: {
	sessionView: WorkbenchSessionView | null;
	model: string;
	onRemoveQueueEntry: () => void;
	onRequeueQueueEntry: (note?: string) => void;
}) {
	if (!sessionView) return null;
	if (
		sessionView.emailState === "plan_ready" ||
		sessionView.emailState === "review_needed"
	) {
		return null;
	}
	if (sessionView.emailState === "queued") {
		return (
			<div className="border-b border-sky-500/20 bg-sky-950/20 px-6 py-3">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="min-w-0">
						<div className="text-sm font-semibold text-sky-100">
							NightShift に追加済み
						</div>
						<div className="mt-1 text-xs text-sky-200/80">
							Queue position #{sessionView.queuePosition ?? "-"}。夜間 Processor
							が順次実行します。
						</div>
					</div>
					<button
						type="button"
						className="rounded border border-sky-300/40 px-3 py-1.5 text-xs text-sky-100 hover:bg-sky-900/40"
						onClick={onRemoveQueueEntry}
					>
						Queue から外す
					</button>
				</div>
			</div>
		);
	}
	if (
		sessionView.emailState === "needs_input" ||
		sessionView.emailState === "failed" ||
		sessionView.emailState === "running"
	) {
		return (
			<div className="border-b border-slate-700/60 bg-slate-950/30 px-6 py-3">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="min-w-0">
						<div className="text-sm font-semibold text-slate-100">
							{stateLabel(sessionView)}
						</div>
						<div className="mt-1 text-xs text-slate-300">
							Session state: {sessionView.emailState} · Model profile: {model}
						</div>
					</div>
					{sessionView.emailState !== "running" && sessionView.queueEntry ? (
						<button
							type="button"
							className="rounded border border-slate-500 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-800"
							onClick={() =>
								onRequeueQueueEntry(
									sessionView.emailState === "needs_input"
										? "Human input supplied; requeue with preserved priority."
										: "Manual retry requested; requeue with preserved priority.",
								)
							}
						>
							優先再投入
						</button>
					) : null}
				</div>
			</div>
		);
	}
	return (
		<div className="border-b border-slate-700/60 bg-slate-950/20 px-6 py-2 text-xs text-slate-300">
			<div>
				Session state: {stateLabel(sessionView)} · Model profile: {model}
			</div>
		</div>
	);
}

function stateLabel(sessionView: WorkbenchSessionView) {
	if (sessionView.emailState === "draft") return "Unclassified";
	if (sessionView.emailState === "plan_ready") return "Ready for Queue";
	if (sessionView.emailState === "queued") return "Implementation Queue";
	if (sessionView.emailState === "running") return sessionView.phase;
	if (sessionView.emailState === "needs_input") return "Needs Attention";
	if (sessionView.emailState === "review_needed") return "Review Required";
	if (sessionView.emailState === "done") return "Done";
	if (sessionView.emailState === "failed") return "Failed";
	return sessionView.emailState;
}

export function formatUsageBadge(summary: TaskLlmUsageSummary | null) {
	const codingAgent = summary?.byOwner?.codingAgent;
	const missionPilot = summary?.byOwner?.missionPilot;
	return [
		formatOwnerUsageBadge("CA", codingAgent),
		formatOwnerUsageBadge("MP", missionPilot),
	].join(" | ");
}

export function formatUsageTitle(summary: TaskLlmUsageSummary | null) {
	if (!summary) {
		return [
			formatOwnerUsageTitle("Coding Agent", null),
			formatOwnerUsageTitle("Mission Pilot", null),
		].join("\n");
	}
	return [
		formatOwnerUsageTitle("Coding Agent", summary.byOwner?.codingAgent ?? null),
		formatOwnerUsageTitle(
			"Mission Pilot",
			summary.byOwner?.missionPilot ?? null,
		),
	].join("\n");
}

function formatOwnerUsageBadge(
	label: string,
	usage: TaskLlmUsageSummary["byOwner"]["codingAgent"] | null | undefined,
) {
	return `${label} i:${formatTokenCount(usage?.inputTokens ?? 0)} c:${formatTokenCount(
		usage?.cachedInputTokens ?? 0,
	)} o:${formatTokenCount(usage?.outputTokens ?? 0)}`;
}

function formatOwnerUsageTitle(
	label: string,
	usage: TaskLlmUsageSummary["byOwner"]["codingAgent"] | null,
) {
	const averageDuration =
		usage?.averageDurationMs === null || usage?.averageDurationMs === undefined
			? "n/a"
			: formatDuration(usage.averageDurationMs);
	return `${label}: input ${(
		usage?.inputTokens ?? 0
	).toLocaleString()} / cached input ${(
		usage?.cachedInputTokens ?? 0
	).toLocaleString()} / output ${(
		usage?.outputTokens ?? 0
	).toLocaleString()} / reasoning output ${(
		usage?.reasoningOutputTokens ?? 0
	).toLocaleString()} / calls ${usage?.callCount ?? 0} / avg ${averageDuration}`;
}

function formatTokenCount(value: number) {
	const count = Math.max(0, Math.floor(value));
	if (count < 1000) return String(count);
	if (count < 1_000_000) return trimCompactNumber(count / 1000, "k");
	return trimCompactNumber(count / 1_000_000, "m");
}

function trimCompactNumber(value: number, suffix: string) {
	return `${value.toFixed(1).replace(/\.0$/, "")}${suffix}`;
}

function formatDuration(durationMs: number) {
	const seconds = Math.max(0, Math.round(durationMs / 100) / 10);
	if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = Math.round(seconds % 60);
	return `${minutes}m ${remainingSeconds}s`;
}
