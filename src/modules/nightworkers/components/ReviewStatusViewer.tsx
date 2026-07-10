import type { TFunction } from "i18next";
import {
	Archive,
	ArchiveRestore,
	ClipboardCheck,
	GitCommitHorizontal,
	LoaderCircle,
	Play,
	ShieldAlert,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	GitCloseoutState,
	ReviewArtifact,
	ReviewRunArtifactPayload,
	ReviewRunOptions,
	ReviewSessionDetail,
	TaskRun,
} from "../types";

type ReviewStatusViewerProps = {
	detail: ReviewSessionDetail | null;
	onStartReviewRun?: (
		reviewSessionId: string,
		options: Partial<ReviewRunOptions>,
	) => Promise<ReviewSessionDetail>;
	gitCloseout?: GitCloseoutState | null;
	onCommitGitCloseout?: (runId: string) => Promise<GitCloseoutState>;
	activeTaskStatus?: string | null;
	onCompleteAndArchiveTask?: (taskId: string) => Promise<unknown>;
	onRestoreArchivedTask?: (taskId: string) => Promise<unknown>;
	latestRun?: TaskRun;
};

const defaultReviewRunOptions: ReviewRunOptions = {
	codeReview: true,
	securityReview: false,
	applyFixes: true,
	commitChanges: false,
};

const reviewRunOptionDescriptions: Array<{
	key: keyof ReviewRunOptions;
	label: string;
	description: string;
}> = [
	{
		key: "codeReview",
		label: "コードレビュー",
		description:
			"実装計画、対象 diff、変更ファイルを照合し、仕様漏れ・副作用・設計上の危険箇所を確認します。既存の個別レビュー項目を横断する基本チェックです。",
	},
	{
		key: "securityReview",
		label: "セキュリティレビュー",
		description:
			"vulnWorkbench を使って Semgrep、Gitleaks、OSV、Trivy、scan profile、DAST、reproduction、dynamic verification を bounded CLI 実行します。",
	},
	{
		key: "applyFixes",
		label: "修正を適用",
		description:
			"ReviewRun がコードレビューまたはセキュリティレビューで安全に自動修正できる内容だけをその場で反映します。",
	},
	{
		key: "commitChanges",
		label: "コミット",
		description:
			"ReviewRun が対象として確定した変更だけを commit します。対象抽出が人の確認待ち、または blocking warning がある場合は選択できません。",
	},
];

function reviewStatusLabel(t: TFunction, key: string, fallback: string) {
	return t(key, { defaultValue: fallback });
}

function reviewStatusValueLabel(t: TFunction, group: string, value: string) {
	return reviewStatusLabel(t, `reviewStatus.${group}.${value}`, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function reviewArtifactTimeValue(artifact: ReviewArtifact) {
	const timestamp = new Date(artifact.updatedAt).getTime();
	return Number.isNaN(timestamp) ? 0 : timestamp;
}

function latestArtifactByKind(artifacts: ReviewArtifact[], kind: string) {
	return artifacts
		.filter((artifact) => artifact.kind === kind)
		.sort((a, b) => reviewArtifactTimeValue(b) - reviewArtifactTimeValue(a))[0];
}

function reviewRunPayload(
	artifact: ReviewArtifact | undefined,
): ReviewRunArtifactPayload | null {
	if (!artifact || !isRecord(artifact.artifact)) return null;
	if (artifact.artifact.kind !== "review_run") return null;
	return artifact.artifact as ReviewRunArtifactPayload;
}

const terminalReviewRunStatuses = new Set([
	"completed",
	"needs_review",
	"needs_human",
	"failed",
	"blocked",
	"timed_out",
	"cancelled",
]);

function reviewRunResolvedStatus(
	payload: ReviewRunArtifactPayload | null,
	latestRun?: TaskRun,
) {
	if (!payload) return null;
	if (
		payload.status === "running" &&
		payload.reviewRunId &&
		latestRun?.id === payload.reviewRunId &&
		terminalReviewRunStatuses.has(latestRun.status)
	) {
		if (
			latestRun.status === "completed" ||
			latestRun.status === "needs_review"
		) {
			return "done";
		}
		if (latestRun.status === "needs_human" || latestRun.status === "blocked") {
			return "needs_human";
		}
		return "failed";
	}
	return payload.status;
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
	return {
		ok: result.ok === true,
		profile: typeof result.profile === "string" ? result.profile : "unknown",
		projectId: typeof result.projectId === "string" ? result.projectId : null,
		scanRunId: typeof result.scanRunId === "string" ? result.scanRunId : null,
		findingCount:
			typeof result.findingCount === "number" ? result.findingCount : 0,
		highOrCriticalCount:
			typeof result.highOrCriticalCount === "number"
				? result.highOrCriticalCount
				: 0,
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

const reviewActionButtonBaseClass =
	"inline-flex h-8 items-center justify-center gap-1.5 rounded border px-3 text-xs font-semibold shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:shadow-none";
const reviewPrimaryActionButtonClass = `${reviewActionButtonBaseClass} nightworkers-primary-action-button`;
const reviewSuccessActionButtonClass = `${reviewActionButtonBaseClass} nightworkers-success-action-button`;

export function ReviewStatusViewer({
	detail,
	onStartReviewRun,
	gitCloseout,
	onCommitGitCloseout,
	activeTaskStatus,
	onCompleteAndArchiveTask,
	onRestoreArchivedTask,
	latestRun,
}: ReviewStatusViewerProps) {
	const { t } = useTranslation();
	const [busySection, setBusySection] = useState<string | null>(null);
	const [reviewRunOptions, setReviewRunOptions] = useState<ReviewRunOptions>(
		defaultReviewRunOptions,
	);
	const [error, setError] = useState<string | null>(null);
	if (!detail) {
		return (
			<div className="flex h-full items-center justify-center text-xs text-slate-500">
				{t("reviewStatus.unavailable")}
			</div>
		);
	}
	const status = detail.statusArtifact;
	const level = status.recommendation.level;
	const levelClass =
		level === "required"
			? "border-red-500/60 bg-red-950/30 text-red-100"
			: level === "recommended"
				? "border-amber-500/60 bg-amber-950/30 text-amber-100"
				: "border-cyan-500/60 bg-cyan-950/30 text-cyan-100";
	const latestReviewRun = reviewRunPayload(
		latestArtifactByKind(detail.artifacts, "review_run"),
	);
	const resolvedReviewRunStatus = reviewRunResolvedStatus(
		latestReviewRun,
		latestRun,
	);
	const reviewRunInProgress =
		busySection === "review_run" || resolvedReviewRunStatus === "running";
	const reviewCompleted =
		resolvedReviewRunStatus === "done" ||
		["approved", "changes_requested", "cancelled"].includes(
			detail.session.status,
		);
	const latestSecurityReview = latestArtifactByKind(
		detail.artifacts,
		"security_review",
	);
	const securityResult = securityDiagnosticResult(latestSecurityReview);
	const reviewRunFindings =
		latestReviewRun?.findings?.map((finding) => ({
			id: `${finding.severity}-${finding.title}-${finding.path ?? ""}`,
			severity: finding.severity,
			title: finding.title,
			body: finding.body ?? null,
			filePath: finding.path ?? null,
		})) ?? [];
	const visibleFindings =
		detail.findings.length > 0
			? detail.findings.map((finding) => ({
					id: finding.id,
					severity: finding.severity,
					title: finding.title,
					body: finding.body,
					filePath: null,
				}))
			: reviewRunFindings;
	const fixesWereRequested = latestReviewRun?.options.applyFixes === true;
	const fixesWereApplied = latestReviewRun?.fixesApplied === true;
	const hasReviewResultContent =
		Boolean(latestReviewRun?.finalReport?.trim()) ||
		visibleFindings.length > 0 ||
		Boolean(securityResult);
	const latestTargets = latestArtifactByKind(
		detail.artifacts,
		"review_targets",
	);
	const canSelectCommit =
		latestTargets?.status !== "needs_human" &&
		!latestReviewRun?.warnings.some(
			(warning) => warning.severity === "blocking",
		);
	const commitAlreadyDone =
		gitCloseout?.state === "committed" ||
		gitCloseout?.state === "push_ready" ||
		gitCloseout?.state === "pushed";
	const canCommitReviewedRun =
		Boolean(gitCloseout?.canCommit) &&
		!commitAlreadyDone &&
		busySection !== "git_commit";
	const commitButtonDisabled = !onCommitGitCloseout || !canCommitReviewedRun;
	const commitButtonTitle = commitAlreadyDone
		? "この run は既にコミット済みです。"
		: gitCloseout?.blockingReason;
	const isArchivedTask =
		activeTaskStatus === "cancelled" || activeTaskStatus === "failed";
	const taskArchiveBusy = busySection === "task_archive";
	const taskArchiveAction = isArchivedTask
		? {
				label: "アクティブタスクに戻す",
				description:
					"このタスクを ready に戻し、通常のアクティブタスクとして再開できる状態にします。",
				icon: <ArchiveRestore className="h-3.5 w-3.5" />,
				buttonClass: reviewPrimaryActionButtonClass,
				disabled: !onRestoreArchivedTask || taskArchiveBusy,
				run: () => onRestoreArchivedTask?.(detail.session.taskId),
			}
		: {
				label: "完了してアーカイブ",
				description:
					"このレビュー対象タスクを完全に完了したものとして扱い、アーカイブタスクへ移動します。",
				icon: <Archive className="h-3.5 w-3.5" />,
				buttonClass: reviewSuccessActionButtonClass,
				disabled: !onCompleteAndArchiveTask || taskArchiveBusy,
				run: () => onCompleteAndArchiveTask?.(detail.session.taskId),
			};
	return (
		<div className="nightworkers-review-status h-full overflow-auto bg-slate-950 p-5 text-slate-100">
			<div className="mx-auto grid max-w-5xl gap-5">
				<div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
					<div>
						<div className="text-xs leading-5 text-slate-400">
							{t("reviewStatus.runRemains")}{" "}
							{detail.session.status === "approved"
								? t("reviewStatus.sessionState.approved")
								: t("reviewStatus.sessionState.executionUnchanged")}
							.
						</div>
					</div>
					{reviewCompleted ? null : (
						<span
							className={`rounded border px-2.5 py-1 text-xs font-medium ${levelClass}`}
						>
							{reviewStatusValueLabel(t, "level", level)}
						</span>
					)}
				</div>

				<div className="grid gap-3 rounded border border-slate-800 bg-slate-900/50 p-3">
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="min-w-0">
							<div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
								<ClipboardCheck className="h-4 w-4 text-cyan-200" />
								Review Run
							</div>
							{latestReviewRun ? (
								<div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-slate-300">
									<span className="rounded border border-slate-700 px-2 py-0.5">
										targets {latestReviewRun.target.targetFiles?.length ?? 0}
									</span>
									<span className="rounded border border-slate-700 px-2 py-0.5">
										excluded{" "}
										{latestReviewRun.target.excludedDirtyFiles?.length ?? 0}
									</span>
									<span className="rounded border border-slate-700 px-2 py-0.5">
										todos {latestReviewRun.todos.length}
									</span>
								</div>
							) : null}
						</div>
						<button
							type="button"
							className={`nightworkers-review-run-button ${reviewPrimaryActionButtonClass}`}
							disabled={!onStartReviewRun || reviewRunInProgress}
							onClick={async () => {
								if (!onStartReviewRun || reviewRunInProgress) return;
								setBusySection("review_run");
								setError(null);
								try {
									await onStartReviewRun(detail.session.id, reviewRunOptions);
								} catch (err) {
									setError(
										err instanceof Error
											? err.message
											: "Review Run could not start.",
									);
								} finally {
									setBusySection(null);
								}
							}}
						>
							{reviewRunInProgress ? (
								<LoaderCircle className="h-3.5 w-3.5 animate-spin" />
							) : (
								<Play className="h-3.5 w-3.5" />
							)}
							Run
						</button>
					</div>
					<div className="grid gap-2">
						{reviewRunOptionDescriptions.map(({ key, label, description }) => {
							const disabled = key === "commitChanges" && !canSelectCommit;
							return (
								<label
									key={key}
									className={`grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-x-3 rounded border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-200 ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
								>
									<input
										type="checkbox"
										className="mt-0.5 h-3.5 w-3.5 accent-cyan-400"
										checked={reviewRunOptions[key]}
										disabled={disabled}
										onChange={(event) =>
											setReviewRunOptions((prev) => ({
												...prev,
												[key]: event.target.checked,
											}))
										}
									/>
									<span className="grid gap-1">
										<span className="font-medium text-slate-100">{label}</span>
										<span className="leading-5 text-slate-400">
											{description}
										</span>
									</span>
								</label>
							);
						})}
					</div>
					{latestReviewRun?.warnings.length ? (
						<div className="grid gap-1 text-xs text-amber-100">
							{latestReviewRun.warnings.slice(0, 4).map((warning) => (
								<div
									key={`${warning.code}-${warning.message}`}
									className="rounded border border-amber-800/70 bg-amber-950/30 px-2 py-1"
								>
									{warning.message}
								</div>
							))}
						</div>
					) : null}
					{hasReviewResultContent ? (
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
							{latestReviewRun?.finalReport?.trim() ? (
								<div className="grid gap-1">
									<div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
										Review Run 報告
									</div>
									<pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded border border-slate-800 bg-slate-950/70 p-3 text-xs leading-5 text-slate-200">
										{compactText(latestReviewRun.finalReport, 2200)}
									</pre>
								</div>
							) : null}
							{securityResult ? (
								<div className="grid gap-2 rounded border border-slate-800 bg-slate-900/45 p-3 text-xs text-slate-300">
									<div className="flex flex-wrap items-center gap-2">
										<ShieldAlert className="h-3.5 w-3.5 text-amber-300" />
										<span className="font-semibold text-slate-100">
											vulnWorkbench 実行結果
										</span>
										<span
											className={`rounded border px-2 py-0.5 text-[11px] ${
												securityResult.ok
													? "border-emerald-700 bg-emerald-950/30 text-emerald-100"
													: "border-amber-800 bg-amber-950/30 text-amber-100"
											}`}
										>
											{securityResult.ok ? "completed" : "needs attention"}
										</span>
									</div>
									<div className="grid gap-1 sm:grid-cols-2">
										<div>profile: {securityResult.profile}</div>
										<div>scanRunId: {securityResult.scanRunId ?? "-"}</div>
										<div>findings: {securityResult.findingCount}</div>
										<div>
											high/critical: {securityResult.highOrCriticalCount}
										</div>
									</div>
									{securityResult.error ? (
										<div className="rounded border border-amber-800/70 bg-amber-950/30 px-2 py-1 text-amber-100">
											{securityResult.error}
										</div>
									) : null}
									{securityResult.improvementRequest ? (
										<div className="whitespace-pre-wrap leading-5">
											{securityResult.improvementRequest}
										</div>
									) : null}
									{securityResult.topFindings.length > 0 ? (
										<div className="grid gap-2">
											<div className="font-semibold text-slate-100">
												対応が必要な検出
											</div>
											{securityResult.topFindings.map((finding) => {
												const location = finding.location
													? `${finding.location.path}${
															finding.location.line
																? `:${finding.location.line}`
																: ""
														}`
													: "-";
												return (
													<div
														key={finding.id ?? `${finding.ruleId}-${location}`}
														className="rounded border border-amber-900/60 bg-amber-950/20 px-2 py-1.5"
													>
														<div className="font-medium text-amber-100">
															[{finding.severity}]{" "}
															{compactText(finding.title, 260)}
														</div>
														<div className="mt-1 text-slate-300">
															場所: {location}
														</div>
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
									{securityResult.commandsRun.length > 0 ? (
										<div className="grid gap-1">
											{securityResult.commandsRun.map((command) => (
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
							) : null}
						</div>
					) : null}
					<div className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-800 bg-slate-950/40 px-3 py-2">
						<div className="min-w-0 text-xs">
							<div className="font-medium text-slate-100">手動コミット</div>
							<div className="mt-1 text-slate-400">
								対象 {gitCloseout?.counts.stageablePaths ?? 0} 件 / 除外{" "}
								{gitCloseout?.counts.excludedPaths ?? 0} 件 /{" "}
								{gitCloseout?.state ?? "未確認"}
							</div>
						</div>
						<button
							type="button"
							className={reviewSuccessActionButtonClass}
							title={commitButtonTitle ?? undefined}
							disabled={commitButtonDisabled}
							onClick={async () => {
								if (!onCommitGitCloseout || !canCommitReviewedRun) return;
								setBusySection("git_commit");
								setError(null);
								try {
									await onCommitGitCloseout(detail.session.runId);
								} catch (err) {
									setError(
										err instanceof Error
											? err.message
											: "Git commit could not be created.",
									);
								} finally {
									setBusySection(null);
								}
							}}
						>
							{busySection === "git_commit" ? (
								<LoaderCircle className="h-3.5 w-3.5 animate-spin" />
							) : (
								<GitCommitHorizontal className="h-3.5 w-3.5" />
							)}
							{commitAlreadyDone ? "コミット済み" : "LLMメッセージでコミット"}
						</button>
					</div>
				</div>

				{detail.securityHandoffs.length > 0 ? (
					<div className="grid gap-3">
						<div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
							{t("reviewStatus.securityHandoffs")}
						</div>
						<div className="grid gap-2">
							{detail.securityHandoffs.map((handoff) => (
								<div
									key={handoff.id}
									className="grid gap-2 rounded border border-slate-800 bg-slate-900/60 p-3"
								>
									<div className="flex flex-wrap items-center gap-2">
										<ShieldAlert className="h-3.5 w-3.5 text-amber-300" />
										<span className="text-sm font-medium text-slate-100">
											{handoff.title}
										</span>
										<span className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
											{reviewStatusValueLabel(
												t,
												"securityHandoffStatus",
												handoff.status,
											)}
										</span>
									</div>
									<div className="text-xs leading-5 text-slate-400">
										{handoff.summary}
									</div>
									{handoff.changedPaths.length > 0 ? (
										<div className="font-mono text-[11px] text-slate-500">
											{handoff.changedPaths.join(", ")}
										</div>
									) : null}
								</div>
							))}
						</div>
					</div>
				) : null}

				{error ? (
					<div className="rounded border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-100">
						{error}
					</div>
				) : null}

				<div className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-800 bg-slate-900/60 px-3 py-3">
					<div className="min-w-0 text-xs">
						<div className="font-medium text-slate-100">
							レビュー後のタスク状態
						</div>
						<div className="mt-1 leading-5 text-slate-400">
							{taskArchiveAction.description}
						</div>
					</div>
					<button
						type="button"
						className={taskArchiveAction.buttonClass}
						disabled={taskArchiveAction.disabled}
						onClick={async () => {
							setBusySection("task_archive");
							setError(null);
							try {
								await taskArchiveAction.run();
							} catch (err) {
								setError(
									err instanceof Error
										? err.message
										: "Task status could not be updated.",
								);
							} finally {
								setBusySection(null);
							}
						}}
					>
						{taskArchiveBusy ? (
							<LoaderCircle className="h-3.5 w-3.5 animate-spin" />
						) : (
							taskArchiveAction.icon
						)}
						{taskArchiveAction.label}
					</button>
				</div>
			</div>
		</div>
	);
}
