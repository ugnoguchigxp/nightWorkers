import { ShieldAlert } from "lucide-react";
import type { ReviewArtifact, ReviewRunArtifactPayload } from "../types";

type VisibleReviewFinding = {
	id: string;
	severity: string;
	title: string;
	body: string | null;
	filePath: string | null;
};

export function ReviewRunResultPanel({
	reviewRun,
	visibleFindings,
	securityArtifact,
}: {
	reviewRun: ReviewRunArtifactPayload | null;
	visibleFindings: VisibleReviewFinding[];
	securityArtifact?: ReviewArtifact;
}) {
	const securityResult = securityDiagnosticResult(securityArtifact);
	const fixesWereRequested = reviewRun?.options.applyFixes === true;
	const fixesWereApplied = reviewRun?.fixesApplied === true;
	const hasContent =
		Boolean(reviewRun?.finalReport?.trim()) ||
		visibleFindings.length > 0 ||
		Boolean(securityResult);
	if (!hasContent) return null;
	return (
		<div className="grid gap-3 rounded border border-slate-800 bg-slate-950/45 p-3">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
						実行結果
					</div>
					<div className="mt-1 text-sm font-semibold text-slate-100">
						{fixesWereRequested ? "指摘事項と修正結果" : "指摘事項"}
					</div>
				</div>
				<span
					className={`rounded border px-2 py-0.5 text-[11px] ${
						fixesWereRequested
							? fixesWereApplied
								? "border-emerald-700 bg-emerald-950/30 text-emerald-100"
								: "border-cyan-800 bg-cyan-950/30 text-cyan-100"
							: "border-slate-700 bg-slate-900 text-slate-300"
					}`}
				>
					{fixesWereRequested
						? fixesWereApplied
							? "修正済み"
							: "修正適用あり"
						: "修正適用なし"}
				</span>
			</div>
			{visibleFindings.length > 0 ? (
				<div className="grid gap-2">
					{visibleFindings.slice(0, 8).map((finding) => (
						<div
							key={finding.id}
							className={`grid gap-1 rounded border px-3 py-2 text-xs ${severityClass(finding.severity)}`}
						>
							<div className="flex flex-wrap items-center gap-2">
								<span className="font-semibold">{finding.title}</span>
								<span className="rounded border border-current/30 px-1.5 py-0.5 text-[10px] uppercase opacity-80">
									{finding.severity}
								</span>
							</div>
							{finding.filePath ? (
								<div className="font-mono text-[11px] opacity-80">
									{finding.filePath}
								</div>
							) : null}
							{finding.body ? (
								<div className="whitespace-pre-wrap leading-5 opacity-90">
									{compactText(finding.body, 500)}
								</div>
							) : null}
						</div>
					))}
				</div>
			) : (
				<div className="rounded border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs text-slate-300">
					表示対象の指摘事項はありません。
				</div>
			)}
			{reviewRun?.finalReport?.trim() ? (
				<div className="grid gap-1">
					<div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
						Review Run 報告
					</div>
					<pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded border border-slate-800 bg-slate-950/70 p-3 text-xs leading-5 text-slate-200">
						{compactText(reviewRun.finalReport, 2200)}
					</pre>
				</div>
			) : null}
			{securityResult ? (
				<SecurityDiagnosticPanel result={securityResult} />
			) : null}
		</div>
	);
}

function SecurityDiagnosticPanel({
	result,
}: {
	result: NonNullable<ReturnType<typeof securityDiagnosticResult>>;
}) {
	const passed =
		result.status === "completed" && result.highOrCriticalCount === 0;
	return (
		<div className="grid gap-2 rounded border border-slate-800 bg-slate-900/45 p-3 text-xs text-slate-300">
			<div className="flex flex-wrap items-center gap-2">
				<ShieldAlert className="h-3.5 w-3.5 text-amber-300" />
				<span className="font-semibold text-slate-100">
					vulnWorkbench 実行結果
				</span>
				<span
					className={`rounded border px-2 py-0.5 text-[11px] ${
						passed
							? "border-emerald-700 bg-emerald-950/30 text-emerald-100"
							: "border-amber-800 bg-amber-950/30 text-amber-100"
					}`}
				>
					{result.status}
				</span>
			</div>
			<div className="grid gap-1 sm:grid-cols-2">
				<div>profile: {result.profile}</div>
				<div>scanRunId: {result.scanRunId ?? "-"}</div>
				<div>findings: {result.findingCount}</div>
				<div>high/critical: {result.highOrCriticalCount}</div>
			</div>
			{result.error ? (
				<div className="rounded border border-amber-800/70 bg-amber-950/30 px-2 py-1 text-amber-100">
					{result.error}
				</div>
			) : null}
			{result.improvementRequest ? (
				<div className="whitespace-pre-wrap leading-5">
					{result.improvementRequest}
				</div>
			) : null}
			{result.topFindings.length > 0 ? (
				<div className="grid gap-2">
					<div className="font-semibold text-slate-100">対応が必要な検出</div>
					{result.topFindings.map((finding) => {
						const location = finding.location
							? `${finding.location.path}${finding.location.line ? `:${finding.location.line}` : ""}`
							: "-";
						return (
							<div
								key={finding.id ?? `${finding.ruleId}-${location}`}
								className="rounded border border-amber-900/60 bg-amber-950/20 px-2 py-1.5"
							>
								<div className="font-medium text-amber-100">
									[{finding.severity}] {compactText(finding.title, 260)}
								</div>
								<div className="mt-1 text-slate-300">場所: {location}</div>
								<div className="text-slate-400">
									根拠: {finding.tool} / {finding.ruleId}
								</div>
								{finding.recommendation ? (
									<div className="mt-1 text-slate-200">
										対応: {finding.recommendation}
									</div>
								) : null}
							</div>
						);
					})}
				</div>
			) : null}
			{result.commandsRun.length > 0 ? (
				<div className="grid gap-1">
					{result.commandsRun.map((command) => (
						<div
							key={`${command.command}-${command.summary}`}
							className="rounded border border-slate-800 bg-slate-950/50 px-2 py-1"
						>
							<div className="font-mono text-[11px] text-slate-200">
								{command.command}
							</div>
							<div className="mt-1 text-slate-500">
								exit {command.exitCode ?? "-"} ·{" "}
								{compactText(command.summary, 220)}
							</div>
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function securityDiagnosticResult(artifact: ReviewArtifact | undefined) {
	const payload = isRecord(artifact?.artifact) ? artifact.artifact : null;
	const result = isRecord(payload?.result) ? payload.result : null;
	if (!result) return null;
	const commandsRun = Array.isArray(result.commandsRun)
		? result.commandsRun.filter(isRecord)
		: [];
	const topFindings = Array.isArray(result.topFindings)
		? result.topFindings.filter(isRecord).slice(0, 10)
		: [];
	const highOrCriticalCount =
		typeof result.highOrCriticalCount === "number"
			? result.highOrCriticalCount
			: 0;
	return {
		status:
			typeof result.status === "string"
				? result.status
				: highOrCriticalCount > 0
					? "security_action_required"
					: result.ok === true
						? "completed"
						: "runtime_error",
		profile: typeof result.profile === "string" ? result.profile : "unknown",
		scanRunId: typeof result.scanRunId === "string" ? result.scanRunId : null,
		findingCount:
			typeof result.findingCount === "number" ? result.findingCount : 0,
		highOrCriticalCount,
		improvementRequest:
			typeof result.improvementRequest === "string"
				? result.improvementRequest
				: null,
		topFindings: topFindings.map((finding) => {
			const location = isRecord(finding.location) ? finding.location : null;
			return {
				id: typeof finding.id === "string" ? finding.id : null,
				severity:
					typeof finding.severity === "string" ? finding.severity : "unknown",
				tool: typeof finding.tool === "string" ? finding.tool : "unknown",
				ruleId:
					typeof finding.ruleId === "string" ? finding.ruleId : "unknown-rule",
				title:
					typeof finding.title === "string"
						? finding.title
						: "Untitled finding",
				location:
					typeof location?.path === "string"
						? {
								path: location.path,
								line: typeof location.line === "number" ? location.line : null,
							}
						: null,
				recommendation:
					typeof finding.recommendation === "string"
						? finding.recommendation
						: null,
			};
		}),
		error: typeof result.error === "string" ? result.error : null,
		commandsRun: commandsRun.map((command) => ({
			command: typeof command.command === "string" ? command.command : "",
			exitCode: typeof command.exitCode === "number" ? command.exitCode : null,
			summary: typeof command.summary === "string" ? command.summary : "",
		})),
	};
}

function severityClass(severity: string) {
	if (severity === "blocking")
		return "border-red-800/80 bg-red-950/30 text-red-100";
	if (severity === "warning")
		return "border-amber-800/80 bg-amber-950/30 text-amber-100";
	return "border-slate-700 bg-slate-950/40 text-slate-200";
}

function compactText(value: string | null | undefined, maxLength = 900) {
	const text = value?.trim() || "";
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength).trimEnd()}...`;
}
